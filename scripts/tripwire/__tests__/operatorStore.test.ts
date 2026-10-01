import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keccak256, toHex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { MemoryFeed, type BurnEvent, type ReleaseEvent } from '../events.js';
import { Watcher, type WatcherConfig } from '../watch.js';
import { OperatorStore, type OperatorScope } from '../store.js';

const scope: OperatorScope = { route: 'test-route', chainId: 31337, sourceChainId: 31337,
  source: actors.owner.address, vault: actors.bridge.address, guardian: actors.oracle.address,
  token: actors.relayer.address, decimals: 6, sender: actors.owner.address };
const now = 1_780_000_000;
const messageId = keccak256(toHex('durable'));
const release: ReleaseEvent = { messageId, amount: 10n ** 30n + 1n, recipient: actors.bridge.address, timestamp: now };
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.reverse()) cleanup(); cleanups.length = 0; });
function open(path?: string) {
  if (!path) { const dir = mkdtempSync(join(tmpdir(), 'tripwire-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); path = join(dir, 'operator.sqlite'); }
  const store = new OperatorStore(path, scope);
  cleanups.push(() => store.close());
  return { store, path };
}
function config(store: OperatorStore, ingress: MemoryFeed<BurnEvent>, egress: MemoryFeed<ReleaseEvent>, extra: Partial<WatcherConfig> = {}): WatcherConfig {
  return { route: scope.route, chain: 'base', token: 'USDC', decimals: 6, bridge: scope.vault as `0x${string}`,
    ingress, egress, store, now: () => now,
    baseline: { route: scope.route, windowHours: 24, sampleSize: 100, medianTransferUsd: 10_000, p95TransferUsd: 100_000, rollingTvlUsd: 40_000_000, computedAt: now },
    screening: { isFlagged: () => false, describe: () => undefined },
    verifySource: async (_r, burn) => burn === null ? { status: 'pending', reason: 'Waiting for backing.' } : { status: 'verified', amount: burn }, ...extra };
}

describe('durable operator state', () => {
  it('restores an unacknowledged release, exact backing and cursors after restart', async () => {
    const { store, path } = open(); const ingress = new MemoryFeed<BurnEvent>(); const egress = new MemoryFeed<ReleaseEvent>();
    ingress.emit({ messageId, amount: release.amount, timestamp: now }); egress.emit(release);
    await new Watcher(config(store, ingress, egress)).tick(); store.close();
    const restored = open(path).store;
    const result = await new Watcher(config(restored, ingress, egress)).tick();
    expect(result).toHaveLength(1); expect(result[0].burned).toBe(release.amount);
    expect(restored.loadWatcher()?.egressCursor).toBe('1');
  });
  it('retries the original feed range after ingestion commit fails', async () => {
    const { store } = open(); const ingress = new MemoryFeed<BurnEvent>(); const egress = new MemoryFeed<ReleaseEvent>();
    ingress.emit({ messageId, amount: release.amount, timestamp: now }); egress.emit(release);
    const watcher = new Watcher(config(store, ingress, egress));
    vi.spyOn(store, 'saveWatcher').mockImplementationOnce(() => { throw new Error('Disk full'); });
    await expect(watcher.tick()).rejects.toThrow('Disk full');
    expect(ingress.checkpoint()).toBe('0'); expect(egress.checkpoint()).toBe('0');
    expect((await watcher.tick())[0].release.amount).toBe(release.amount);
  });
  it('rolls back both feeds if the second poll fails after the source cursor advanced', async () => {
    const { store } = open(); const ingress = new MemoryFeed<BurnEvent>(); const egress = new MemoryFeed<ReleaseEvent>();
    ingress.emit({ messageId, amount: release.amount, timestamp: now }); egress.emit(release);
    const watcher = new Watcher(config(store, ingress, egress));
    vi.spyOn(egress, 'poll').mockRejectedValueOnce(new Error('RPC down'));
    await expect(watcher.tick()).rejects.toThrow('RPC down');
    expect(ingress.checkpoint()).toBe('0'); expect((await watcher.tick())[0].burned).toBe(release.amount);
  });
  it('keeps a missing-source request pending across restart until its backing arrives', async () => {
    const { store, path } = open(); const ingress = new MemoryFeed<BurnEvent>(); const egress = new MemoryFeed<ReleaseEvent>(); egress.emit(release);
    await new Watcher(config(store, ingress, egress)).tick(); store.close();
    const watcher = new Watcher(config(open(path).store, ingress, egress));
    expect((await watcher.tick())[0].source.status).toBe('pending');
    ingress.emit({ messageId, amount: release.amount, timestamp: now });
    expect((await watcher.tick())[0].source.status).toBe('verified');
  });
  it('persists acknowledgements so duplicate events cannot resurrect a completed request', async () => {
    const { store, path } = open(); const ingress = new MemoryFeed<BurnEvent>(); const egress = new MemoryFeed<ReleaseEvent>(); egress.emit(release);
    const watcher = new Watcher(config(store, ingress, egress)); await watcher.tick(); await watcher.acknowledge(messageId); store.close();
    egress.emit(release);
    expect(await new Watcher(config(open(path).store, ingress, egress)).tick()).toEqual([]);
  });
  it('keeps a request pending when acknowledging it cannot be committed', async () => {
    const { store } = open(); const ingress = new MemoryFeed<BurnEvent>(); const egress = new MemoryFeed<ReleaseEvent>(); egress.emit(release);
    const watcher = new Watcher(config(store, ingress, egress)); await watcher.tick();
    vi.spyOn(store, 'saveWatcher').mockImplementationOnce(() => { throw new Error('Disk full'); });
    await expect(watcher.acknowledge(messageId)).rejects.toThrow('Disk full');
    expect(await watcher.tick()).toHaveLength(1);
  });
  it('refuses a second operator while the first owns this state', () => {
    const { store, path } = open(); expect(() => new OperatorStore(path, scope)).toThrow('already running');
    store.close(); expect(open(path).store.loadWatcher()).toBeNull();
  });
  it('refuses state from a different deployment or schema version', () => {
    const { store, path } = open(); store.close();
    expect(() => new OperatorStore(path, { ...scope, chainId: 1 })).toThrow('scope');
  });
  it('retains conflicting backing across restart', async () => {
    const { store, path } = open(); const ingress = new MemoryFeed<BurnEvent>(); const egress = new MemoryFeed<ReleaseEvent>(); egress.emit(release);
    for (const amount of [release.amount, release.amount + 1n]) ingress.emit({ messageId, amount, timestamp: now });
    await new Watcher(config(store, ingress, egress)).tick(); store.close();
    expect((await new Watcher(config(open(path).store, ingress, egress)).tick())[0].source.status).toBe('unavailable');
  });
});
