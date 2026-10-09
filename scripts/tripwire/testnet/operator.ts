// Sepolia wiring for the durable operator. No resets, synthetic burns or route resumes.
//
// Keys (ADR-026): the oracle signs attestations and reviews and never pays gas.
// Two relayers pay it, each with its own nonce sequence and journal, so a
// review stuck at a low fee can never hold back an urgent FREEZE (HIGH-1).
import { encodeFunctionData, erc20Abi, formatGwei, parseTransaction, TransactionReceiptNotFoundError, type Hex, type LocalAccount } from 'viem';
import { z } from 'zod';
import guardianArtifact from '../../../src/tripwire/guardian.artifact.js';
import { ResponseTier } from '../../../src/tripwire/onChain.js';
import type { ContractRiskSummary, RouteBaseline } from '../../../src/tripwire/types.js';
import { FLAG_LIST_NAME, lookupFlaggedAddress } from '../../../src/services/preventiveScamScanner.js';
import { Attestor, type GuardianPort } from '../attest.js';
import { rollingBaseline } from '../baseline.js';
import { burnEventSchema, releaseEventSchema, type BurnEvent, type LogFeed } from '../events.js';
import { ReleaseOperator } from '../operator.js';
import { ReleaseDecision, releaseDecision, releaseMinimumTier, signPaymentReleaseReview, signReleaseReview } from '../review.js';
import { DurableSender, type TransactionPort } from '../sender.js';
import { OperatorStore } from '../store.js';
import { Watcher, type BaselineProvider, type SourceAdapter, type SourceEvidence } from '../watch.js';
import { blockHeaderSchema, receiptFinality, type FinalityConflictError } from '../finality.js';
import { assertSeparateRoles, ContractEventFeed, type Clients, type Deployment, type TestnetConfig } from './sepolia.js';
import demo from './contracts.artifact.js';
import { readGuardianProtection } from './guardianState.js';
import { assertProtectionPolicy } from './protectionPolicy.js';
import { readReleasePolicyState, releaseTuple } from './releaseState.js';
import { PaymentStateBehindError, readPaymentState } from './paymentState.js';
import { cctpPaymentAbi } from '../../../src/chains/evm/registry/cctp.js';
import { cctpPaymentBindingsSchema, cctpVerifierScope, type CctpPaymentBindings } from '../cctp.js';
import { cctpAddressSchema } from '../../../src/chains/evm/cctp.js';
import { assertCctpPaymentBindings } from './cctpBindings.js';
import paymentArtifact from './cctpPaymentEscrow.artifact.js';
import { assertPaymentRuntime } from './artifactAcceptance.js';

export interface RpcDestination {
  chainId: number; route: string; routeId: Hex; startBlock: string;
  vault: Hex; guardian: Hex; token: Hex;
}

/** The attestation lane's journal sits next to the release lane's. */
export const attestationStateFile = (stateFile: string) => stateFile.replace(/(\.sqlite)?$/, '.attestations.sqlite');

const max = (...values: bigint[]) => values.reduce((a, b) => (a > b ? a : b));
/** +12.5%, rounded up: comfortably above the 10% nodes require of a replacement. */
const raise = (fee: bigint) => fee + (fee + 7n) / 8n;

/**
 * Current EIP-1559 fees with headroom: twice the base fee plus the tip still
 * pays after about six full blocks of base-fee growth. Replacement covers
 * anything faster than that.
 */
export async function suggestFees(c: Pick<Clients, 'pub'>): Promise<{ baseFeePerGas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const [block, tip] = await Promise.all([c.pub.getBlock({ blockTag: 'latest' }), c.pub.estimateMaxPriorityFeePerGas()]);
  const baseFeePerGas = z.bigint().nonnegative().parse(block.baseFeePerGas);
  const maxPriorityFeePerGas = z.bigint().nonnegative().parse(tip);
  return { baseFeePerGas, maxFeePerGas: baseFeePerGas * 2n + maxPriorityFeePerGas, maxPriorityFeePerGas };
}

/**
 * One relayer's transaction port: it signs and never broadcasts from prepare
 * or replace. `ceiling` caps maxFeePerGas: past it, nothing new is signed and
 * a pending transaction is not bumped further.
 */
