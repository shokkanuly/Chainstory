// The oracle's output pauses somebody's bridge, so these tests pin two things:
// that each incident pattern is actually caught, and — just as important —
// that a degraded oracle never reports "clear".

import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, scoreTransfer, type ScreeningSource } from '../riskScorer.js';
import type { BridgeTransfer, RouteBaseline } from '../types.js';

const NOW = 1_780_000_000;
const ROUTE = 'eth:arb:USDC';

const baseline = (over: Partial<RouteBaseline> = {}): RouteBaseline => ({
  route: ROUTE,
  windowHours: 24,
  sampleSize: 400,
  medianTransferUsd: 12_000,
  p95TransferUsd: 90_000,
  rollingTvlUsd: 40_000_000,
  computedAt: NOW - 600,
  ...over,
});

const transfer = (over: Partial<BridgeTransfer> = {}): BridgeTransfer => ({
  hash: '0xabc',
  chain: 'ethereum',
  route: ROUTE,
  token: 'USDC',
  amountUsd: 25_000,
  timestamp: NOW,
  from: '0xbridge',
  to: '0xrecipient',
  ...over,
});

const cleanList: ScreeningSource = { isFlagged: () => false, describe: () => undefined };
const listDown: ScreeningSource = { isFlagged: () => null, describe: () => undefined };
const flagsEveryone: ScreeningSource = {
  isFlagged: () => true,
  describe: () => 'Lazarus-attributed cluster',
};

const score = (over: Parameters<typeof scoreTransfer>[0]) => scoreTransfer(over);

describe('ordinary traffic', () => {
  it('clears a transfer that looks like the route usually does', () => {
    const res = score({
      transfer: transfer(),
      baseline: baseline(),
      recent: [],
      screening: cleanList,
      now: NOW,
    });
    expect(res.verdict).toBe('clear');
    expect(res.score).toBeLessThan(DEFAULT_CONFIG.elevatedThreshold);
  });
});

// The Verus bridge verified the state root, the Merkle proof and the hash
// binding, and never checked that the payout matched the burn.
describe('proof/payout mismatch', () => {
  it('trips on a payout the burn does not back, even at ordinary size', () => {
    const res = score({
      transfer: transfer({ amountUsd: 25_000, provenBurnUsd: 25_000, claimedPayoutUsd: 11_580_000 }),
      baseline: baseline(),
      recent: [],
      screening: cleanList,
      now: NOW,
    });
    expect(res.verdict).toBe('trip');
    expect(res.signals.find((s) => s.id === 'proof_payout_mismatch')?.deterministic).toBe(true);
  });

  // The failure mode this guards against: three calm signals dragging a proven
  // broken invariant back under the threshold.
  it('cannot be averaged away by every other signal looking normal', () => {
    const res = score({
      transfer: transfer({ amountUsd: 1_000, provenBurnUsd: 1_000, claimedPayoutUsd: 900_000 }),
      baseline: baseline(),
      recent: [],
      screening: cleanList,
      now: NOW,
    });
    expect(res.verdict).toBe('trip');
    expect(res.score).toBeGreaterThanOrEqual(DEFAULT_CONFIG.tripThreshold);
  });

  it('tolerates fees and rounding', () => {
    const res = score({
      transfer: transfer({ provenBurnUsd: 100_000, claimedPayoutUsd: 99_950 }),
      baseline: baseline(),
      recent: [],
      screening: cleanList,
      now: NOW,
    });
    expect(res.verdict).toBe('clear');
  });
});

// Ronin and Wormhole were bursts of individually unremarkable withdrawals.
describe('withdrawal velocity', () => {
  it('trips on a burst that drains the pool while each transfer stays under the cap', () => {
    const burst = Array.from({ length: 9 }, (_, i) =>
      transfer({ hash: `0xburst${i}`, amountUsd: 1_500_000, timestamp: NOW - (i + 1) * 60 })
    );
    const res = score({
      transfer: transfer({ hash: '0xlast', amountUsd: 1_500_000 }),
      baseline: baseline(),
      recent: burst,
      screening: cleanList,
      now: NOW,
    });
    expect(res.verdict).toBe('trip');
    expect(res.signals.find((s) => s.id === 'withdrawal_velocity')!.score).toBeGreaterThan(0.7);
  });

  it('ignores the same volume spread outside the window', () => {
    const spread = Array.from({ length: 9 }, (_, i) =>
      transfer({ hash: `0xold${i}`, amountUsd: 1_500_000, timestamp: NOW - (i + 1) * 7200 })
    );
    const res = score({
      transfer: transfer({ hash: '0xlast', amountUsd: 20_000 }),
      baseline: baseline(),
      recent: spread,
      screening: cleanList,
      now: NOW,
    });
    expect(res.signals.find((s) => s.id === 'withdrawal_velocity')!.score).toBeLessThan(0.2);
  });
});

describe('size against the route baseline', () => {
  it('escalates a single transfer that removes a large share of liquidity', () => {
    const res = score({
      transfer: transfer({ amountUsd: 12_000_000 }),
      baseline: baseline(),
      recent: [],
      screening: cleanList,
      now: NOW,
    });
    expect(res.verdict).not.toBe('clear');
  });
});

