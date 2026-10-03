import { describe, expect, it, vi } from 'vitest';
import { keccak256, toHex, type Hex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { computeBaseline, rollingBaseline, type BaselineSample } from '../baseline.js';
import { MemoryFeed, type BurnEvent, type ReleaseEvent } from '../events.js';
import { Watcher, type WatcherConfig } from '../watch.js';
import { cachedFacts } from '../testnet/operator.js';

const NOW = 1_780_000_000;
const USDC = 10n ** 6n;
const ROUTE = 'source:destination:USDC';
const burns = (amounts: number[], at = NOW - 60): BaselineSample[] => amounts.map((a) => ({ amount: BigInt(a) * USDC, timestamp: at }));

describe('rolling baseline from finalized source burns (HIGH-2)', () => {
  it('summarises the window in exact base units and stamps it with the tick clock', () => {
    const b = computeBaseline(burns(Array.from({ length: 20 }, (_, i) => (i + 1) * 1000)), 5_000_000n * USDC, NOW, { route: ROUTE, decimals: 6 });
    expect(b).toEqual({ route: ROUTE, windowHours: 24, sampleSize: 20, medianTransferUsd: 10_000, p95TransferUsd: 19_000,
      rollingTvlUsd: 5_000_000, computedAt: NOW });
  });
  it('stays cold, so payouts hold, below the scorer minimum or outside the window', () => {
    const tvl = 1_000_000n * USDC;
    expect(computeBaseline(burns(Array(19).fill(1000)), tvl, NOW, { route: ROUTE, decimals: 6 })).toBeNull();
    expect(computeBaseline(burns(Array(25).fill(1000), NOW - 25 * 3600), tvl, NOW, { route: ROUTE, decimals: 6 })).toBeNull();
    expect(computeBaseline(burns(Array(25).fill(1000), NOW - 25 * 3600), tvl, NOW, { route: ROUTE, decimals: 6, windowHours: 48 })?.sampleSize).toBe(25);
    expect(computeBaseline(burns(Array(25).fill(1000), NOW + 60), tvl, NOW, { route: ROUTE, decimals: 6 })).toBeNull();
  });
  it.each([{ windowHours: 0 }, { windowHours: 169 }, { windowHours: 1.5 }, { decimals: 37 }])('rejects a nonsensical option %o', (patch) => {
    expect(() => computeBaseline([], 0n, NOW, { route: ROUTE, decimals: 6, ...patch })).toThrow();
  });
  it('reads the pool each time and lets a failed read surface to the watcher', async () => {
    const tvl = vi.fn().mockResolvedValueOnce(2n * USDC).mockRejectedValueOnce(new Error('offline'));
    const provider = rollingBaseline({ route: ROUTE, decimals: 6, tvl });
    expect((await provider(burns(Array(20).fill(1)), NOW))?.rollingTvlUsd).toBe(2);
    await expect(provider(burns(Array(20).fill(1)), NOW)).rejects.toThrow('offline');
  });
});

function watcher(extra: Partial<WatcherConfig> = {}) {
  const ingress = new MemoryFeed<BurnEvent>(); const egress = new MemoryFeed<ReleaseEvent>();
  let now = NOW;
  const w = new Watcher({ route: ROUTE, chain: 'base', token: 'USDC', decimals: 6, bridge: actors.owner.address, ingress, egress,
    baseline: null, screening: { isFlagged: () => false, describe: () => undefined }, now: () => now,
    verifySource: async (_r, burned) => burned === null ? { status: 'pending', reason: 'Waiting.' } : { status: 'verified', amount: burned }, ...extra });
  const emit = (n: number, amount = 1000n * USDC) => {
    const messageId = keccak256(toHex(`release-${n}`)); const recipient = `0x${(n + 1).toString(16).padStart(40, '0')}` as Hex;
    ingress.emit({ messageId, amount, timestamp: NOW - 60 }); egress.emit({ messageId, recipient, amount, timestamp: NOW });
    return messageId;
  };
  return { w, emit, ingress, advance: (s: number) => { now += s; } };
}

describe('watcher baseline provider and lookups', () => {
  it('scores against a baseline built from the burns it has ingested, so a warm route can clear', async () => {
    const provider = vi.fn((samples: readonly BaselineSample[], now: number) => computeBaseline(samples, 50_000_000n * USDC, now, { route: ROUTE, decimals: 6 }));
    const f = watcher({ baseline: provider });
    f.emit(0);
    expect((await f.w.tick())[0].assessment).toMatchObject({ score: null, verdict: 'indeterminate' }); // one burn: cold, held
    // A day of earlier deposits into the route, none of them paid by this operator.
    for (let i = 1; i < 20; i++) f.ingress.emit({ messageId: keccak256(toHex(`history-${i}`)), amount: 1000n * USDC, timestamp: NOW - i * 3600 });
    const [observation] = await f.w.tick();
    expect(provider).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ amount: 1000n * USDC, timestamp: NOW - 3600 })]), NOW);
    expect(observation.assessment.verdict).toBe('clear'); expect(observation.assessment.score).not.toBeNull();
  });
  it('holds everything when the baseline provider fails, instead of failing the tick', async () => {
    const f = watcher({ baseline: async () => { throw new Error('balance read failed'); } });
    f.emit(0); expect((await f.w.tick())[0].assessment).toMatchObject({ score: null, verdict: 'indeterminate' });
  });
  it('looks recipients up a few at a time, keeps each answer with its own release, and records failures', async () => {
    let active = 0, peak = 0;
    const contractFacts = vi.fn(async (address: Hex) => {
      active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--;
      if (address.endsWith('3')) throw new Error('explorer rate limit');
      return null;
    });
    const f = watcher({ contractFacts, baseline: { route: ROUTE, windowHours: 24, sampleSize: 100, medianTransferUsd: 10_000,
      p95TransferUsd: 100_000, rollingTvlUsd: 40_000_000, computedAt: NOW } });
    const ids = Array.from({ length: 10 }, (_, i) => f.emit(i));
    const observations = await f.w.tick();
    expect(peak).toBeGreaterThan(1); expect(peak).toBeLessThanOrEqual(4); expect(contractFacts).toHaveBeenCalledTimes(10);
    expect(observations.map((o) => o.release.messageId)).toEqual(ids);
    const failed = observations.find((o) => o.release.recipient.endsWith('3'));
    expect(failed?.assessment).toMatchObject({ score: null, degradedReason: expect.stringContaining('lookup unavailable') });
    expect(observations.filter((o) => o.assessment.score === null)).toHaveLength(1);
  });
  it('skips a snoozed release until its time comes, and forgets it once acknowledged', async () => {
    const f = watcher(); const id = f.emit(0);
    f.w.snooze(id, 60); expect(await f.w.tick()).toHaveLength(1); // not pending yet: nothing to snooze
    f.w.snooze(id, 60); expect(await f.w.tick()).toEqual([]);
    f.advance(59); expect(await f.w.tick()).toEqual([]);
    f.advance(1); expect((await f.w.tick()).map((o) => o.release.messageId)).toEqual([id]);
    f.w.snooze(id, 60); await f.w.acknowledge(id); f.w.snooze(id, 60);
    f.advance(60); expect(await f.w.tick()).toEqual([]);
  });
});

describe('contract facts cache', () => {
  it('reuses a successful answer for its lifetime and never caches a failure', async () => {
    let now = 0;
    const lookup = vi.fn().mockRejectedValueOnce(new Error('rate limit')).mockResolvedValue(null);
    const facts = cachedFacts(lookup, 1000, () => now);
    await expect(facts(actors.bridge.address)).rejects.toThrow('rate limit');
    await facts(actors.bridge.address); await facts(actors.bridge.address.toLowerCase() as Hex);
    expect(lookup).toHaveBeenCalledTimes(2);
    now = 1000; await facts(actors.bridge.address); expect(lookup).toHaveBeenCalledTimes(3);
  });
});
