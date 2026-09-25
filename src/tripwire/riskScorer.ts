// src/tripwire/riskScorer.ts
//
// The risk oracle: four rules, scored per transfer, aggregated into a verdict
// the on-chain guardian can act on.
//
// Why rules before a model. EIP-7265's documented weakness is that it only
// tracks outflow volume, so a transfer that is suspicious for any other reason
// passes untouched as long as it sits under the dollar cap. Each rule here
// closes one of those gaps, and each is explainable in a sentence — which
// matters when the output pauses somebody's bridge. A learned model can
// replace the weighting later; it cannot replace the need to say why.
//
// Why `indeterminate` exists. Every input to this file can be missing: a
// baseline may be stale, a price may be unavailable, a screening list may fail
// to load. The tempting default is to score the signal zero and carry on, and
// that is precisely the bug that makes a breaker dangerous — it reports "clear"
// on a transfer it could not actually examine. Missing inputs degrade the
// verdict instead of quietly lowering the score.

import type {
  BridgeTransfer,
  OracleHealth,
  RiskAssessment,
  RiskSignal,
  RouteBaseline,
  Verdict,
} from './types.js';

export interface ScorerConfig {
  /** Above this, the oracle asks the guardian to pause the route. */
  tripThreshold: number;
  /** Above this, the transfer is surfaced for review but not blocked. */
  elevatedThreshold: number;
  /** A baseline older than this is not trusted. */
  baselineMaxAgeSeconds: number;
  /** Below this many observed transfers, a baseline is too thin to compare against. */
  baselineMinSamples: number;
  /**
   * Relative gap between the proven burn and the claimed payout that counts as
   * a mismatch. Not zero: bridges legitimately differ by fees and rounding.
   */
  payoutTolerance: number;
  /** Window for the velocity rule. */
  velocityWindowSeconds: number;
  /**
   * A single signal at or above this level is severe enough to surface on its
   * own, whatever the others say. Without this the weighted mean lets one
   * maxed-out rule be diluted by calm ones — a transfer at 10x a route's p95
   * scored 0.445 against a 0.45 threshold and reported clear.
   */
  severeSignal: number;
}

export const DEFAULT_CONFIG: ScorerConfig = {
  tripThreshold: 0.75,
  elevatedThreshold: 0.45,
  baselineMaxAgeSeconds: 6 * 3600,
  baselineMinSamples: 20,
  payoutTolerance: 0.01,
  velocityWindowSeconds: 15 * 60,
  severeSignal: 0.9,
};