export function relayerPort(c: Clients, account: LocalAccount, ceiling: bigint, hooks: {
  beforeSign: () => Promise<void>; assertSafe: () => Promise<void>; onFinalityConflict: (error: FinalityConflictError) => Promise<void>;
}): TransactionPort {
  return {
    finalityMode: 'finalized', chainId: c.chainId, sender: account.address,
    prepare: async (request) => {
      const fees = await suggestFees(c);
      if (fees.baseFeePerGas + fees.maxPriorityFeePerGas > ceiling) {
        throw new Error(`Network fees are above the ${formatGwei(ceiling)} gwei ceiling (TRIPWIRE_MAX_FEE_GWEI); nothing was signed.`);
      }
      const call = { account, to: request.to as Hex, data: request.data as Hex, value: BigInt(request.value) };
      const gas = await c.pub.estimateGas(call);
      const tx = await c.wallet.prepareTransactionRequest({ ...call, type: 'eip1559', gas: gas + gas / 5n,
        maxFeePerGas: fees.maxFeePerGas < ceiling ? fees.maxFeePerGas : ceiling, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
      await hooks.beforeSign();
      return c.wallet.signTransaction({ ...tx, account });
    },
    replace: async (previous) => {
      const tx = parseTransaction(previous);
      if (tx.type !== 'eip1559' || tx.nonce === undefined || tx.gas === undefined || !tx.to ||
        tx.maxFeePerGas === undefined || tx.maxPriorityFeePerGas === undefined) throw new Error('Only a complete EIP-1559 transaction can be fee-bumped.');
      const fees = await suggestFees(c);
      const maxPriorityFeePerGas = max(raise(tx.maxPriorityFeePerGas), fees.maxPriorityFeePerGas);
      const maxFeePerGas = max(raise(tx.maxFeePerGas), fees.maxFeePerGas, maxPriorityFeePerGas);
      if (maxFeePerGas > ceiling) {
        throw new Error(`Bumping nonce ${tx.nonce} needs ${formatGwei(maxFeePerGas)} gwei, above the ${formatGwei(ceiling)} gwei ceiling; it stays pending.`);
      }
      await hooks.beforeSign();
      return account.signTransaction({ chainId: c.chainId, type: 'eip1559', nonce: tx.nonce, gas: tx.gas, to: tx.to,
        data: tx.data, value: tx.value ?? 0n, maxFeePerGas, maxPriorityFeePerGas });
    },
    broadcast: (raw) => c.pub.sendRawTransaction({ serializedTransaction: raw }),
    receipt: async (hash) => {
      try { return await c.pub.getTransactionReceipt({ hash }); }
      catch (error) { if (error instanceof TransactionReceiptNotFoundError) return null; throw error; }
    },
    waitReceipt: (hash) => c.pub.waitForTransactionReceipt({ hash, timeout: 60_000 }),
    finality: (receipt) => receiptFinality({ getBlock: (args) => c.pub.getBlock(args) }, receipt),
    assertSafe: hooks.assertSafe,
    onFinalityConflict: hooks.onFinalityConflict,
  };
}

/** Contract facts change slowly and cost an explorer call: reuse a successful answer for `ttlMs`. */
export function cachedFacts(lookup: (address: Hex) => Promise<ContractRiskSummary | null>, ttlMs = 10 * 60_000, now = () => Date.now()) {
  const cache = new Map<string, { value: ContractRiskSummary | null; at: number }>();
  return async (address: Hex): Promise<ContractRiskSummary | null> => {
    const key = address.toLowerCase(); const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    const value = await lookup(address); // Failures are not cached.
    cache.set(key, { value, at: now() }); return value;
  };
}

export async function createRpcOperator(cfg: TestnetConfig, c: Clients, d: Deployment | RpcDestination, stateFile: string, opts: {
  /** 'rolling': recompute each tick from finalized source burns and the vault's balance (HIGH-2). Null: every payout holds. */
  baseline: RouteBaseline | null | 'rolling';
  /** Rolling window in hours (default 24). */
  baselineHours?: number;
  /** Customer payment escrow (ADR-028): its review format 3 and policy reads. */
  payment?: CctpPaymentBindings;
  contractFacts?: (address: Hex) => Promise<ContractRiskSummary | null>;
  /** Required for ALLOW. Absent by default: logs from MockSourceBridge are not source proofs. */
  verifySource?: (release: z.infer<typeof releaseEventSchema>, observed: bigint | null) => Promise<SourceEvidence>;
  source?: {
    chainId: number; address: Hex; scope: SourceAdapter['scope'];
    create: (store: OperatorStore) => { adapter: SourceAdapter; ingress: LogFeed<BurnEvent> };
  };
}) {
  if (opts.payment) opts = { ...opts, payment: cctpPaymentBindingsSchema.parse(opts.payment) };
  const { vault, guardian, token } = 'contracts' in d ? { vault: d.contracts.ProtectedVault, guardian: d.contracts.TripwireGuardian, token: d.contracts.DemoUSDC }
    : { vault: { address: d.vault }, guardian: { address: d.guardian }, token: { address: d.token } };
  const bridge = 'contracts' in d ? d.contracts.MockSourceBridge : null;
  if (!opts.source && !bridge) throw new Error('A real deployment requires its source adapter.');
  if (opts.source && opts.verifySource) throw new Error('Configure one source verifier.');
  if (opts.payment && !opts.source) throw new Error('Customer payment operator requires its authenticated source adapter.');
  if (opts.payment && JSON.stringify(opts.source?.scope) !== JSON.stringify(cctpVerifierScope(vault.address, 'customer-payment', opts.payment))) {
    throw new Error('Customer payment source profile does not match this escrow.');
  }
  const sourceAddress = opts.source?.address ?? bridge?.address;
  if (!sourceAddress) throw new Error('Source contract is not configured.');
  if (c.chainId !== d.chainId || c.chainId !== 11155111) throw new Error('Deployment chain does not match Sepolia RPC.');
  const from = BigInt(z.string().regex(/^(0|[1-9][0-9]*)$/).parse(d.startBlock));
  // Validate immutable bindings before opening a write path. An old vault fails here.
  await c.pub.readContract({ address: vault.address, abi: demo.ProtectedVault.abi, functionName: 'MAX_REVIEW_TTL' });
  await assertProtectionPolicy({
    guardianVersion: () => c.pub.readContract({ address: guardian.address, abi: guardianArtifact.abi, functionName: 'GUARDIAN_POLICY_VERSION' }),
    releaseVersion: () => c.pub.readContract({ address: vault.address, abi: demo.ProtectedVault.abi, functionName: 'RELEASE_POLICY_VERSION' }),
    reviewFormat: () => c.pub.readContract({ address: vault.address, abi: demo.ProtectedVault.abi, functionName: 'REVIEW_FORMAT_VERSION' }),
    routePermission: () => c.pub.readContract({ address: guardian.address, abi: guardianArtifact.abi, functionName: 'isProtected', args: [vault.address, d.routeId] }),
  }, opts.payment ? 3 : 2);
  if (opts.payment) {
    const head = blockHeaderSchema.parse(await c.pub.getBlock({ blockTag: 'finalized' }));
    await assertPaymentRuntime(vault.address, guardian.address, opts.payment, head.number,
      (address, blockNumber) => c.pub.getCode({ address, blockNumber }));
    await assertCctpPaymentBindings(vault.address, opts.payment, (name) => c.pub.readContract({
      address: vault.address, abi: paymentArtifact.abi, functionName: name, blockNumber: head.number,
    }));
    await assertProtectionPolicy({
      guardianVersion: () => c.pub.readContract({ address: guardian.address, abi: guardianArtifact.abi, functionName: 'GUARDIAN_POLICY_VERSION', blockNumber: head.number }),
      releaseVersion: () => c.pub.readContract({ address: vault.address, abi: demo.ProtectedVault.abi, functionName: 'RELEASE_POLICY_VERSION', blockNumber: head.number }),
      reviewFormat: () => c.pub.readContract({ address: vault.address, abi: demo.ProtectedVault.abi, functionName: 'REVIEW_FORMAT_VERSION', blockNumber: head.number }),
      routePermission: () => c.pub.readContract({ address: guardian.address, abi: guardianArtifact.abi, functionName: 'isProtected', args: [vault.address, d.routeId], blockNumber: head.number }),
    }, 3);
    z.literal(600n).parse(await c.pub.readContract({ address: vault.address, abi: demo.ProtectedVault.abi, functionName: 'MAX_REVIEW_TTL', blockNumber: head.number }));
    for (const [name, expected] of [['token', token.address], ['guardian', guardian.address], ['routeId', d.routeId]] as const) {
      const actual = await c.pub.readContract({ address: vault.address, abi: demo.ProtectedVault.abi, functionName: name, blockNumber: head.number });
      if (typeof actual !== 'string' || actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`Customer escrow ${name} binding differs at finalized block.`);
    }
    const oracle = cctpAddressSchema.parse(await c.pub.readContract({ address: guardian.address, abi: guardianArtifact.abi, functionName: 'oracle', blockNumber: head.number }));
    const owner = cctpAddressSchema.parse(await c.pub.readContract({ address: guardian.address, abi: guardianArtifact.abi, functionName: 'owner', blockNumber: head.number }));
    if (oracle !== cfg.oracle.address.toLowerCase() || oracle === opts.payment.authority || oracle === owner) {
      throw new Error('Payment reviewer must be the configured oracle and separate from customer authority/guardian owner.');
    }
    const checked = blockHeaderSchema.parse(await c.pub.getBlock({ blockNumber: head.number }));
    if (checked.hash !== head.hash || checked.number !== head.number) throw new Error('Customer deployment block changed.');
  }
  assertSeparateRoles(cfg);
  for (const [name, expected] of [['token', token.address], ['guardian', guardian.address], ['routeId', d.routeId]] as const) {
    const actual = await c.pub.readContract({ address: vault.address, abi: demo.ProtectedVault.abi, functionName: name });
    if (typeof actual !== 'string' || actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`Vault ${name} does not match deployment.`);
  }
  const rejectionCooldown = z.bigint().positive().parse(await c.pub.readContract({ address: vault.address, abi: demo.ProtectedVault.abi, functionName: 'REJECTION_COOLDOWN' }));
  const scope = { route: d.route, chainId: c.chainId, sourceChainId: opts.source?.chainId ?? c.chainId,
    source: sourceAddress, vault: vault.address, guardian: guardian.address, token: token.address,
    decimals: 6, finalityMode: 'finalized' as const, sourceVerifier: opts.source?.scope };
  const store = new OperatorStore(stateFile, { ...scope, sender: cfg.relayer.address });
  let attestationStore: OperatorStore | null = null;
  try {
    attestationStore = new OperatorStore(attestationStateFile(stateFile), { ...scope, sender: cfg.attestationRelayer.address });
    const journals = [store, attestationStore];
    // Reads must not trail any receipt either lane has already seen.
    const minimumBlock = () => journals.flatMap((j) => j.transactions()).reduce((highest, tx) => tx.block && BigInt(tx.block) > highest ? BigInt(tx.block) : highest, 0n);
    const paymentRead = (messageId: Hex, tag: 'latest' | 'finalized' = 'latest') => readPaymentState({
      getBlock: (args) => c.pub.getBlock(args), minimumBlock,
      read: (name, blockNumber, args) => c.pub.readContract({ address: vault.address,
        abi: paymentArtifact.abi, functionName: name, blockNumber, args }),
    }, messageId, store.sourceProofs().find((p) => p.messageId === messageId), tag);
    const source = opts.source?.create(store);
    let clock = Number((await c.pub.getBlock()).timestamp);
    const hooks = { beforeSign: () => watcher.assertCanonical(), assertSafe: () => watcher.assertCanonical(),
      onFinalityConflict: (error: FinalityConflictError) => watcher.quarantineFinality(error) };
    const sender = new DurableSender(store, relayerPort(c, cfg.relayer, cfg.maxFeePerGas, hooks));
    const attestationSender = new DurableSender(attestationStore, relayerPort(c, cfg.attestationRelayer, cfg.maxFeePerGas, hooks));
    const guardianPort: GuardianPort = {
      address: guardian.address, chainId: c.chainId,
      currentTier: async (routeId) => z.number().int().min(0).max(3).parse(
        await c.pub.readContract({ address: guardian.address, abi: guardianArtifact.abi, functionName: 'currentTier', args: [routeId] })) as ResponseTier,
      protectionState: (routeId) => readGuardianProtection({
        getBlock: (args) => c.pub.getBlock(args),
        readRoute: (blockNumber) => c.pub.readContract({ address: guardian.address, abi: guardianArtifact.abi,
          functionName: 'getRoute', args: [routeId], blockNumber }),
        readOracle: (blockNumber) => c.pub.readContract({ address: guardian.address, abi: guardianArtifact.abi,
          functionName: 'oracle', blockNumber }),
        readLimit: (blockNumber) => c.pub.readContract({ address: guardian.address, abi: guardianArtifact.abi,
          functionName: 'protectionLimit', args: [routeId], blockNumber }),
        minimumBlock,
      }),
      submitAttestation: async (a, signature) => {
        // Settle (and if needed fee-bump) the lane's previous attestation before taking a new nonce.
        await attestationSender.recover();
        const result = await attestationSender.send(`attestation/${a.nonce}`, { to: guardian.address,
          data: encodeFunctionData({ abi: guardianArtifact.abi, functionName: 'submitAttestation', args: [a.routeId, a.riskScore, a.validUntil, a.nonce, signature] }), value: '0' });
        return { ok: result.status === 'confirmed' || (result.status === 'included' && result.receiptStatus === 'success'),
          txHash: (result.minedHash ?? result.hash) as Hex, gas: BigInt(result.gas ?? '0') };
      },
    };
    const ingress = source?.ingress ?? (bridge ? new ContractEventFeed(c, bridge.address, demo.MockSourceBridge.abi, 'Burned', from,
        (a, t) => burnEventSchema.parse({ messageId: a.messageId, amount: a.amount, timestamp: t }), { finality: 'finalized' })
      : null);
    if (!ingress) throw new Error('Source feed is not configured.');
    const baseline: RouteBaseline | null | BaselineProvider = opts.baseline === 'rolling'
      ? rollingBaseline({ route: d.route, decimals: 6, windowHours: opts.baselineHours,
        tvl: async () => z.bigint().nonnegative().parse(await c.pub.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [vault.address] })) })
      : opts.baseline;
    const watcher = new Watcher({ route: d.route, chain: 'ethereum', token: source ? 'USDC' : 'tdUSDC', decimals: 6, bridge: vault.address, store,
      ingress,
      // Release requests at the safe head (MED-2): a reorg past it trips the anchor check and quarantines.
      egress: new ContractEventFeed(c, vault.address, demo.ProtectedVault.abi, 'ReleaseRequested', from,
        (a, t) => releaseEventSchema.parse({ messageId: a.messageId, recipient: a.to, amount: a.amount, timestamp: t }), { finality: 'safe' }),
      baseline, verifySource: opts.verifySource, sourceAdapter: source?.adapter,
      payoutToleranceBps: 0n, contractFacts: opts.contractFacts && cachedFacts(opts.contractFacts), now: () => clock,
      screening: { isFlagged: (a) => lookupFlaggedAddress(a) !== null,
        describe: (a) => lookupFlaggedAddress(a) ? `${FLAG_LIST_NAME}: ${lookupFlaggedAddress(a)?.name}` : undefined },
    });
    const operator = new ReleaseOperator(watcher, sender, new Attestor(cfg.oracle, guardianPort, {
      now: () => clock, beforeSign: () => watcher.assertCanonical(),
    }), {
      read: (messageId) => opts.payment ? paymentRead(messageId) : readReleasePolicyState({
        getBlock: (args) => c.pub.getBlock(args), minimumBlock, rejectionCooldown,
        readRelease: (blockNumber) => c.pub.readContract({ address: vault.address, abi: demo.ProtectedVault.abi,
          functionName: 'releases', args: [messageId], blockNumber }),
        readDelay: (blockNumber) => c.pub.readContract({ address: vault.address, abi: demo.ProtectedVault.abi,
          functionName: 'releaseDelayUntil', args: [messageId], blockNumber }),
        readRejectedAt: (blockNumber) => c.pub.readContract({ address: vault.address, abi: demo.ProtectedVault.abi,
          functionName: 'rejectedAt', args: [messageId], blockNumber }),
      }),
      review: async (observation, nonce, decision = releaseDecision(observation)) => {
        const now = Number((await c.pub.getBlock()).timestamp);
        const review = { messageId: observation.release.messageId, routeId: d.routeId, token: token.address,
          recipient: observation.release.recipient, amount: observation.release.amount, decision,
          minimumTier: releaseMinimumTier(observation), validUntil: BigInt(now + 300), nonce };
        await watcher.assertCanonical();
        const payment = opts.payment ? await paymentRead(review.messageId) : undefined;
        if (payment && (!payment.payment || payment.nonce + 1n !== nonce || payment.payment.returnAt > 0n || payment.payment.returned ||
          payment.recipient !== review.recipient.toLowerCase() || payment.amount !== review.amount || payment.state >= 3)) {
          throw new Error('Customer credit changed before review. Retry with fresh state.');
        }
        if (payment?.payment && decision === ReleaseDecision.ALLOW &&
          (payment.payment.blockers.length || observation.source.status !== 'verified' ||
            !store.sourceProofs().find((p) => p.messageId === review.messageId)?.payment)) {
          throw new Error('Customer payment is not eligible for ALLOW.');
        }
        await watcher.assertCanonical();
        if (payment?.payment) review.validUntil = payment.payment.now + 300n;
        const signature = payment?.payment ? await signPaymentReleaseReview(cfg.oracle, vault.address, review,
          { version: payment.payment.version, hash: payment.payment.hash }, c.chainId) : await signReleaseReview(cfg.oracle, vault.address, review, c.chainId);
        return { to: vault.address, data: encodeFunctionData({ abi: demo.ProtectedVault.abi, functionName: 'reviewRelease',
          args: [review.messageId, review.decision, review.minimumTier, review.validUntil, review.nonce, signature] }), value: '0' };
      },
      canExecute: async (messageId) => {
        try { await c.pub.simulateContract({ account: cfg.relayer, address: vault.address, abi: demo.ProtectedVault.abi, functionName: 'executeRelease', args: [messageId] }); return true; }
        catch { return false; } // Preserve the job for delayed/capped payouts or unavailable RPC.
      },
      execute: (messageId) => ({ to: vault.address, data: encodeFunctionData({ abi: demo.ProtectedVault.abi, functionName: 'executeRelease', args: [messageId] }), value: '0' }),
      ...(opts.payment ? { returnCredit: (messageId: Hex) => ({ to: vault.address,
        data: encodeFunctionData({ abi: cctpPaymentAbi, functionName: 'executeReturn', args: [messageId] }), value: '0' }) } : {}),
      terminalFinalized: async (messageId, expected) => {
        if (opts.payment) {
          try {
            const state = await paymentRead(messageId, 'finalized');
            return state.recipient === expected.recipient && state.amount === expected.amount && state.state === expected.state &&
              state.payment?.returned === expected.payment?.returned && state.payment?.returnAt === expected.payment?.returnAt;
          } catch (error) { if (error instanceof PaymentStateBehindError) return false; throw error; }
        }
        const head = blockHeaderSchema.parse(await c.pub.getBlock({ blockTag: 'finalized' }));
        const r = releaseTuple.parse(await c.pub.readContract({ address: vault.address, abi: demo.ProtectedVault.abi,
          functionName: 'releases', args: [messageId], blockNumber: head.number }));
        const checked = blockHeaderSchema.parse(await c.pub.getBlock({ blockNumber: head.number }));
        if (checked.number !== head.number || checked.hash !== head.hash) throw new Error('Finalized terminal-state block changed while reading.');
        return r[0].toLowerCase() === expected.recipient.toLowerCase() && r[1] === expected.amount && r[2] === expected.state;
      },
    }, d.routeId, { heldBackoff: { initial: 30, max: 600 } });
    const lanes = attestationStore;
    return { store, attestationStore: lanes, sender, attestationSender, watcher, tick: async () => {
      clock = Number((await c.pub.getBlock()).timestamp); return operator.tick();
    }, close: () => { try { lanes.close(); } finally { store.close(); } } };
  } catch (error) { try { attestationStore?.close(); } finally { store.close(); } throw error; }
}
