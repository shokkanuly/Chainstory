import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keccak256, parseTransaction, toHex, type Hex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { Attestor, type GuardianPort } from '../attest.js';
import { MemoryFeed, type BurnEvent, type ReleaseEvent } from '../events.js';
import { ReleaseOperator, ReleaseState, type ReleaseOperatorOptions, type ReleaseStatus, type ReleasePort } from '../operator.js';
import { ReleaseDecision, releaseDecision } from '../review.js';
import { DurableSender, type TransactionPort } from '../sender.js';
import { OperatorStore, type TransactionRequest } from '../store.js';
import { Watcher, type WatcherConfig } from '../watch.js';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.reverse()) cleanup(); cleanups.length = 0; });
function fixture(extra: Partial<WatcherConfig> = {}, protection?: GuardianPort) {
  const dir = mkdtempSync(join(tmpdir(), 'tripwire-queue-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.sqlite');
  const scope = { route: 'route', chainId: 31337, sourceChainId: 31337, source: actors.owner.address,
    vault: actors.bridge.address, guardian: actors.oracle.address, token: actors.relayer.address, decimals: 6, sender: actors.owner.address };
  const open = () => { const store = new OperatorStore(path, scope); cleanups.push(() => store.close()); return store; };
  const store = open(); const ingress = new MemoryFeed<BurnEvent>(); const egress = new MemoryFeed<ReleaseEvent>();
  const release = { messageId: keccak256(toHex('queue')), recipient: actors.bridge.address.toLowerCase() as Hex, amount: 40_000n * 10n ** 6n, timestamp: 1_780_000_000 };
  ingress.emit({ messageId: release.messageId, amount: release.amount, timestamp: release.timestamp }); egress.emit(release);
  let state: ReleaseStatus = { recipient: release.recipient, amount: release.amount, state: ReleaseState.PENDING, nonce: 0n };
  let nonce = 0;
  const request = (data: Hex): TransactionRequest => ({ to: scope.vault, data, value: '0' });
  const txPort: TransactionPort = { finalityMode: 'local', chainId: 31337, sender: actors.owner.address,
    prepare: (r) => actors.owner.signTransaction({ chainId: 31337, type: 'eip1559', nonce: nonce++, gas: 100_000n,
      maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, to: r.to as Hex, data: r.data as Hex, value: BigInt(r.value) }),
    broadcast: async (raw) => {
      const data = parseTransaction(raw).data;
      if (data === '0xfe') state = { ...state, state: ReleaseState.REJECTED, payment: state.payment ? { ...state.payment, returned: true } : undefined };
      else if (data === '0xff') state = { ...state, state: ReleaseState.EXECUTED };
      else state = { ...state, nonce: state.nonce + 1n, state: data === '0x00' ? ReleaseState.VERIFIED : data === '0x01' ? ReleaseState.HELD : ReleaseState.REJECTED,
        ...(state.payment && data === '0x00' ? { payment: { ...state.payment, reviewedVersion: state.payment.version } } : {}) };
      return keccak256(raw);
    }, receipt: async () => null, waitReceipt: async () => ({ status: 'success', blockNumber: 100n, gasUsed: 50_000n }) };
  const canExecute = vi.fn().mockResolvedValue(true);
  const releasePort: ReleasePort = { read: async () => state,
    review: async (o, _nonce, decision = releaseDecision(o)) => request(toHex(decision, { size: 1 })),
    execute: () => request('0xff'), returnCredit: () => request('0xfe'), canExecute, terminalFinalized: async () => true };
  const cfg = (s: OperatorStore): WatcherConfig => ({ route: scope.route, chain: 'base', token: 'USDC', decimals: 6,
    bridge: scope.vault, store: s, ingress, egress, now: () => release.timestamp,
    baseline: { route: scope.route, computedAt: release.timestamp, windowHours: 24, sampleSize: 100, medianTransferUsd: 10_000, p95TransferUsd: 100_000, rollingTvlUsd: 40_000_000 },
    screening: { isFlagged: () => false, describe: () => undefined },
    verifySource: async (_r, burned) => burned === null ? { status: 'pending', reason: 'Missing backing.' } : { status: 'verified', amount: burned }, ...extra });
  const protectionSubmit = vi.fn().mockResolvedValue({ ok: true });
  const make = (s: OperatorStore, opts?: ReleaseOperatorOptions) => new ReleaseOperator(new Watcher(cfg(s)), new DurableSender(s, txPort),
    new Attestor(actors.oracle, protection ?? { address: scope.guardian, chainId: 31337, currentTier: async () => 0, submitAttestation: protectionSubmit }, { now: () => release.timestamp }), releasePort, keccak256(toHex(scope.route)), opts);
  return { store, open, make, operator: make(store), releasePort, release, txPort, canExecute, protectionSubmit,
    setState: (s: Partial<ReleaseStatus>) => { state = { ...state, ...s }; } };
}

describe('durable release queue', () => {
  const payment = () => ({ version: 1n, hash: toHex(1, { size: 32 }), reviewedVersion: 1n, returnAt: 0n, returned: false, now: 100n, blockers: [] });
  it.each(['paused', 'recipient', 'amount', 'approval'] as const)('holds a customer %s gate instead of treating clean risk as permission', async (gate) => {
    const f = fixture(); f.setState({ payment: { ...payment(), blockers: [gate] } });
    const review = vi.spyOn(f.releasePort, 'review');
    expect((await f.operator.tick())[0].action).toBe('held'); expect(review).not.toHaveBeenCalled(); expect(f.store.transactions()).toEqual([]);
  });
  it('revokes an old ALLOW when customer permissions are revoked', async () => {
    const f = fixture(); f.setState({ state: ReleaseState.VERIFIED, payment: { ...payment(), blockers: ['recipient'] } });
    expect((await f.operator.tick())[0].action).toBe('held'); expect(f.store.transactions()[0].request.data).toBe('0x01');
  });
  it('refreshes a review after a policy change even during an old customer delay', async () => {
    const f = fixture(); f.setState({ state: ReleaseState.VERIFIED, payment: { ...payment(), version: 2n }, delay: { now: 100n, until: 200n } });
    f.canExecute.mockResolvedValue(false); const review = vi.spyOn(f.releasePort, 'review');
    expect((await f.operator.tick())[0].action).toBe('delayed'); expect(review).toHaveBeenCalledTimes(1);
  });
  it('keeps a funded rejection available for a later customer return', async () => {
    const f = fixture(); f.setState({ state: ReleaseState.REJECTED, payment: payment() });
    expect((await f.operator.tick())[0].action).toBe('rejected'); expect(f.store.loadWatcher()?.pending).toHaveLength(1);
    f.setState({ payment: { ...payment(), returnAt: 100n } });
    expect((await f.operator.tick())[0].action).toBe('returned'); expect(f.store.loadWatcher()?.pending).toEqual([]);
  });
  it('waits for customer recovery maturity across restart without signing reviews', async () => {
    const f = fixture(); f.setState({ payment: { ...payment(), returnAt: 200n } });
    const review = vi.spyOn(f.releasePort, 'review');
    expect((await f.operator.tick())[0].action).toBe('return-pending'); f.store.close(); const store = f.open();
    expect((await f.make(store).tick())[0].action).toBe('return-pending'); expect(review).not.toHaveBeenCalled();
    f.setState({ payment: { ...payment(), now: 200n, returnAt: 200n } });
    expect((await f.make(store).tick())[0].action).toBe('returned'); expect(store.transactions()).toHaveLength(1);
    expect(store.transactions()[0].id).toContain('return/');
    expect(store.outcomes()).toEqual([{ messageId: f.release.messageId, action: 'returned', recipient: f.release.recipient, amount: f.release.amount }]);
    store.close(); const reopened = f.open(); expect(reopened.outcomes()[0].action).toBe('returned');
  });
  it('requires finalized returned state before acknowledgment', async () => {
    const f = fixture(); f.setState({ payment: { ...payment(), returnAt: 100n } });
    f.releasePort.terminalFinalized = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    expect((await f.operator.tick())[0].action).toBe('retry'); expect(f.store.loadWatcher()?.pending).toHaveLength(1);
    expect((await f.operator.tick())[0].action).toBe('returned'); expect(f.store.transactions()).toHaveLength(1);
  });
  it('does not initiate returns, complete unverified claims or turn customer recovery into a payout', async () => {
    const f = fixture({ verifySource: undefined }); f.setState({ payment: { ...payment(), returnAt: 100n } });
    expect((await f.operator.tick())[0].action).toBe('held'); expect(f.store.transactions()).toEqual([]);
  });
  it('can return while behavioral assessment is held without escalating or consulting guardian protection', async () => {
    const f = fixture({ screening: { isFlagged: () => true, describe: () => 'Fixture' } });
    f.setState({ payment: { ...payment(), returnAt: 100n, blockers: ['paused'] } });
    expect((await f.operator.tick())[0].action).toBe('returned'); expect(f.protectionSubmit).not.toHaveBeenCalled();
  });
  it('waits for finalized terminal state before acknowledging an external execution', async () => {
    const f = fixture(); f.setState({ state: ReleaseState.EXECUTED });
    f.releasePort.terminalFinalized = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    expect((await f.operator.tick())[0].action).toBe('retry'); expect(f.store.loadWatcher()?.pending).toHaveLength(1);
    expect((await f.operator.tick())[0].action).toBe('executed'); expect(f.store.loadWatcher()?.pending).toEqual([]);
  });
  it('does not replay signed work or touch the vault after a source finality conflict', async () => {
    const f = fixture();
    vi.spyOn(f.releasePort, 'read').mockImplementation(() => { throw new Error('must not read or act'); });
    // A restored quarantine must stop before sender recovery or any vault action.
    const state = { ingressCursor: '0', egressCursor: '0', burns: [], pending: [f.release], completed: [], conflictingBurns: [], conflictingReleases: [], history: [], quarantine: 'Finalized source block changed' };
    f.store.saveWatcher(state);
    const request = { to: f.release.recipient, data: '0x00', value: '0' };
    const raw = await f.txPort.prepare(request); f.store.saveTransaction({ id: 'review/pending', request, raw, hash: keccak256(raw), status: 'signed' });
    const broadcast = vi.spyOn(f.txPort, 'broadcast');
    expect((await f.make(f.store).tick())[0].action).toBe('held'); expect(f.store.transactions()[0].status).toBe('signed');
    expect(broadcast).not.toHaveBeenCalled();
  });
  it('can consciously retry a finalized reverted review instead of caching its failure forever', async () => {
    const f = fixture(); f.txPort.waitReceipt = vi.fn().mockResolvedValueOnce({ status: 'reverted', blockNumber: 100n, gasUsed: 50_000n })
      .mockResolvedValue({ status: 'success', blockNumber: 101n, gasUsed: 50_000n });
    expect((await f.operator.tick())[0].action).toBe('retry'); f.setState({ state: ReleaseState.PENDING, nonce: 0n });
    expect((await f.operator.tick())[0].action).toBe('executed');
    expect(f.store.transactions().filter((t) => t.id.startsWith('review/'))).toHaveLength(2);
  });

  it('escalates route protection for a high-risk held request even when the vault is already pending', async () => {
    const f = fixture({ screening: { isFlagged: () => true, describe: () => 'Recorded flagged recipient' } });
    expect((await f.operator.tick())[0].action).toBe('held');
    expect(f.protectionSubmit).toHaveBeenCalledTimes(1);
    expect(f.store.loadWatcher()?.pending).toHaveLength(1);
  });
  it('keeps HOLD requests across restart without submitting or acknowledging them', async () => {
    const f = fixture({ verifySource: undefined }); expect((await f.operator.tick())[0].action).toBe('held');
    f.store.close(); const restored = f.open(); expect((await f.make(restored).tick())[0].action).toBe('held');
    expect(restored.transactions()).toEqual([]); expect(restored.loadWatcher()?.pending).toHaveLength(1);
  });
  it('revokes a previous ALLOW when independent source evidence becomes unavailable', async () => {
    const f = fixture({ verifySource: undefined }); f.setState({ state: ReleaseState.VERIFIED });
    expect((await f.operator.tick())[0].action).toBe('held');
    expect(f.store.transactions()[0].request.data).toBe(toHex(ReleaseDecision.HOLD, { size: 1 }));
    expect(f.store.loadWatcher()?.pending).toHaveLength(1);
  });
  it('keeps a guardian-delayed request pending and executes it after restart when protection permits', async () => {
    const f = fixture(); f.canExecute.mockResolvedValueOnce(false);
    expect((await f.operator.tick())[0].action).toBe('delayed'); expect(f.store.loadWatcher()?.pending).toHaveLength(1);
    f.store.close(); const restored = f.open(); expect((await f.make(restored).tick())[0].action).toBe('executed');
    expect(restored.loadWatcher()?.pending).toEqual([]); expect(await f.make(restored).tick()).toEqual([]);
  });
  it('waits through a sticky delay across restart without review churn, then freshly reviews at maturity', async () => {
    const f = fixture(); const now = BigInt(f.release.timestamp), until = now + 1800n;
    f.setState({ state: ReleaseState.VERIFIED, nonce: 1n, delay: { now, until } });
    const review = vi.spyOn(f.releasePort, 'review');
    expect((await f.operator.tick())[0].action).toBe('delayed'); expect(review).not.toHaveBeenCalled();
    f.store.close(); const restored = f.open(); const operator = f.make(restored);
    expect((await operator.tick())[0].action).toBe('delayed'); expect(restored.transactions()).toEqual([]);
    f.setState({ delay: { now: until, until } });
    expect((await operator.tick())[0].action).toBe('executed'); expect(review).toHaveBeenCalledTimes(1);
    expect(restored.loadWatcher()?.pending).toEqual([]);
  });
  it('revokes ALLOW during a sticky delay as soon as source evidence becomes unavailable', async () => {
    const f = fixture({ verifySource: undefined });
    f.setState({ state: ReleaseState.VERIFIED, delay: { now: 100n, until: 200n } });
    expect((await f.operator.tick())[0].action).toBe('held');
    expect(f.store.transactions()[0].request.data).toBe('0x01'); expect(f.store.loadWatcher()?.pending).toHaveLength(1);
  });
  it('refuses malformed delay state before reviewing or acknowledging a request', async () => {
    const f = fixture(); f.setState({ state: ReleaseState.VERIFIED, delay: { now: -1n, until: 200n } });
    await expect(f.operator.tick()).rejects.toThrow(); expect(f.store.transactions()).toEqual([]);
    expect(f.store.loadWatcher()?.pending).toHaveLength(1);
  });
  it('reconciles an executed payout after acknowledgment commit failed without executing again', async () => {
    const f = fixture(); const save = f.store.saveWatcher.bind(f.store);
    vi.spyOn(f.store, 'saveWatcher').mockImplementation((s) => { if (s.completed.length) throw new Error('Disk full'); save(s); });
    await expect(f.operator.tick()).rejects.toThrow('Disk full'); f.store.close(); const restored = f.open();
    expect((await f.make(restored).tick())[0].action).toBe('executed');
    expect(restored.transactions().filter((t) => t.id.startsWith('execute/'))).toHaveLength(1);
  });
  // Policy v4 (CRIT-2): REJECT is a 7-day hold, not an end. The request stays queued and unpaid.
  it('keeps a rejected release queued through its hold and never reviews it again while the proof is still invalid', async () => {
    const f = fixture({ verifySource: async () => ({ status: 'invalid', reason: 'Invalid independent proof.' }) });
    expect((await f.operator.tick())[0]).toMatchObject({ action: 'rejected' }); expect(f.store.loadWatcher()?.pending).toHaveLength(1);
    f.setState({ rejection: { now: 100n, until: 200n } });
    expect((await f.operator.tick())[0]).toMatchObject({ action: 'rejected', reason: expect.stringContaining('after 200') });
    f.setState({ rejection: { now: 200n, until: 200n } });
    expect((await f.operator.tick())[0].action).toBe('rejected');
    expect(f.store.transactions().filter((t) => t.id.startsWith('review/'))).toHaveLength(1);
    expect(f.store.transactions().some((t) => t.id.startsWith('execute/'))).toBe(false);
  });
  it('reopens a rejected release after its hold only when fresh evidence passes, then pays its own recipient', async () => {
    let proven = false;
    const f = fixture({ verifySource: async (_r, burned) => proven && burned !== null
      ? { status: 'verified', amount: burned } : { status: 'invalid', reason: 'Source adapter misread the proof.' } });
    expect((await f.operator.tick())[0].action).toBe('rejected');
    proven = true; f.setState({ rejection: { now: 100n, until: 200n } });
    expect((await f.operator.tick())[0].action).toBe('rejected'); // still inside the hold
    f.setState({ rejection: { now: 200n, until: 200n } });
    expect((await f.operator.tick())[0].action).toBe('executed');
    expect(f.store.transactions().map((t) => t.id)).toEqual([`review/${f.release.messageId}/1`, `review/${f.release.messageId}/2`, `execute/${f.release.messageId}/2`]);
    expect(f.store.loadWatcher()?.pending).toEqual([]);
  });
  it('treats a REJECT as held forever when the port cannot say when its hold ends', async () => {
    const f = fixture(); f.setState({ state: ReleaseState.REJECTED, nonce: 1n });
    expect((await f.operator.tick())[0]).toMatchObject({ action: 'rejected', reason: expect.stringContaining('never') });
    expect(f.store.transactions()).toEqual([]);
  });
  it('refuses a different on-chain recipient before any review or payout', async () => {
    const f = fixture(); f.setState({ recipient: actors.owner.address });
    await expect(f.operator.tick()).rejects.toThrow('does not match'); expect(f.store.transactions()).toEqual([]);
  });
  function continuousFixture() {
    let now = 1_780_000_000n, expiresAt = 0n, tier = 0;
    let flagged: boolean | null = true;
    const submit = vi.fn(async () => { tier = 3; expiresAt = now + 86400n; return { ok: true }; });
    const snapshot = vi.fn(async () => ({ tier, expiresAt, limit: now + 259_200n, now, oracle: actors.oracle.address, configured: true }));
    const port: GuardianPort = { address: actors.oracle.address, chainId: 31337, currentTier: async () => tier,
      protectionState: snapshot, submitAttestation: submit };
    const f = fixture({ now: () => Number(now), screening: { isFlagged: () => flagged, describe: () => 'Recorded screening fixture' } }, port);
    return { ...f, port, snapshot, submit, advance: (seconds: bigint) => { now += seconds; }, setFlag: (value: boolean | null) => { flagged = value; } };
  }
  it('renews persistent risk for a durably held release after restart before the original protection expires', async () => {
    const f = continuousFixture(); expect((await f.operator.tick())[0].action).toBe('held'); expect(f.submit).toHaveBeenCalledTimes(1);
    f.advance(86400n - 3600n); f.store.close(); const restored = f.open(); const operator = f.make(restored);
    expect((await operator.tick())[0].action).toBe('held'); expect(f.submit).toHaveBeenCalledTimes(2);
    expect((await operator.tick())[0].action).toBe('held'); expect(f.submit).toHaveBeenCalledTimes(2);
    expect(restored.loadWatcher()?.pending).toHaveLength(1); expect(restored.transactions()).toEqual([]);
  });
  it('retains the queue and blocks review/payout when guardian reconciliation is unavailable', async () => {
    const port: GuardianPort = { address: actors.oracle.address, chainId: 31337, currentTier: async () => 0,
      protectionState: async () => { throw new Error('RPC unavailable'); }, submitAttestation: vi.fn() };
    const f = fixture({ screening: { isFlagged: () => true, describe: () => 'Fixture' } }, port);
    const review = vi.spyOn(f.releasePort, 'review');
    expect((await f.operator.tick())[0].action).toBe('retry'); expect(review).not.toHaveBeenCalled();
    expect(port.submitAttestation).not.toHaveBeenCalled(); expect(f.store.loadWatcher()?.pending).toHaveLength(1);
  });
  it('reassesses risk instead of replaying a stale high score after screening becomes unavailable', async () => {
    const f = continuousFixture(); await f.operator.tick(); f.advance(86400n - 3600n); f.setFlag(null);
    expect((await f.operator.tick())[0].action).toBe('held'); expect(f.submit).toHaveBeenCalledTimes(1);
    expect(f.store.loadWatcher()?.pending).toHaveLength(1);
  });
  it('does not renew route protection from a quarantined restored queue', async () => {
    const f = continuousFixture(); await f.operator.tick(); f.advance(86400n - 3600n);
    f.store.saveWatcher({ ...f.store.loadWatcher()!, quarantine: 'Finalized source history changed' });
    f.snapshot.mockClear();
    expect((await f.make(f.store).tick())[0].action).toBe('held'); expect(f.submit).toHaveBeenCalledTimes(1); expect(f.snapshot).not.toHaveBeenCalled();
  });

  // HIGH-1: a stuck review must not hold back route protection, which has its own relayer lane.
  async function stuckLane(f: ReturnType<typeof fixture>) {
    const request = { to: f.release.recipient, data: '0x00', value: '0' };
    const raw = await f.txPort.prepare(request); f.store.saveTransaction({ id: 'review/stuck', request, raw, hash: keccak256(raw), status: 'signed' });
    // Underpriced: nodes keep it pending and nothing lands on chain.
    f.txPort.broadcast = vi.fn(async (bytes: Hex) => keccak256(bytes));
    f.txPort.waitReceipt = vi.fn().mockRejectedValue(new Error('WaitForTransactionReceiptTimeoutError'));
  }
  it('still submits route protection while the release lane is stuck', async () => {
    const f = fixture({ screening: { isFlagged: () => true, describe: () => 'Recorded flagged recipient' } }); await stuckLane(f);
    expect((await f.operator.tick())[0].action).toBe('held'); expect(f.protectionSubmit).toHaveBeenCalledTimes(1);
  });
  it('keeps a payout waiting while the release lane is stuck, and says why', async () => {
    const f = fixture(); await stuckLane(f); const review = vi.spyOn(f.releasePort, 'review');
    expect((await f.operator.tick())[0]).toMatchObject({ action: 'retry', reason: expect.stringContaining('Release transactions are blocked') });
    expect(review).not.toHaveBeenCalled(); expect(f.store.transactions()).toHaveLength(1);
  });
  it('turns a failed attestation into a retry instead of failing the whole tick', async () => {
    const port: GuardianPort = { address: actors.oracle.address, chainId: 31337, currentTier: async () => 0,
      submitAttestation: vi.fn().mockRejectedValue(new Error('attestation relayer cannot pay')) };
    const f = fixture({ screening: { isFlagged: () => true, describe: () => 'Fixture' } }, port);
    expect((await f.operator.tick())[0]).toMatchObject({ action: 'retry', reason: expect.stringContaining('cannot pay') });
    expect(f.store.transactions()).toEqual([]);
  });
  it('re-checks held releases on a doubling interval when configured, and sleeps through a REJECT hold', async () => {
    let now = 1_780_000_000;
    const f = fixture({ verifySource: undefined, now: () => now });
    const operator = f.make(f.store, { heldBackoff: { initial: 30, max: 60 } });
    expect((await operator.tick())[0].action).toBe('held');
    expect(await operator.tick()).toEqual([]); // snoozed for 30 s
    now += 30; expect((await operator.tick())[0].action).toBe('held');
    now += 30; expect(await operator.tick()).toEqual([]); // now 60 s
    now += 30; expect((await operator.tick())[0].action).toBe('held');
    f.setState({ state: ReleaseState.REJECTED, nonce: 1n, rejection: { now: 0n, until: 7n * 86400n } });
    now += 60; expect((await operator.tick())[0].action).toBe('rejected');
    now += 7 * 86400 - 1; expect(await operator.tick()).toEqual([]);
    now += 1; expect((await operator.tick())[0].action).toBe('rejected');
    expect(() => f.make(f.store, { heldBackoff: { initial: 0, max: 60 } })).toThrow('whole seconds');
  });
});