describe('counterparty screening', () => {
  it('trips on a flagged recipient', () => {
    const res = score({
      transfer: transfer(),
      baseline: baseline(),
      recent: [],
      screening: flagsEveryone,
      now: NOW,
    });
    expect(res.verdict).toBe('trip');
  });
});

// The part that matters most. A breaker that fails open is worse than none,
// because it is trusted.
describe('degraded oracle', () => {
  it('returns indeterminate — not clear — when the transfer cannot be priced', () => {
    const res = score({
      transfer: transfer({ amountUsd: null }),
      baseline: baseline(),
      recent: [],
      screening: cleanList,
      now: NOW,
    });
    expect(res.verdict).toBe('indeterminate');
    expect(res.score).toBeNull();
    expect(res.degradedReason).toContain('could not be priced');
  });

  it('returns indeterminate when the route has no baseline at all', () => {
    const res = score({
      transfer: transfer(),
      baseline: null,
      recent: [],
      screening: cleanList,
      now: NOW,
    });
    expect(res.verdict).toBe('indeterminate');
    expect(res.health.baselineFresh).toBe(false);
  });

  it('returns indeterminate when the baseline is stale', () => {
    const res = score({
      transfer: transfer(),
      baseline: baseline({ computedAt: NOW - 48 * 3600 }),
      recent: [],
      screening: cleanList,
      now: NOW,
    });
    expect(res.verdict).toBe('indeterminate');
  });

  it('returns indeterminate when the baseline is too thin to compare against', () => {
    const res = score({
      transfer: transfer(),
      baseline: baseline({ sampleSize: 3 }),
      recent: [],
      screening: cleanList,
      now: NOW,
    });
    expect(res.verdict).toBe('indeterminate');
  });

  // Degraded inputs must not suppress evidence that does not depend on them.
  it('still trips on a proven mismatch while otherwise degraded', () => {
    const res = score({
      transfer: transfer({ amountUsd: null, provenBurnUsd: 50_000, claimedPayoutUsd: 5_000_000 }),
      baseline: null,
      recent: [],
      screening: listDown,
      now: NOW,
    });
    expect(res.verdict).toBe('trip');
  });

  it('reports the screening list being down rather than treating it as not-flagged', () => {
    const res = score({
      transfer: transfer(),
      baseline: baseline(),
      recent: [],
      screening: listDown,
      now: NOW,
    });
    expect(res.health.screeningAvailable).toBe(false);
    expect(res.signals.some((s) => s.id === 'counterparty_screen')).toBe(false);
  });
});

// Regression: probing the score curve found a transfer at 10x the route's p95
// landing on 0.445 against a 0.45 threshold, i.e. reported clear. One rule at
// full scale must not be averaged out of sight by the rules that are calm.
describe('a single severe signal', () => {
  it('reaches at least elevated even when every other signal is quiet', () => {
    const res = score({
      transfer: transfer({ amountUsd: 900_000 }), // 10x p95, ~2% of liquidity
      baseline: baseline(),
      recent: [],
      screening: cleanList,
      now: NOW,
    });
    expect(res.signals.find((s) => s.id === 'size_vs_baseline')!.score).toBeGreaterThanOrEqual(0.9);
    expect(res.verdict).toBe('elevated');
  });

  // It is severe, not proven — so it surfaces for review rather than pausing.
  it('does not trip on its own, because it is an estimate and not evidence', () => {
    const res = score({
      transfer: transfer({ amountUsd: 900_000 }),
      baseline: baseline(),
      recent: [],
      screening: cleanList,
      now: NOW,
    });
    expect(res.verdict).not.toBe('trip');
  });
});

// Regression: the payout rule used to return no signal when the proven burn
// was zero, skipping the worst case of its own invariant. A payout with no
// verifiable source-chain burn is how forged messages (Kelp DAO) and accepted
// malformed proofs (Syscoin) appear from the destination chain.
describe('unbacked payout', () => {
  it('trips on a payout with no verifiable burn behind it', () => {
    const res = score({
      transfer: transfer({ provenBurnUsd: 0, claimedPayoutUsd: 40_000 }),
      baseline: baseline(),
      recent: [],
      screening: cleanList,
      now: NOW,
    });
    expect(res.verdict).toBe('trip');
    expect(res.signals.find((s) => s.id === 'proof_payout_mismatch')?.reason).toContain('no verifiable');
  });

  it('still says nothing when the route exposes no proof at all', () => {
    const res = score({
      transfer: transfer({ provenBurnUsd: null, claimedPayoutUsd: null }),
      baseline: baseline(),
      recent: [],
      screening: cleanList,
      now: NOW,
    });
    expect(res.signals.some((s) => s.id === 'proof_payout_mismatch')).toBe(false);
  });
});

describe('mismatch reason', () => {
  it('states a large overpayment as a multiple of the burn', () => {
    const res = score({
      transfer: transfer({ provenBurnUsd: 12_000, claimedPayoutUsd: 11_580_000 }),
      baseline: baseline(),
      recent: [],
      screening: cleanList,
      now: NOW,
    });
    expect(res.signals.find((s) => s.id === 'proof_payout_mismatch')?.reason).toBe(
      'Claimed payout $11,580,000 is 965× the proven burn of $12,000.'
    );
  });
});
