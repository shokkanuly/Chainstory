import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keccak256, parseTransaction, toHex, type Hex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { Attestor, type GuardianPort } from '../attest.js';
import { MemoryFeed, type BurnEvent, type ReleaseEvent } from '../events.js';
import { ReleaseOperator, ReleaseState, type ReleaseStatus, type ReleasePort } from '../operator.js';
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
      if (data === '0xff') state = { ...state, state: ReleaseState.EXECUTED };
      else state = { ...state, nonce: state.nonce + 1n, state: data === '0x00' ? ReleaseState.VERIFIED : data === '0x01' ? ReleaseState.HELD : ReleaseState.REJECTED };
      return keccak256(raw);
    }, receipt: async () => null, waitReceipt: async () => ({ status: 'success', blockNumber: 100n, gasUsed: 50_000n }) };
  const canExecute = vi.fn().mockResolvedValue(true);
  const releasePort: ReleasePort = { read: async () => state,
    review: async (o) => request(toHex(releaseDecision(o), { size: 1 })),
    execute: () => request('0xff'), canExecute, terminalFinalized: async () => true };
  const cfg = (s: OperatorStore): WatcherConfig => ({ route: scope.route, chain: 'base', token: 'USDC', decimals: 6,
    bridge: scope.vault, store: s, ingress, egress, now: () => release.timestamp,
    baseline: { route: scope.route, computedAt: release.timestamp, windowHours: 24, sampleSize: 100, medianTransferUsd: 10_000, p95TransferUsd: 100_000, rollingTvlUsd: 40_000_000 },
    screening: { isFlagged: () => false, describe: () => undefined },
    verifySource: async (_r, burned) => burned === null ? { status: 'pending', reason: 'Missing backing.' } : { status: 'verified', amount: burned }, ...extra });
  const protectionSubmit = vi.fn().mockResolvedValue({ ok: true });
  const make = (s: OperatorStore) => new ReleaseOperator(new Watcher(cfg(s)), new DurableSender(s, txPort),
    new Attestor(actors.oracle, protection ?? { address: scope.guardian, chainId: 31337, currentTier: async () => 0, submitAttestation: protectionSubmit }, { now: () => release.timestamp }), releasePort, keccak256(toHex(scope.route)));
  return { store, open, make, operator: make(store), releasePort, release, txPort, canExecute, protectionSubmit,
    setState: (s: Partial<ReleaseStatus>) => { state = { ...state, ...s }; } };
}

describe('durable release queue', () => {
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
  it('reconciles an executed payout after acknowledgment commit failed without executing again', async () => {
    const f = fixture(); const save = f.store.saveWatcher.bind(f.store);
    vi.spyOn(f.store, 'saveWatcher').mockImplementation((s) => { if (s.completed.length) throw new Error('Disk full'); save(s); });
    await expect(f.operator.tick()).rejects.toThrow('Disk full'); f.store.close(); const restored = f.open();
    expect((await f.make(restored).tick())[0].action).toBe('executed');
    expect(restored.transactions().filter((t) => t.id.startsWith('execute/'))).toHaveLength(1);
  });
  it('removes explicitly invalid backing only after confirmed terminal rejection', async () => {
    const f = fixture({ verifySource: async () => ({ status: 'invalid', reason: 'Invalid independent proof.' }) });
    expect((await f.operator.tick())[0].action).toBe('rejected'); expect(f.store.loadWatcher()?.pending).toEqual([]);
  });
  it('refuses a different on-chain recipient before any review or payout', async () => {
    const f = fixture(); f.setState({ recipient: actors.owner.address });
    await expect(f.operator.tick()).rejects.toThrow('does not match'); expect(f.store.transactions()).toEqual([]);
  });
  function continuousFixture() {
    let now = 1_780_000_000n, expiresAt = 0n, tier = 0;
    let flagged: boolean | null = true;
    const submit = vi.fn(async () => { tier = 3; expiresAt = now + 86400n; return { ok: true }; });
    const snapshot = vi.fn(async () => ({ tier, expiresAt, now, oracle: actors.oracle.address, configured: true }));
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
});
