import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, scoreTransfer, type ScoreInput } from '../riskScorer.js';
import type { BridgeTransfer, RouteBaseline } from '../types.js';

const NOW = 1_780_000_000;
const transfer: BridgeTransfer = {
  hash: 'current', chain: 'base', route: 'base:ethereum:USDC', token: 'USDC',
  amountUsd: 25_000, timestamp: NOW, from: 'source', to: 'recipient',
  backing: { burned: 25_000_000_000n, claimed: 25_000_000_000n, toleranceBps: 0n },
};
const baseline: RouteBaseline = {
  route: transfer.route, windowHours: 24, sampleSize: 400, medianTransferUsd: 12_000,
  p95TransferUsd: 90_000, rollingTvlUsd: 40_000_000, computedAt: NOW - 600,
};
const input = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  transfer, baseline, recent: [], now: NOW,
  screening: { isFlagged: () => false, describe: () => undefined }, ...over,
});
function expectUnknown(value: ScoreInput) {
  const result = scoreTransfer(value);
  expect(result.verdict).toBe('indeterminate');
  expect(result.score).toBeNull();
  expect(result.degradedReason).toBeTruthy();
  expect(result.signals.every((s) => Number.isFinite(s.score))).toBe(true);
  return result;
}

describe('scorer input safety: synthetic regression fixtures', () => {
  it('does not clear a backed payout when screening is unavailable', () => {
    const result = expectUnknown(input({ screening: { isFlagged: () => null, describe: () => undefined } }));
    expect(result.health.screeningAvailable).toBe(false);
  });

  it('treats a screening exception as unavailable data', () => {
    expectUnknown(input({ screening: { isFlagged: () => { throw new Error('list unavailable'); }, describe: () => undefined } }));
  });

  it('uses one screening observation for health and the signal', () => {
    const isFlagged = vi.fn().mockReturnValueOnce(false).mockReturnValue(null);
    const result = scoreTransfer(input({ screening: { isFlagged, describe: () => undefined } }));
    expect(isFlagged).toHaveBeenCalledTimes(1);
    expect(result.verdict).toBe('clear');
    expect(result.health.screeningAvailable).toBe(true);
    expect(result.signals.find((s) => s.id === 'counterparty_screen')?.score).toBe(0);
  });

  it('keeps a positive screening observation when its descriptive label fails', () => {
    const result = scoreTransfer(input({ screening: {
      isFlagged: () => true, describe: () => { throw new Error('label unavailable'); },
    } }));
    expect(result.verdict).toBe('trip');
    expect(result.score).toBe(1);
  });

  it('treats a malformed screening response as unavailable', () => {
    expectUnknown(input({ screening: { isFlagged: vi.fn().mockReturnValue('false'), describe: () => undefined } }));
  });

  it('does not describe a partially checked contract as verified', () => {
    const result = scoreTransfer(input({ targetContract: {
      address: transfer.to, isVerified: null, ageDays: 100, isUpgradeable: false, adminFunctions: [],
    } }));
    const reason = result.signals.find((s) => s.id === 'contract_risk')?.reason;
    expect(reason).toContain('Could not determine its verification');
    expect(reason).not.toContain('is verified and established');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('does not assert a legacy proof mismatch from malformed USD (%s)', (provenBurnUsd) => {
    const result = expectUnknown(input({ transfer: { ...transfer, backing: undefined, provenBurnUsd, claimedPayoutUsd: 25_000 } }));
    expect(result.signals.some((s) => s.id === 'proof_payout_mismatch')).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('does not clear with an invalid assessment clock (%s)', (now) => {
    expectUnknown(input({ now }));
  });

  it.each([
    ['another route', { route: 'ethereum:base:USDC' }],
    ['future computation', { computedAt: NOW + 1 }],
    ['invalid computation', { computedAt: Number.NaN }],
    ['zero p95', { p95TransferUsd: 0 }],
    ['non-finite p95', { p95TransferUsd: Number.POSITIVE_INFINITY }],
    ['zero liquidity', { rollingTvlUsd: 0 }],
    ['negative liquidity', { rollingTvlUsd: -1 }],
    ['invalid liquidity', { rollingTvlUsd: Number.NaN }],
    ['zero history window', { windowHours: 0 }],
    ['invalid history window', { windowHours: Number.NaN }],
    ['fractional sample count', { sampleSize: 400.5 }],
    ['non-finite sample count', { sampleSize: Number.POSITIVE_INFINITY }],
    ['negative median', { medianTransferUsd: -1 }],
    ['inconsistent median', { medianTransferUsd: 100_000 }],
  ] satisfies [string, Partial<RouteBaseline>][])('does not trust a baseline with %s', (_name, over) => {
    const result = expectUnknown(input({ baseline: { ...baseline, ...over } }));
    expect(result.health.baselineFresh).toBe(false);
    expect(result.signals.some((s) => s.id === 'size_vs_baseline' || s.id === 'withdrawal_velocity')).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('does not treat %s USD as a usable price', (amountUsd) => {
    const result = expectUnknown(input({ transfer: { ...transfer, amountUsd } }));
    expect(result.health.priceAvailable).toBe(false);
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, -1])('does not substitute zero for an invalid recent amount (%s)', (amountUsd) => {
    expectUnknown(input({ recent: [{ ...transfer, hash: 'previous', timestamp: NOW - 30, amountUsd }] }));
  });

  it('does not let malformed timestamps hide possibly relevant history', () => {
    expectUnknown(input({ recent: [{ ...transfer, hash: 'previous', timestamp: Number.NaN }] }));
  });

  it('ignores invalid amounts outside this route and velocity window', () => {
    const result = scoreTransfer(input({ recent: [
      { ...transfer, hash: 'other-route', route: 'other', amountUsd: Number.NaN },
      { ...transfer, hash: 'old', timestamp: NOW - 3600, amountUsd: null },
    ] }));
    expect(result.verdict).toBe('clear');
  });

  it.each([Number.NaN, -1, NOW + 1])('does not clear an invalid transfer timestamp (%s)', (timestamp) => {
    expectUnknown(input({ transfer: { ...transfer, timestamp } }));
  });

  it.each([
    { tripThreshold: Number.NaN }, { elevatedThreshold: 0.9 },
    { baselineMaxAgeSeconds: -1 }, { velocityWindowSeconds: 0 },
    { payoutTolerance: Number.POSITIVE_INFINITY },
  ])('does not clear with invalid configuration %j', (over) => {
    expectUnknown(input({ config: { ...DEFAULT_CONFIG, ...over } }));
  });

  it('retains exact mismatch evidence even when behavioral inputs are unavailable', () => {
    const result = scoreTransfer(input({
      transfer: { ...transfer, amountUsd: Number.NaN, backing: { burned: 10n ** 30n, claimed: 10n ** 30n + 1n, toleranceBps: 0n } },
      baseline: { ...baseline, route: 'other' },
      screening: { isFlagged: () => null, describe: () => undefined },
      recent: [{ ...transfer, hash: 'previous', timestamp: NOW - 30, amountUsd: null }],
    }));
    expect(result.verdict).toBe('trip');
    expect(result.score).toBe(1);
    expect(result.signals.every((s) => Number.isFinite(s.score))).toBe(true);
  });
});
