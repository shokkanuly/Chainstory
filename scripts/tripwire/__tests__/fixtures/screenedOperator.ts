// End-to-end screened operator fixture (H4c3b, ADR-048): the compiled
// CctpScreenedPaymentEscrow in the in-process EVM, driven by the real
// ReleaseOperator, Watcher, DurableSender, Attestor and ScreeningGate. Reviews
// and relays are really signed and journaled; the local transaction port
// executes each signed call against the EVM once. Synthetic keys and issuer only.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFunctionData, encodeFunctionData, keccak256, parseTransaction, toHex, type Hex, type PrivateKeyAccount } from 'viem';
import { actors, LOCAL_CHAIN_ID } from '../../../../src/tripwire/guardianVM.js';
import { ResponseTier } from '../../../../src/tripwire/onChain.js';
import { screeningHeadHash, screeningPaymentContextHash, screeningReceiptHash } from '../../../../src/chains/evm/screening.js';
import { Attestor, type GuardianPort } from '../../attest.js';
import { DRAIN_CONTRACT_FACTS } from '../../attack.js';
import { MemoryFeed, type BurnEvent, type ReleaseEvent } from '../../events.js';
import { ReleaseOperator, type ReleasePort } from '../../operator.js';
import { ReleaseDecision } from '../../review.js';
import { ScreeningGate, screenedReviewRequest, type ScreeningFetch, type ScreeningProvider, type ScreeningRequest } from '../../screeningGate.js';
import { DurableSender, type ConfirmedReceipt, type TransactionPort } from '../../sender.js';
import { OperatorStore } from '../../store.js';
import { Watcher, type SourceEvidence } from '../../watch.js';
import { readPaymentState } from '../../testnet/paymentState.js';
import { LOCAL_PROFILE, NOT_LISTED, SCREENED_ROUTE, SCREENING_ISSUER, screenedLocalFixture } from '../../screenedLocal.js';

type ReleaseTuple = [Hex, bigint, number, bigint, Hex, bigint, number];
const wire = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]));

