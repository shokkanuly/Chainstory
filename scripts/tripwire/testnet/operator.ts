// Sepolia wiring for the durable operator. No resets, synthetic burns or route resumes.
import { encodeFunctionData, TransactionReceiptNotFoundError, type Hex } from 'viem';
import { z } from 'zod';
import guardianArtifact from '../../../src/tripwire/guardian.artifact.js';
import { ResponseTier } from '../../../src/tripwire/onChain.js';
import type { ContractRiskSummary, RouteBaseline } from '../../../src/tripwire/types.js';
import { FLAG_LIST_NAME, lookupFlaggedAddress } from '../../../src/services/preventiveScamScanner.js';
import { Attestor, type GuardianPort } from '../attest.js';
import { burnEventSchema, releaseEventSchema, type BurnEvent, type LogFeed } from '../events.js';
import { ReleaseOperator } from '../operator.js';
import { releaseDecision, releaseMinimumTier, signReleaseReview } from '../review.js';
import { DurableSender, type TransactionPort } from '../sender.js';
import { OperatorStore } from '../store.js';
import { Watcher, type SourceAdapter, type SourceEvidence } from '../watch.js';
import { blockHeaderSchema, receiptFinality } from '../finality.js';
import { ContractEventFeed, type Clients, type Deployment, type TestnetConfig } from './sepolia.js';
import demo from './contracts.artifact.js';
import { readGuardianProtection } from './guardianState.js';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((a) => a.toLowerCase() as Hex);
const releaseTuple = z.tuple([address, z.bigint().positive(), z.number().int().min(0).max(4), z.bigint().nonnegative(), address, z.bigint().nonnegative(), z.number().int().min(0).max(3)]);

export interface RpcDestination {
  chainId: number; route: string; routeId: Hex; startBlock: string;
  vault: Hex; guardian: Hex; token: Hex;
}

