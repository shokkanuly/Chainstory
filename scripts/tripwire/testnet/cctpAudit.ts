// Shared finalized audit for the one-shot verifier and keyless pilot observer.
import { keccak256, stringToHex, type Hex } from 'viem';
import { z } from 'zod';
import { cctpAddressSchema } from '../../../src/chains/evm/cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { CctpSourceAdapter, cctpVerifierScope, type CctpPolicy, type CctpRpc } from '../cctp.js';
import { blockHeaderSchema, FinalityConflictError } from '../finality.js';
import { OperatorStore } from '../store.js';
import type { SourceEvidence } from '../watch.js';
import { assertCctpEscrowBindings, assertCctpPaymentBindings } from './cctpBindings.js';
import { parseAuditManifest, type CctpManifest } from './cctpManifest.js';
import { assertProtectionPolicy } from './protectionPolicy.js';
import { releaseTuple } from './releaseState.js';
import { readPaymentState, type PaymentStatus } from './paymentState.js';
import { assertPaymentRuntime } from './artifactAcceptance.js';
import { readPaymentLifecycle, type PaymentLifecycle } from './paymentLifecycle.js';
import { auditBoundary, CctpAuditFailure } from './cctpAuditFailure.js';

export interface CctpAuditReader extends CctpRpc {
  readPaymentEvents?(messageId: Hex, fromBlock: bigint, toBlock: bigint): Promise<unknown>;
  readCode?(address: Hex, blockNumber: bigint): Promise<unknown>;
  readVault(name: string, blockNumber: bigint, args?: readonly Hex[]): Promise<unknown>;
  readGuardian(name: 'owner' | 'oracle' | 'getRoute' | 'currentTier' | 'GUARDIAN_POLICY_VERSION' | 'isProtected',
    blockNumber: bigint, args?: readonly Hex[]): Promise<unknown>;
}
const stateNames = ['PENDING', 'VERIFIED', 'HELD', 'REJECTED', 'EXECUTED'] as const;
const tierNames = ['NONE', 'THROTTLE', 'DELAY', 'FREEZE'] as const;
const uint = z.bigint().nonnegative().max((1n << 256n) - 1n);
const routeState = z.object({ windowSeconds: uint, cap: uint, tierExpiresAt: uint });
export interface AuditResult {
  messageId: Hex; evidence: SourceEvidence;
  release?: { recipient: Hex; amount: bigint; state: typeof stateNames[number] | 'RETURNED'; reviewedUntil: bigint; delayUntil?: bigint };
  recommendation?: 'HOLD' | 'REJECT' | 'NONE'; reason?: string;
  payment?: PaymentStatus;
  lifecycle?: PaymentLifecycle;
  proof?: { sourceTransactionHash: Hex; destinationTransactionHash: Hex; sourceBlock: bigint; destinationBlock: bigint;
    sourceBlockHash: Hex; destinationBlockHash: Hex; operationId: Hex; returnRecipient: Hex; intentPolicyHash: Hex };
}
export interface AuditReport {
  version: 1; mode: 'observe' | 'audit'; policy: CctpPolicy; route: string;
  finalized: { number: bigint; hash: Hex; timestamp: bigint };
  scope: { manifestVersion: number; vault: Hex; guardian: Hex; operator: Hex };
  deployment?: { owner: Hex; oracle: Hex; rolesSeparated: boolean; operatorMatchesOracle: boolean;
    tier: typeof tierNames[number]; expiresAt: bigint; capBaseUnits: bigint; windowSeconds: bigint };
  counts: Record<SourceEvidence['status'], number>; results: AuditResult[];
  enforcement: false; blockers: string[];
}