/** Counterparty screening, supplied by the caller so the list can be swapped. */
export interface ScreeningSource {
  /** Null means the list is unavailable — distinct from "checked, not flagged". */
  isFlagged(address: string): boolean | null;
  describe(address: string): string | undefined;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Rule 1 — the proven burn must match the claimed payout.
 *
 * This is the Verus case: the bridge verified the state root, the Merkle proof
 * and the hash binding, then paid out an amount nobody had checked. A gap here
 * is not a statistical anomaly, it is a broken invariant, so the signal is
 * deterministic and sets a floor on the total score.
 */
export function proofPayoutMismatch(
  transfer: BridgeTransfer,
  config: ScorerConfig
): RiskSignal | null {
  const { provenBurnUsd, claimedPayoutUsd } = transfer;
  // Null is "this route exposes no proof to check" — nothing to say. Zero is
  // different: Tripwire looked for the source-chain burn and found none it
  // could verify. That is the worst case of this invariant, not a skip: it is
  // what a forged cross-chain message (Kelp DAO) and a malformed proof that
  // the relay accepted (Syscoin) look like from the destination chain.
  if (provenBurnUsd == null || claimedPayoutUsd == null) return null;
  if (claimedPayoutUsd <= 0) return null;

  const gap =
    provenBurnUsd > 0 ? Math.abs(claimedPayoutUsd - provenBurnUsd) / provenBurnUsd : Number.POSITIVE_INFINITY;
  if (gap <= config.payoutTolerance) {
    return {
      id: 'proof_payout_mismatch',
      score: 0,
      weight: 0.4,
      reason: 'Claimed payout matches the proven burn.',
    };
  }

  // Any mismatch is disqualifying. The size of the gap only affects how loudly
  // it is reported, never whether it trips.
  return {
    id: 'proof_payout_mismatch',
    score: 1,
    weight: 0.4,
    deterministic: true,
    reason:
      provenBurnUsd <= 0
        ? `Payout of $${claimedPayoutUsd.toLocaleString('en-US')} has no verifiable source-chain burn behind it.`
        : claimedPayoutUsd >= provenBurnUsd * 2
          ? // "96400% gap" is true and unreadable; a multiple says it.
            `Claimed payout $${claimedPayoutUsd.toLocaleString('en-US')} is ` +
            `${Math.round(claimedPayoutUsd / provenBurnUsd).toLocaleString('en-US')}× the proven burn of $${provenBurnUsd.toLocaleString('en-US')}.`
          : `Claimed payout $${claimedPayoutUsd.toLocaleString('en-US')} does not match the ` +
            `proven burn of $${provenBurnUsd.toLocaleString('en-US')} (${(gap * 100).toFixed(1)}% gap).`,
  };
}

/**
 * Rule 2 — size against what this route normally does.
 *
 * Two comparisons, because either alone is gameable: how the transfer compares
 * to the route's own p95, and what share of the pool it removes. A drain can be
 * unremarkable against a busy route's p95 and still take most of the liquidity.
 */
export function sizeVsBaseline(
  transfer: BridgeTransfer,
  baseline: RouteBaseline
): RiskSignal | null {
  if (transfer.amountUsd == null) return null;

  const vsP95 = baseline.p95TransferUsd > 0 ? transfer.amountUsd / baseline.p95TransferUsd : 0;
  const shareOfTvl =
    baseline.rollingTvlUsd > 0 ? transfer.amountUsd / baseline.rollingTvlUsd : 0;

  // 1x p95 is ordinary; 10x is the top of the scale.
  const sizeScore = clamp01((vsP95 - 1) / 9);
  // Removing a quarter of the pool in one transfer is the top of the scale.
  const drainScore = clamp01(shareOfTvl / 0.25);
  const score = Math.max(sizeScore, drainScore);

  return {
    id: 'size_vs_baseline',
    score,
    weight: 0.25,
    reason:
      `$${transfer.amountUsd.toLocaleString()} is ${vsP95.toFixed(1)}x this route's p95 ` +
      `and ${(shareOfTvl * 100).toFixed(1)}% of its liquidity.`,
  };
}

/**
 * Rule 3 — consecutive withdrawal velocity.
 *
 * The Ronin and Wormhole pattern is not one oversized transfer, it is a burst
 * that each pass a per-transfer cap. Scored on what the burst removes in
 * aggregate, which is the thing a static cap cannot see.
 */
export function withdrawalVelocity(
  transfer: BridgeTransfer,
  recent: BridgeTransfer[],
  baseline: RouteBaseline,
  config: ScorerConfig
): RiskSignal | null {
  if (transfer.amountUsd == null) return null;

  const since = transfer.timestamp - config.velocityWindowSeconds;
  const burst = recent.filter(
    (t) =>
      t.route === transfer.route &&
      t.timestamp >= since &&
      t.timestamp <= transfer.timestamp &&
      t.hash !== transfer.hash
  );

  const cumulative =
    transfer.amountUsd + burst.reduce((sum, t) => sum + (t.amountUsd ?? 0), 0);
  const shareOfTvl = baseline.rollingTvlUsd > 0 ? cumulative / baseline.rollingTvlUsd : 0;

  // A third of the pool inside the window is the top of the scale.
  const drainScore = clamp01(shareOfTvl / 0.33);
  // A burst well above the route's usual cadence counts on its own.
  const expectedInWindow =
    (baseline.sampleSize / Math.max(1, baseline.windowHours * 3600)) *
    config.velocityWindowSeconds;
  const countScore = clamp01((burst.length + 1 - expectedInWindow) / 10);
  const score = Math.max(drainScore, countScore);

  return {
    id: 'withdrawal_velocity',
    score,
    weight: 0.25,
    reason:
      `${burst.length + 1} withdrawals in ${config.velocityWindowSeconds / 60} minutes, ` +
      `totalling $${cumulative.toLocaleString()} ` +
      `(${(shareOfTvl * 100).toFixed(1)}% of liquidity).`,
  };
}

/** Rule 4 — is the recipient already known for something. */
export function counterpartyScreen(
  transfer: BridgeTransfer,
  screening: ScreeningSource
): RiskSignal | null {
  const flagged = screening.isFlagged(transfer.to);
  // Null is "the list did not load", which is not the same as "not flagged".
  if (flagged === null) return null;

  return {
    id: 'counterparty_screen',
    score: flagged ? 1 : 0,
    weight: 0.1,
    deterministic: flagged,
    reason: flagged
      ? `Recipient is on the screening list: ${screening.describe(transfer.to) ?? 'flagged address'}.`
      : 'Recipient is not on the screening list.',
  };
}

export interface ScoreInput {
  transfer: BridgeTransfer;
  /** Null when no usable baseline exists for the route. */
  baseline: RouteBaseline | null;
  /** Recent transfers on the same route, for the velocity rule. */
  recent: BridgeTransfer[];
  screening: ScreeningSource;
  now: number;
  config?: ScorerConfig;
}

/**
 * Score one transfer.
 *
 * The aggregation is a weighted mean over the signals that actually ran,
 * floored by any deterministic signal that fired. The floor is the important
 * part: a proven payout mismatch means the bridge is being lied to, and three
 * calm signals must not be able to average that back under the threshold.
 */
export function scoreTransfer(input: ScoreInput): RiskAssessment {
  const config = input.config ?? DEFAULT_CONFIG;
  const { transfer, baseline, screening } = input;

  const baselineFresh =
    baseline !== null &&
    baseline.sampleSize >= config.baselineMinSamples &&
    input.now - baseline.computedAt <= config.baselineMaxAgeSeconds;

  const health: OracleHealth = {
    baselineFresh,
    screeningAvailable: screening.isFlagged(transfer.to) !== null,
    priceAvailable: transfer.amountUsd !== null,
  };

  const signals: RiskSignal[] = [];
  const mismatch = proofPayoutMismatch(transfer, config);
  if (mismatch) signals.push(mismatch);
  const screen = counterpartyScreen(transfer, screening);
  if (screen) signals.push(screen);
  if (baselineFresh && baseline) {
    const size = sizeVsBaseline(transfer, baseline);
    if (size) signals.push(size);
    const velocity = withdrawalVelocity(transfer, input.recent, baseline, config);
    if (velocity) signals.push(velocity);
  }

  // A deterministic signal is evidence on its own and is reported even when
  // nothing else could be evaluated.
  const firedDeterministic = signals.some((s) => s.deterministic && s.score > 0);

  if (!firedDeterministic) {
    const reasons: string[] = [];
    if (!health.priceAvailable) reasons.push('the transfer could not be priced');
    if (!baselineFresh) reasons.push('no fresh baseline for this route');
    if (!health.screeningAvailable) reasons.push('the screening list is unavailable');

    // Without a baseline or a price there is no behavioural opinion to give.
    // Saying so is the whole point; scoring it zero would read as "clear".
    if (!health.priceAvailable || !baselineFresh) {
      return {
        transfer,
        score: null,
        verdict: 'indeterminate',
        signals,
        health,
        degradedReason: `Cannot assess: ${reasons.join(', ')}.`,
      };
    }
  }

  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const weighted =
    totalWeight > 0 ? signals.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight : 0;

  // Two floors, for two different reasons. A deterministic signal is proof of a
  // broken invariant, so it scores as proof: 1.0, not the trip threshold. (It
  // used to floor to exactly 0.75, which read as "barely over the line" for a
  // proven theft, and sat on the one value the guardian then refused.) A
  // severe-but-probabilistic signal is not proof, so it does not trip on its
  // own — but it must not be averaged below where a human would see it either.
  const severeFired = signals.some((s) => !s.deterministic && s.score >= config.severeSignal);
  const floor = firedDeterministic ? 1 : severeFired ? config.elevatedThreshold : 0;
  const score = clamp01(Math.max(weighted, floor));

  const verdict: Verdict =
    score >= config.tripThreshold
      ? 'trip'
      : score >= config.elevatedThreshold
        ? 'elevated'
        : 'clear';

  return { transfer, score, verdict, signals, health };
}