export async function createRpcOperator(cfg: TestnetConfig, c: Clients, d: Deployment | RpcDestination, stateFile: string, opts: {
  baseline: RouteBaseline | null;
  contractFacts?: (address: Hex) => Promise<ContractRiskSummary | null>;
  /** Required for ALLOW. Absent by default: logs from MockSourceBridge are not source proofs. */
  verifySource?: (release: z.infer<typeof releaseEventSchema>, observed: bigint | null) => Promise<SourceEvidence>;
  source?: {
    chainId: number; address: Hex; scope: SourceAdapter['scope'];
    create: (store: OperatorStore) => { adapter: SourceAdapter; ingress: LogFeed<BurnEvent> };
  };
}) {
  const { vault, guardian, token } = 'contracts' in d ? { vault: d.contracts.ProtectedVault, guardian: d.contracts.TripwireGuardian, token: d.contracts.DemoUSDC }
    : { vault: { address: d.vault }, guardian: { address: d.guardian }, token: { address: d.token } };
  const bridge = 'contracts' in d ? d.contracts.MockSourceBridge : null;
  if (!opts.source && !bridge) throw new Error('A real deployment requires its source adapter.');
  if (opts.source && opts.verifySource) throw new Error('Configure one source verifier.');
  const sourceAddress = opts.source?.address ?? bridge?.address;
  if (!sourceAddress) throw new Error('Source contract is not configured.');
  if (c.chainId !== d.chainId || c.chainId !== 11155111) throw new Error('Deployment chain does not match Sepolia RPC.');
  const from = BigInt(z.string().regex(/^(0|[1-9][0-9]*)$/).parse(d.startBlock));
  // Validate immutable bindings before opening a write path. An old vault fails here.
  await c.pub.readContract({ address: vault.address, abi: demo.ProtectedVault.abi, functionName: 'MAX_REVIEW_TTL' });
  for (const [name, expected] of [['token', token.address], ['guardian', guardian.address], ['routeId', d.routeId]] as const) {
    const actual = await c.pub.readContract({ address: vault.address, abi: demo.ProtectedVault.abi, functionName: name });
    if (typeof actual !== 'string' || actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`Vault ${name} does not match deployment.`);
  }
  const store = new OperatorStore(stateFile, { route: d.route, chainId: c.chainId, sourceChainId: opts.source?.chainId ?? c.chainId,
    source: sourceAddress, vault: vault.address, guardian: guardian.address, token: token.address,
    sender: cfg.account.address, decimals: 6, finalityMode: 'finalized', sourceVerifier: opts.source?.scope });
  try {
    const source = opts.source?.create(store);
    let clock = Number((await c.pub.getBlock()).timestamp);
    const transactionPort: TransactionPort = {
      finalityMode: 'finalized', chainId: c.chainId, sender: cfg.account.address,
      prepare: async (request) => {
        const tx = await c.wallet.prepareTransactionRequest({ type: 'eip1559', account: cfg.account, to: request.to as Hex,
          data: request.data as Hex, value: BigInt(request.value) });
        await watcher.assertCanonical();
        return c.wallet.signTransaction(tx);
      },
      broadcast: (raw) => c.pub.sendRawTransaction({ serializedTransaction: raw }),
      receipt: async (hash) => {
        try { return await c.pub.getTransactionReceipt({ hash }); }
        catch (error) { if (error instanceof TransactionReceiptNotFoundError) return null; throw error; }
      },
      waitReceipt: (hash) => c.pub.waitForTransactionReceipt({ hash, timeout: 60_000 }),
      finality: (receipt) => receiptFinality({ getBlock: (args) => c.pub.getBlock(args) }, receipt),
      assertSafe: () => watcher.assertCanonical(),
      onFinalityConflict: (error) => watcher.quarantineFinality(error),
    };
    const sender = new DurableSender(store, transactionPort);
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
        minimumBlock: () => store.transactions().reduce((highest, tx) => tx.block && BigInt(tx.block) > highest ? BigInt(tx.block) : highest, 0n),
      }),
      submitAttestation: async (a, signature) => {
        const result = await sender.send(`attestation/${a.nonce}`, { to: guardian.address,
          data: encodeFunctionData({ abi: guardianArtifact.abi, functionName: 'submitAttestation', args: [a.routeId, a.riskScore, a.validUntil, a.nonce, signature] }), value: '0' });
        return { ok: result.status === 'confirmed' || (result.status === 'included' && result.receiptStatus === 'success'),
          txHash: result.hash as Hex, gas: BigInt(result.gas ?? '0') };
      },
    };
    const ingress = source?.ingress ?? (bridge ? new ContractEventFeed(c, bridge.address, demo.MockSourceBridge.abi, 'Burned', from,
        (a, t) => burnEventSchema.parse({ messageId: a.messageId, amount: a.amount, timestamp: t }), { finality: 'finalized' })
      : null);
    if (!ingress) throw new Error('Source feed is not configured.');
    const watcher = new Watcher({ route: d.route, chain: 'ethereum', token: source ? 'USDC' : 'tdUSDC', decimals: 6, bridge: vault.address, store,
      ingress,
      egress: new ContractEventFeed(c, vault.address, demo.ProtectedVault.abi, 'ReleaseRequested', from,
        (a, t) => releaseEventSchema.parse({ messageId: a.messageId, recipient: a.to, amount: a.amount, timestamp: t }), { finality: 'finalized' }),
      baseline: opts.baseline, verifySource: opts.verifySource, sourceAdapter: source?.adapter,
      payoutToleranceBps: source ? 0n : undefined, contractFacts: opts.contractFacts, now: () => clock,
      screening: { isFlagged: (a) => lookupFlaggedAddress(a) !== null,
        describe: (a) => lookupFlaggedAddress(a) ? `${FLAG_LIST_NAME}: ${lookupFlaggedAddress(a)?.name}` : undefined },
    });
    const operator = new ReleaseOperator(watcher, sender, new Attestor(cfg.account, guardianPort, {
      now: () => clock, beforeSign: () => watcher.assertCanonical(),
    }), {
      read: async (messageId) => {
        const r = releaseTuple.parse(await c.pub.readContract({ address: vault.address, abi: demo.ProtectedVault.abi, functionName: 'releases', args: [messageId] }));
        return { recipient: r[0], amount: r[1], state: r[2], nonce: r[5] };
      },
      review: async (observation, nonce) => {
        const now = Number((await c.pub.getBlock()).timestamp);
        const review = { messageId: observation.release.messageId, routeId: d.routeId, token: token.address,
          recipient: observation.release.recipient, amount: observation.release.amount, decision: releaseDecision(observation),
          minimumTier: releaseMinimumTier(observation), validUntil: BigInt(now + 300), nonce };
        await watcher.assertCanonical();
        const signature = await signReleaseReview(cfg.account, vault.address, review, c.chainId);
        return { to: vault.address, data: encodeFunctionData({ abi: demo.ProtectedVault.abi, functionName: 'reviewRelease',
          args: [review.messageId, review.decision, review.minimumTier, review.validUntil, review.nonce, signature] }), value: '0' };
      },
      canExecute: async (messageId) => {
        try { await c.pub.simulateContract({ account: cfg.account, address: vault.address, abi: demo.ProtectedVault.abi, functionName: 'executeRelease', args: [messageId] }); return true; }
        catch { return false; } // Preserve the job for delayed/capped payouts or unavailable RPC.
      },
      execute: (messageId) => ({ to: vault.address, data: encodeFunctionData({ abi: demo.ProtectedVault.abi, functionName: 'executeRelease', args: [messageId] }), value: '0' }),
      terminalFinalized: async (messageId, expected) => {
        const head = blockHeaderSchema.parse(await c.pub.getBlock({ blockTag: 'finalized' }));
        const r = releaseTuple.parse(await c.pub.readContract({ address: vault.address, abi: demo.ProtectedVault.abi,
          functionName: 'releases', args: [messageId], blockNumber: head.number }));
        const checked = blockHeaderSchema.parse(await c.pub.getBlock({ blockNumber: head.number }));
        if (checked.number !== head.number || checked.hash !== head.hash) throw new Error('Finalized terminal-state block changed while reading.');
        return r[0].toLowerCase() === expected.recipient.toLowerCase() && r[1] === expected.amount && r[2] === expected.state;
      },
    }, d.routeId);
    return { store, sender, watcher, tick: async () => {
      clock = Number((await c.pub.getBlock()).timestamp); return operator.tick();
    }, close: () => store.close() };
  } catch (error) { store.close(); throw error; }
}
