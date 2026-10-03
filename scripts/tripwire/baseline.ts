// Rolling route baseline for the live operator (HIGH-2). Pure: no clock, no I/O.
//
// The sample is the route's finalized source-chain burns, not its executed
// payouts. Payouts exist only after the operator allows them, and allowing one
// needs a baseline: built from payouts, a new route could never start. Burns
// are real deposits someone paid for on the source chain, and nothing the
// operator decides feeds back into them.
//
// Cold start stays fail-closed: below the scorer's minimum sample a baseline is
// null and every payout holds, exactly as before. Held releases are re-checked,
// so they pay once enough history exists.
import { DEFAULT_CONFIG } from '../../src/tripwire/riskScorer.js';
import type { RouteBaseline } from '../../src/tripwire/types.js';

export interface BaselineSample {
  amount: bigint;
  /** Seconds since epoch, from the source block. */
  timestamp: number;
}

export interface BaselineOptions {
  route: string;
  decimals: number;
  /** How far back the sample reaches, in hours (1 to 168; default 24). */
  windowHours?: number;
  minSamples?: number;
}

/** Nearest-rank quantile over sorted base units. */
function quantile(sorted: readonly bigint[], p: number): bigint {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/**
 * Median and p95 of the window's burns, in exact base units until the last
 * step. The USD figures are heuristics for a $1 stablecoin route (ADR-012);
 * no amount that moves money is compared through them.
 */
export function computeBaseline(samples: readonly BaselineSample[], tvl: bigint, now: number, opts: BaselineOptions): RouteBaseline | null {
  const windowHours = opts.windowHours ?? 24;
  if (!Number.isInteger(windowHours) || windowHours < 1 || windowHours > 168) throw new Error('Baseline window must be 1 to 168 whole hours.');
  if (!Number.isInteger(opts.decimals) || opts.decimals < 0 || opts.decimals > 36) throw new Error('Invalid token decimals.');
  if (!Number.isSafeInteger(now) || now < 0 || tvl < 0n) return null;
  const since = now - windowHours * 3600;
  const amounts = samples.filter((s) => s.amount > 0n && s.timestamp >= since && s.timestamp <= now)
    .map((s) => s.amount).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (amounts.length < (opts.minSamples ?? DEFAULT_CONFIG.baselineMinSamples)) return null;
  const usd = (units: bigint) => Number(units) / 10 ** opts.decimals;
  return {
    route: opts.route, windowHours, sampleSize: amounts.length,
    medianTransferUsd: usd(quantile(amounts, 0.5)), p95TransferUsd: usd(quantile(amounts, 0.95)),
    rollingTvlUsd: usd(tvl), computedAt: now,
  };
}

/**
 * A watcher baseline provider: recomputed on every tick from the burns the
 * watcher has ingested, against the pool it currently guards. Any failure to
 * read the pool means no baseline this tick, so payouts hold.
 */
export function rollingBaseline(opts: BaselineOptions & { tvl: () => Promise<bigint> }) {
  return async (samples: readonly BaselineSample[], now: number): Promise<RouteBaseline | null> =>
    computeBaseline(samples, await opts.tvl(), now, opts);
}