export async function screenedOperatorFixture() {
  const f = await screenedLocalFixture({ register: false });
  const { vm, vault, id } = f;
  const dir = mkdtempSync(join(tmpdir(), 'tripwire-screened-operator-'));
  const path = join(dir, 'operator.sqlite');
  const [recipient, amount] = await vm.readContract<ReleaseTuple>(vault, 'releases', [id]);
  const release = { messageId: id, recipient: recipient.toLowerCase() as Hex, amount, timestamp: Number(vm.now) };
  const ingress = new MemoryFeed<BurnEvent>(), egress = new MemoryFeed<ReleaseEvent>();
  ingress.emit({ messageId: id, amount, timestamp: release.timestamp }); egress.emit(release);

  // --- knobs the tests turn ---
  const knobs = {
    baseline: true,
    /** A tiny baseline and an unverified, day-old upgradeable recipient: high heuristic indicators. */
    outlier: false,
    source: 'verified' as SourceEvidence['status'],
    crash: null as 'before' | 'after' | null,
    /** False: the execution dry run fails, so an included ALLOW stays VERIFIED. */
    executable: true,
    answer: (async () => ({ status: 'missing' })) as (request: ScreeningRequest) => Promise<ScreeningFetch>,
  };

  // --- issuer-signed evidence over the H4c2 digests ---
  const signedHead = async (over: Parameters<typeof f.headFields>[0] = {}, signer: PrivateKeyAccount = SCREENING_ISSUER) => {
    const head = f.headFields(over), hash = screeningHeadHash(f.scope, head);
    return { head, hash, envelope: { version: 1, head: wire(head), signature: await signer.sign({ hash }) } };
  };
  const signedReceipt = async (headHash: Hex, over: Partial<{ outcome: 0 | 1 | 2; checkedAt: bigint; validUntil: bigint; paymentContextHash: Hex }> = {},
    signer: PrivateKeyAccount = SCREENING_ISSUER) => {
    const receipt = { profileHash: f.profileHash(), headHash, paymentContextHash: over.paymentContextHash ?? screeningPaymentContextHash(await f.context()),
      outcome: over.outcome ?? NOT_LISTED, checkedAt: over.checkedAt ?? vm.now, validUntil: over.validUntil ?? vm.now + 300n };
    const hash = screeningReceiptHash(f.scope, receipt);
    return { receipt, hash, envelope: { version: 1, receipt: wire(receipt), signature: await signer.sign({ hash }) } };
  };
  /** The provider answers with `head` (default: revision 1 now) and one receipt per outcome. */
  const answerWith = async (outcomes: (0 | 1 | 2)[], head?: Awaited<ReturnType<typeof signedHead>>) => {
    const h = head ?? await signedHead();
    const receipts = await Promise.all(outcomes.map(async (outcome) => (await signedReceipt(h.hash, { outcome })).envelope));
    knobs.answer = async () => ({ status: 'available', head: h.envelope, receipts });
    return h;
  };
  const provider: ScreeningProvider & { requests: ScreeningRequest[] } = {
    requests: [], fetch: async (request) => { provider.requests.push(request); return knobs.answer(request); },
  };

  // --- one local block per write; reads are coherent within a block ---
  let height = 100n;
  const header = () => ({ number: height, hash: keccak256(toHex(height)), parentHash: keccak256(toHex(height - 1n)), timestamp: vm.now });
  const read = (messageId: Hex) => readPaymentState({ getBlock: async () => header(), minimumBlock: () => 0n,
    read: (name, _block, args) => vm.readContract(vault, name, args ?? []) }, messageId, undefined, 'latest',
  { scope: f.scope, profile: f.profileFor(LOCAL_PROFILE), readOracle: () => vm.read('oracle') });

  const receipts = new Map<Hex, ConfirmedReceipt>();
  const calls: { functionName: string; ok: boolean; error?: string; raw: Hex }[] = [];
  let txNonce = 0;
  const txPort: TransactionPort = { finalityMode: 'local', chainId: LOCAL_CHAIN_ID, sender: actors.relayer.address,
    prepare: (r) => actors.relayer.signTransaction({ chainId: LOCAL_CHAIN_ID, type: 'eip1559', nonce: txNonce++, gas: 3_000_000n,
      maxFeePerGas: 10n, maxPriorityFeePerGas: 1n, to: r.to as Hex, data: r.data as Hex, value: BigInt(r.value) }),
    broadcast: async (raw) => {
      if (knobs.crash === 'before') { knobs.crash = null; throw new Error('Synthetic crash before broadcast'); }
      const hash = keccak256(raw);
      if (!receipts.has(hash)) { // The same signed bytes never execute twice.
        const call = decodeFunctionData({ abi: vault.abi, data: parseTransaction(raw).data as Hex });
        const result = await vm.sendContract(vault, actors.relayer, call.functionName, call.args ?? []);
        height += 1n;
        receipts.set(hash, { status: result.ok ? 'success' : 'reverted', blockNumber: height, gasUsed: result.gas });
        calls.push({ functionName: call.functionName, ok: result.ok, error: result.error, raw });
      }
      if (knobs.crash === 'after') { knobs.crash = null; throw new Error('Synthetic crash after broadcast'); }
      return hash;
    },
    receipt: async (hash) => receipts.get(hash) ?? null,
    waitReceipt: async (hash) => { const r = receipts.get(hash); if (!r) throw new Error('Not mined'); return r; },
  };

  const attestations: unknown[] = [];
  let attestationNonce = 0n;
  const guardianPort: GuardianPort = { address: vm.address, chainId: LOCAL_CHAIN_ID,
    currentTier: async (routeId) => Number(await vm.read<number>('currentTier', [routeId])) as ResponseTier,
    submitAttestation: async (a, signature) => vm.send(actors.bridge, 'submitAttestation', [a.routeId, a.riskScore, a.validUntil, a.nonce, signature]) };

  const scope = { route: 'local-screened', chainId: LOCAL_CHAIN_ID, sourceChainId: LOCAL_CHAIN_ID, source: actors.owner.address,
    vault: vault.address, guardian: vm.address, token: f.token.address, decimals: 6, sender: actors.relayer.address };
  const open = (opts: { gate?: boolean } = {}) => {
    const store = new OperatorStore(path, scope);
    const sender = new DurableSender(store, txPort);
    const watcher = new Watcher({ route: scope.route, chain: 'base', token: 'USDC', decimals: 6, bridge: vault.address, store, ingress, egress,
      now: () => Number(vm.now),
      baseline: (_samples, now) => knobs.baseline ? { route: scope.route, computedAt: now, windowHours: 24, sampleSize: 100,
        medianTransferUsd: knobs.outlier ? 0.000_001 : 10_000, p95TransferUsd: knobs.outlier ? 0.000_01 : 100_000,
        rollingTvlUsd: knobs.outlier ? 1 : 40_000_000 } : null,
      screening: { isFlagged: () => false, describe: () => undefined },
      contractFacts: async (address) => knobs.outlier ? { ...DRAIN_CONTRACT_FACTS, address } : null,
      verifySource: async (_r, burned) => knobs.source === 'verified' && burned !== null ? { status: 'verified', amount: burned }
        : knobs.source === 'invalid' ? { status: 'invalid', reason: 'Synthetic source proves no burn.' } : { status: 'pending', reason: 'Synthetic source pending.' } });
    const attestor = new Attestor(actors.oracle, guardianPort, { now: () => Number(vm.now), nextNonce: () => ++attestationNonce });
    const handle = attestor.handle.bind(attestor);
    attestor.handle = (routeId, assessment) => { attestations.push(assessment); return handle(routeId, assessment); };
    const gate = new ScreeningGate({ store, sender, provider, scope: f.scope, profile: f.profileFor(LOCAL_PROFILE), read });
    const port: ReleasePort = {
      read,
      review: async (observation, nonce, decision = ReleaseDecision.HOLD, screening) => screenedReviewRequest({ signer: actors.oracle,
        chainId: LOCAL_CHAIN_ID, routeId: SCREENED_ROUTE, token: f.token.address, state: await read(observation.release.messageId),
        observation, nonce, decision, screening }),
      canExecute: async (messageId) => knobs.executable && (await vm.simulateContract(vault, actors.relayer, 'executeRelease', [messageId])).ok,
      execute: (messageId) => ({ to: vault.address, value: '0', data: encodeFunctionData({ abi: vault.abi, functionName: 'executeRelease', args: [messageId] }) }),
      returnCredit: (messageId) => ({ to: vault.address, value: '0', data: encodeFunctionData({ abi: vault.abi, functionName: 'executeReturn', args: [messageId] }) }),
      terminalFinalized: async () => true,
    };
    const operator = new ReleaseOperator(watcher, sender, attestor, port, SCREENED_ROUTE, opts.gate === false ? {} : { screening: gate });
    return { store, operator, sender, close: () => store.close() };
  };

  /** Customer consent to advisory mode through the one-day queue (S23/S27). */
  const consentAdvisory = async () => {
    const scheduled = await vm.sendContract(vault, actors.owner, 'scheduleExecutionMode', [1]);
    vm.warp(86_400n);
    const applied = await vm.sendContract(vault, actors.relayer, 'applyExecutionMode', [1]);
    if (!scheduled.ok || !applied.ok) throw new Error(`Advisory consent failed: ${scheduled.error ?? applied.error}`);
  };
  /** The customer re-approves an intent committed under an older policy, as for any policy change. */
  const approve = async () => {
    const approved = await vm.sendContract(vault, actors.owner, 'approvePayment', [id]);
    if (!approved.ok) throw new Error(`Approval failed: ${approved.error}`);
  };
  const balance = (who: Hex) => vm.readContract<bigint>(f.token, 'balanceOf', [who]);
  const state = async () => (await vm.readContract<ReleaseTuple>(vault, 'releases', [id]))[2];
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return { ...f, release, knobs, provider, signedHead, signedReceipt, answerWith, open, calls, attestations, consentAdvisory, approve, balance, state, read, cleanup };
}