export async function createCctpAudit(input: unknown, stateFile: string, source: CctpRpc,
  destination: CctpAuditReader, observe = false) {
  const manifest = await auditBoundary('configuration', () => parseAuditManifest(input, observe));
  const payment = manifest.version === 3 ? manifest.payment : undefined;
  const policy = manifest.version === 3 ? 'customer-payment' : manifest.version === 2 ? 'authenticated-escrow' : 'legacy-post-mint';
  const routeId = keccak256(stringToHex(route.id));
  const assertChains = async () => {
    if (await source.getChainId() !== route.source.chainId || await destination.getChainId() !== route.destination.chainId) {
      throw new CctpAuditFailure('deployment', new Error('RPC chain identity does not match the CCTP route.'));
    }
  };
  const validateDeployment = async (block: bigint) => {
    if (payment) {
      const readCode = destination.readCode;
      if (!readCode) throw new Error('Customer deployment requires exact runtime bytecode acceptance.');
      await assertPaymentRuntime(manifest.vault, manifest.guardian, payment, block,
        (address, number) => readCode(address, number));
      await assertCctpPaymentBindings(manifest.vault, payment, (name) => destination.readVault(name, block));
    }
    if (manifest.version === 2) await assertCctpEscrowBindings(manifest.vault,
      (name) => destination.readVault(name, block));
    await destination.readVault('MAX_REVIEW_TTL', block);
    for (const [name, expected] of [['token', route.destination.usdc], ['guardian', manifest.guardian], ['routeId', routeId]] as const) {
      const actual = await destination.readVault(name, block);
      if (typeof actual !== 'string' || actual.toLowerCase() !== expected) throw new Error(`Vault ${name} does not match the CCTP escrow deployment.`);
    }
    if (observe || payment) await assertProtectionPolicy({
      guardianVersion: () => destination.readGuardian('GUARDIAN_POLICY_VERSION', block),
      releaseVersion: () => destination.readVault('RELEASE_POLICY_VERSION', block),
      reviewFormat: () => destination.readVault('REVIEW_FORMAT_VERSION', block),
      routePermission: () => destination.readGuardian('isProtected', block, [manifest.vault, routeId]),
    }, payment ? 3 : 2);
  };
  const stable = async (head: z.infer<typeof blockHeaderSchema>, store?: OperatorStore) => {
    const checked = blockHeaderSchema.parse(await destination.getBlock({ blockNumber: head.number }));
    if (checked.number !== head.number || checked.hash !== head.hash || checked.timestamp !== head.timestamp) {
      const reason = 'Finalized CCTP escrow state block changed during audit.';
      store?.quarantineSource(reason); throw new FinalityConflictError(reason);
    }
  };
  await auditBoundary('internal', assertChains, true);
  const head = await auditBoundary('internal', async () => blockHeaderSchema.parse(await destination.getBlock({ blockTag: 'finalized' })), true);
  await auditBoundary('deployment', () => validateDeployment(head.number), true);
  await auditBoundary('internal', () => stable(head), true);
  const store = await auditBoundary('journal', () => new OperatorStore(stateFile, { route: route.id, sourceChainId: route.source.chainId,
    chainId: route.destination.chainId, source: route.source.transmitter, vault: manifest.vault,
    guardian: manifest.guardian, token: route.destination.usdc, sender: manifest.operator,
    decimals: route.decimals, finalityMode: 'finalized', sourceVerifier: cctpVerifierScope(manifest.vault, policy, payment) }));
  let active: CctpManifest = manifest;
  const adapter = new CctpSourceAdapter(store, manifest.vault, source, destination,
    async (id) => active.requests.find((r) => r.messageId === id)?.proof ?? null, policy, payment);
  const assertHealthy = () => {
    if (store.loadWatcher()?.quarantine || store.sourceQuarantine()) throw new CctpAuditFailure('quarantine', new Error('This operator is quarantined; reconcile it before auditing new proof claims.'));
  };
  try {
    await auditBoundary('journal', assertHealthy);
    await auditBoundary('internal', () => adapter.assertCanonical(), true);
  } catch (error) { store.close(); throw error; }
  let lock: Promise<unknown> = Promise.resolve();
  const poll = async (updated: unknown): Promise<AuditReport> => {
    const next = parseAuditManifest(updated, observe);
    if (next.version !== manifest.version || next.vault !== manifest.vault || next.guardian !== manifest.guardian || next.operator !== manifest.operator ||
      cctpVerifierScope(next.vault, policy, next.version === 3 ? next.payment : undefined).fingerprint !== adapter.scope.fingerprint) {
      throw new Error('Pilot manifest deployment scope changed; stop and reconcile before changing scope.');
    }
    active = next; assertHealthy(); await adapter.assertCanonical();
    const block = blockHeaderSchema.parse(await destination.getBlock({ blockTag: 'finalized' }));
    if (store.sourceProofs().some((proof) => proof.destination.blockNumber > block.number)) {
      throw new Error('Finalized CCTP state is behind previously authenticated settlement.');
    }
    // Recheck configurable roles/grants each poll. All report fields use this block.
    await auditBoundary('deployment', () => validateDeployment(block.number), true);
    const report: AuditReport = { version: 1, mode: observe ? 'observe' : 'audit', policy, route: route.id,
      scope: { manifestVersion: manifest.version, vault: manifest.vault, guardian: manifest.guardian, operator: manifest.operator },
      finalized: { number: block.number, hash: block.hash, timestamp: block.timestamp },
      counts: { verified: 0, pending: 0, unavailable: 0, invalid: 0 }, results: [], enforcement: false, blockers: [] };
    if (observe) {
      const owner = cctpAddressSchema.parse(await destination.readGuardian('owner', block.number));
      const oracle = cctpAddressSchema.parse(await destination.readGuardian('oracle', block.number));
      const state = routeState.parse(await destination.readGuardian('getRoute', block.number, [routeId]));
      const tier = z.number().int().min(0).max(3).parse(await destination.readGuardian('currentTier', block.number, [routeId]));
      if (state.windowSeconds === 0n || state.cap === 0n) throw new Error('Pilot route has no configured positive rolling budget.');
      report.deployment = { owner, oracle, rolesSeparated: owner !== oracle, operatorMatchesOracle: oracle === manifest.operator,
        tier: tierNames[tier], expiresAt: state.tierExpiresAt, capBaseUnits: state.cap, windowSeconds: state.windowSeconds };
      report.blockers.push('Behavioral risk policy is not configured: live baseline, pricing and recipient screening must be validated before enforcement.');
      if (owner === oracle) report.blockers.push('Guardian owner and oracle must use separate roles before enforcement.');
      if (oracle !== manifest.operator) report.blockers.push('Manifest operator does not match the guardian oracle.');
    }
    for (const request of active.requests) {
      let r: z.infer<typeof releaseTuple>; let delayUntil: bigint | undefined;
      try {
        r = releaseTuple.parse(await destination.readVault('releases', block.number, [request.messageId]));
        if (observe) delayUntil = uint.parse(await destination.readVault('releaseDelayUntil', block.number, [request.messageId]));
      } catch (error) {
        if (!observe) throw error;
        report.counts.unavailable++;
        report.results.push({ messageId: request.messageId, evidence: { status: 'unavailable', reason: 'Finalized payout state is unavailable or malformed.' },
          recommendation: 'HOLD', reason: 'Cannot independently read this payout. No authorization is produced.' });
        continue;
      }
      await stable(block, store);
      const evidence = await adapter.verify({ messageId: request.messageId, recipient: r[0], amount: r[1], timestamp: Number(block.timestamp) });
      const result: AuditResult = { messageId: request.messageId, evidence,
        release: { recipient: r[0], amount: r[1], state: stateNames[r[2]], reviewedUntil: r[3], ...(observe ? { delayUntil } : {}) } };
      if (payment) {
        const proof = evidence.status === 'verified' ? store.sourceProofs().find((p) => p.messageId === request.messageId) : undefined;
        if (proof?.payment) result.proof = { sourceTransactionHash: proof.source.transactionHash, destinationTransactionHash: proof.destination.transactionHash,
          sourceBlock: proof.source.blockNumber, destinationBlock: proof.destination.blockNumber, sourceBlockHash: proof.source.blockHash,
          destinationBlockHash: proof.destination.blockHash, operationId: proof.payment.operationId,
          returnRecipient: proof.payment.returnRecipient, intentPolicyHash: proof.payment.policyHash };
        const state = await readPaymentState({
          getBlock: async (args) => 'blockTag' in args ? block : destination.getBlock(args), minimumBlock: () => block.number,
          read: (name, number, args) => destination.readVault(name, number, args as readonly Hex[] | undefined),
        }, request.messageId, store.sourceProofs().find((p) => p.messageId === request.messageId), 'finalized');
        result.payment = state.payment;
        if (state.payment?.returned && result.release) result.release.state = 'RETURNED';
        if (observe && proof?.payment && state.payment && result.release) {
          try {
            result.lifecycle = await readPaymentLifecycle({ proof, source, destination, vault: manifest.vault,
              head: block, state: result.release.state, returnAt: state.payment.returnAt, recoveryDelay: payment.recoveryDelay });
          } catch (error) {
            if (error instanceof FinalityConflictError) store.quarantineSource(error.message);
            throw error;
          }
        }
      }
      if (observe) {
        result.recommendation = r[2] >= 3 ? 'NONE' : evidence.status === 'invalid' ? 'REJECT' : 'HOLD';
        result.reason = r[2] >= 3 ? 'Payout is already terminal on-chain; no new action is proposed.' : evidence.status === 'verified'
          ? 'Backing is verified. Behavioral risk policy is not configured; this is not an ALLOW decision.'
          : evidence.reason;
        if (result.payment?.returned) result.reason = 'Customer credit was returned; no further payout or return is proposed.';
        else if (result.payment && r[2] === 3) result.reason = 'Funded payment is rejected. The customer can still request its fixed-destination return.';
        else if (result.payment && result.payment.returnAt > 0n) result.reason = 'Customer requested return. Payout is blocked while recovery matures.';
      }
      report.results.push(result); report.counts[evidence.status]++;
    }
    await stable(block, store); await adapter.assertCanonical();
    return report;
  };
  return { store, close: () => store.close(), tick(updated: unknown = manifest): Promise<AuditReport> {
    const run = lock.then(() => poll(updated)); lock = run.catch(() => undefined); return run;
  } };
}
