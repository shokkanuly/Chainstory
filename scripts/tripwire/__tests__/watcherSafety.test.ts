import { describe, expect, it, vi } from 'vitest';
import { keccak256, toHex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { MemoryFeed, type BurnEvent, type ReleaseEvent } from '../events.js';
import { Watcher, type WatcherConfig } from '../watch.js';
import { ReleaseDecision, releaseDecision } from '../review.js';

const NOW = 1_780_000_000;
const MESSAGE = keccak256(toHex('watcher-safety'));
const release: ReleaseEvent = { messageId: MESSAGE, amount: 40_000n * 10n ** 6n, recipient: actors.bridge.address, timestamp: NOW };

function fixture(contractFacts = async () => null, extra: Partial<WatcherConfig> = {}) {
  const ingress = new MemoryFeed<BurnEvent>();
  const egress = new MemoryFeed<ReleaseEvent>();
  const watcher = new Watcher({
    route: 'source:destination:USDC', chain: 'base', token: 'USDC', decimals: 6,
    bridge: actors.owner.address, ingress, egress,
    baseline: { route: 'source:destination:USDC', windowHours: 24, sampleSize: 100, medianTransferUsd: 10_000, p95TransferUsd: 100_000, rollingTvlUsd: 40_000_000, computedAt: NOW },
    screening: { isFlagged: () => false, describe: () => undefined },
    contractFacts, now: () => NOW,
    verifySource: async (_release, burned) => burned === null
      ? { status: 'pending', reason: 'Synthetic source event has not arrived.' }
      : { status: 'verified', amount: burned },
    ...extra,
  });
  return { watcher, ingress, egress };
}

describe('watcher failure recovery', () => {
  it('holds a release with missing source data instead of declaring a proven attack', async () => {
    const { watcher, egress } = fixture();
    egress.emit(release);
    const [observation] = await watcher.tick();
    expect(observation.assessment.verdict).toBe('indeterminate');
    expect(observation.assessment.score).toBeNull();
  });

  it('rechecks a pending release when its source event arrives later', async () => {
    const { watcher, ingress, egress } = fixture();
    egress.emit(release);
    await watcher.tick();
    ingress.emit({ messageId: MESSAGE, amount: release.amount, timestamp: NOW });
    const [observation] = await watcher.tick();
    expect(observation?.assessment.verdict).toBe('clear');
    watcher.acknowledge(MESSAGE);
    expect(await watcher.tick()).toEqual([]);
  });

  it('does not lose a polled release when the recipient lookup fails', async () => {
    const lookup = vi.fn().mockRejectedValueOnce(new Error('explorer timeout')).mockResolvedValue(null);
    const { watcher, ingress, egress } = fixture(lookup);
    ingress.emit({ messageId: MESSAGE, amount: release.amount, timestamp: NOW });
    egress.emit(release);
    try { await watcher.tick(); } catch { /* A failed lookup must still be retryable. */ }
    const [observation] = await watcher.tick();
    expect(observation?.assessment.verdict).toBe('clear');
  });

  it('does not permit observed events to replace an independent source verifier', async () => {
    const { watcher, ingress, egress } = fixture(undefined, { verifySource: undefined });
    ingress.emit({ messageId: MESSAGE, amount: release.amount, timestamp: NOW });
    egress.emit(release);
    const [observation] = await watcher.tick();
    expect(observation.source.status).toBe('pending');
    expect(releaseDecision(observation)).toBe(ReleaseDecision.HOLD);
  });

  it('retains an unacknowledged result for retry after a failed attestation or review transaction', async () => {
    const { watcher, ingress, egress } = fixture();
    ingress.emit({ messageId: MESSAGE, amount: release.amount, timestamp: NOW });
    egress.emit(release);
    expect((await watcher.tick())[0].assessment.verdict).toBe('clear');
    expect((await watcher.tick())[0].assessment.verdict).toBe('clear');
    watcher.acknowledge(MESSAGE);
    egress.emit(release);
    expect(await watcher.tick()).toEqual([]);
  });

  it('does not inflate backing when a burn notification is duplicated', async () => {
    const { watcher, ingress, egress } = fixture();
    const burn = { messageId: MESSAGE, amount: release.amount, timestamp: NOW };
    ingress.emit(burn);
    ingress.emit(burn);
    egress.emit(release);
    const [observation] = await watcher.tick();
    expect(observation.burned).toBe(release.amount);
    expect(releaseDecision(observation)).toBe(ReleaseDecision.ALLOW);
  });

  it('holds conflicting source observations for reconciliation instead of asserting a proven attack', async () => {
    const { watcher, ingress, egress } = fixture();
    ingress.emit({ messageId: MESSAGE, amount: release.amount, timestamp: NOW });
    ingress.emit({ messageId: MESSAGE, amount: release.amount + 1n, timestamp: NOW });
    egress.emit(release);
    const [observation] = await watcher.tick();
    expect(observation.source.status).toBe('unavailable');
    expect(observation.assessment.score).toBeNull();
    expect(releaseDecision(observation)).toBe(ReleaseDecision.HOLD);
  });

  it('does not let a failing recipient lookup suppress other payouts in the same batch', async () => {
    const lookup = vi.fn().mockRejectedValueOnce(new Error('explorer timeout')).mockResolvedValue(null);
    const { watcher, ingress, egress } = fixture(lookup);
    const second = { ...release, messageId: keccak256(toHex('second')) };
    for (const r of [release, second]) {
      ingress.emit({ messageId: r.messageId, amount: r.amount, timestamp: NOW });
      egress.emit(r);
    }
    const observations = await watcher.tick();
    expect(observations.map(releaseDecision)).toEqual([ReleaseDecision.HOLD, ReleaseDecision.ALLOW]);
  });

  it('holds unavailable source data and rejects only an explicit invalid-source verdict', async () => {
    const verifier = vi.fn()
      .mockRejectedValueOnce(new Error('RPC unavailable'))
      .mockResolvedValue({ status: 'invalid', reason: 'Recorded source proof is invalid.' });
    const { watcher, egress } = fixture(undefined, { verifySource: verifier });
    egress.emit(release);
    const [unknown] = await watcher.tick();
    expect(unknown.burned).toBeNull();
    expect(releaseDecision(unknown)).toBe(ReleaseDecision.HOLD);
    const [invalid] = await watcher.tick();
    expect(invalid.assessment.score).toBe(1);
    expect(releaseDecision(invalid)).toBe(ReleaseDecision.REJECT);
  });

  it('validates a malformed source response as unavailable instead of allowing it', async () => {
    const { watcher, egress } = fixture(undefined, { verifySource: vi.fn().mockResolvedValue({ status: 'verified', amount: '40000' }) });
    egress.emit(release);
    const [observation] = await watcher.tick();
    expect(observation.source.status).toBe('unavailable');
    expect(releaseDecision(observation)).toBe(ReleaseDecision.HOLD);
  });

  it('holds a payout when the screening list is unavailable despite a numeric score', async () => {
    const { watcher, ingress, egress } = fixture(undefined, { screening: { isFlagged: () => null, describe: () => undefined } });
    ingress.emit({ messageId: MESSAGE, amount: release.amount, timestamp: NOW });
    egress.emit(release);
    const [observation] = await watcher.tick();
    expect(releaseDecision(observation)).toBe(ReleaseDecision.HOLD);
  });
});
