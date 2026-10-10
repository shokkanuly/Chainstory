// src/tripwire/riskScorer.ts
//
// The risk oracle: four rules, scored per transfer, aggregated into a verdict
// the on-chain guardian can act on.
//
// Rules make the illustrative behavioral signals inspectable. Their hand-set
// weights are not calibrated production evidence. Exact backing verification
// and customer payment constraints have separate trust and policy boundaries.
//
// Why `indeterminate` exists. Every input to this file can be missing: a
// baseline may be stale, a price may be unavailable, a screening list may fail
// to load. The tempting default is to score the signal zero and carry on, and
// that is precisely the bug that makes a breaker dangerous — it reports "clear"
// on a transfer it could not actually examine. Missing inputs degrade the
// verdict instead of quietly lowering the score.

import type {
  BridgeTransfer,
  ContractRiskSummary,
  OracleHealth,
  RiskAssessment,
  RiskSignal,
  RouteBaseline,
  Verdict,
} from './types.js';

export interface ScorerConfig {
  /** Above this, the oracle asks the guardian to throttle the route (>0.65). */
  tripThreshold: number;
  /** Above this, the transfer enters delay timelock (>0.85). */
  delayThreshold: number;
  /** Above this, the transfer triggers an outright freeze (>0.95). */
  freezeThreshold: number;
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
  tripThreshold: 0.65,
  delayThreshold: 0.85,
  freezeThreshold: 0.95,
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

const usableUsd = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0;
const usableTimestamp = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;

function usableConfig(config: ScorerConfig): boolean {
  const thresholds = [config.elevatedThreshold, config.tripThreshold, config.delayThreshold, config.freezeThreshold];
  return thresholds.every((n, i) => Number.isFinite(n) && n >= 0 && n <= 1 && (i === 0 || n >= thresholds[i - 1])) &&
    Number.isFinite(config.severeSignal) && config.severeSignal > 0 && config.severeSignal <= 1 &&
    Number.isSafeInteger(config.baselineMaxAgeSeconds) && config.baselineMaxAgeSeconds >= 0 &&
    Number.isSafeInteger(config.baselineMinSamples) && config.baselineMinSamples > 0 &&
    Number.isSafeInteger(config.velocityWindowSeconds) && config.velocityWindowSeconds > 0 &&
    Number.isFinite(config.payoutTolerance) && config.payoutTolerance >= 0 && config.payoutTolerance <= 1;
}

function usableBaseline(baseline: RouteBaseline | null, input: ScoreInput, config: ScorerConfig): boolean {
  return baseline !== null && baseline.route === input.transfer.route &&
    usableTimestamp(input.now) && usableTimestamp(baseline.computedAt) &&
    baseline.computedAt <= input.now && input.now - baseline.computedAt <= config.baselineMaxAgeSeconds &&
    Number.isSafeInteger(baseline.sampleSize) && baseline.sampleSize >= config.baselineMinSamples &&
    Number.isFinite(baseline.windowHours * 3600) && baseline.windowHours > 0 &&
    usableUsd(baseline.medianTransferUsd) && usableUsd(baseline.p95TransferUsd) && baseline.p95TransferUsd > 0 &&
    baseline.medianTransferUsd <= baseline.p95TransferUsd &&
    usableUsd(baseline.rollingTvlUsd) && baseline.rollingTvlUsd > 0;
}

/** One observation drives both health and evidence; source failures mean unknown. */
function screeningSnapshot(transfer: BridgeTransfer, screening: ScreeningSource): boolean | null {
  try {
    const flagged = screening.isFlagged(transfer.to);
    return typeof flagged === 'boolean' ? flagged : null;
  } catch {
    return null;
  }
}

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
  if (transfer.backing) {
    const { burned, claimed, toleranceBps } = transfer.backing;
    // One-sided: a payout may come in under its burn (fees, rounding) by the
    // route's tolerance, and never above it by even one base unit.
    const matches = burned > 0n && claimed > 0n && claimed <= burned && toleranceBps >= 0n && toleranceBps <= 10_000n &&
      (burned - claimed) * 10_000n <= burned * toleranceBps;
    return {
      id: 'proof_payout_mismatch', score: matches ? 0 : 1, weight: 0.4,
      deterministic: !matches,
      reason: matches
        ? 'Claimed payout matches the source amount in exact token base units.'
        : burned <= 0n
          ? 'Payout has no verified source-chain backing.'
          : `Claimed payout ${claimed.toString()} base units does not match source backing ${burned.toString()} base units.`,
    };
  }
  const { provenBurnUsd, claimedPayoutUsd } = transfer;
  // Null is "this route exposes no proof to check" — nothing to say. Zero is
  // different: Tripwire looked for the source-chain burn and found none it
  // could verify. That is the worst case of this invariant, not a skip: it is
  // what a forged cross-chain message (Kelp DAO) and a malformed proof that
  // the relay accepted (Syscoin) look like from the destination chain.
  if (provenBurnUsd == null || claimedPayoutUsd == null) return null;
  if (!usableUsd(provenBurnUsd) || !usableUsd(claimedPayoutUsd)) return null;
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
  return screeningSignal(transfer, screening, screeningSnapshot(transfer, screening));
}

function screeningSignal(transfer: BridgeTransfer, screening: ScreeningSource, flagged: boolean | null): RiskSignal | null {
  // Null is "the list did not load", which is not the same as "not flagged".
  if (flagged === null) return null;

  let label = 'flagged address';
  if (flagged) {
    try { label = screening.describe(transfer.to) ?? label; } catch { /* Keep the positive observation even without a label. */ }
  }

  return {
    id: 'counterparty_screen',
    score: flagged ? 1 : 0,
    weight: 0.1,
    deterministic: flagged,
    reason: flagged
      ? `Recipient is on the screening list: ${label}.`
      : 'Recipient is not on the screening list.',
  };
}

/** A contract this young has no track record. Retold's scanner uses 30 days; a week is the sharper edge. */
const NEW_CONTRACT_DAYS = 7;
const YOUNG_CONTRACT_DAYS = 30;

/**
 * Rule 5 — what the money is going to.
 *
 * Retold's contract facts (verified source, age, upgradeability, admin
 * functions), scored against the outflow's target. Each is a fetched fact,
 * not an estimate, but no single one is damning: plenty of honest contracts
 * are young, or upgradeable. All three at once — unpublished code, deployed
 * days ago, replaceable — is the profile of a contract stood up to receive a
 * drain, and that combination alone is enough to throttle the route: the
 * gentlest tier, and never more on its own. Unknown facts add nothing and
 * are named in the reason, so an unchecked contract never reads as a clean one.
 */
export function contractRisk(target: ContractRiskSummary, config: ScorerConfig): RiskSignal | null {
  const { isVerified, ageDays, isUpgradeable, adminFunctions } = target;
  // Nothing was learned about the contract: there is nothing to score.
  if (isVerified === null && ageDays === null && isUpgradeable === null) return null;

  // Whole points, divided once at the end: 0.4 + 0.3 + 0.2 in floating point
  // is 0.8999999999999999, which would miss the 0.9 severe line by one ulp.
  let points = 0;
  const found: string[] = [];
  const unknown: string[] = [];

  if (isVerified === false) {
    points += 40;
    found.push('its source is not verified');
  } else if (isVerified === null) unknown.push('verification');

  if (ageDays === null) unknown.push('age');
  else if (ageDays < NEW_CONTRACT_DAYS) {
    points += 30;
    found.push(`it was deployed ${ageDays} day(s) ago`);
  } else if (ageDays < YOUNG_CONTRACT_DAYS) {
    points += 15;
    found.push(`it was deployed ${ageDays} days ago`);
  }

  if (isUpgradeable === true) {
    points += 20;
    found.push('its code can be replaced');
  } else if (isUpgradeable === null) unknown.push('upgradeability');

  if (adminFunctions.length > 0) {
    points += 10;
    found.push(`it exposes ${adminFunctions.join(', ')}`);
  }

  const score = Math.min(100, points) / 100;
  const who = `Target contract ${target.address.slice(0, 6)}…${target.address.slice(-4)}`;
  const unknownNote = unknown.length ? ` Could not determine its ${unknown.join(', ')}.` : '';

  return {
    id: 'contract_risk',
    score,
    weight: 0.2,
    floor: score >= config.severeSignal ? config.tripThreshold : undefined,
    reason:
      (found.length ? `${who}: ${found.join(', ')}.` : unknown.length
        ? `${who}: no risk indicators in the available facts.`
        : `${who} is verified and established.`) + unknownNote,
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
  /** Retold's facts about the contract the outflow goes to. Optional: fetched by the caller. */
  targetContract?: ContractRiskSummary;
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

  const configValid = usableConfig(config);
  const baselineFresh = configValid && usableBaseline(baseline, input, config);
  const flagged = screeningSnapshot(transfer, screening);

  const health: OracleHealth = {
    baselineFresh,
    screeningAvailable: flagged !== null,
    priceAvailable: usableUsd(transfer.amountUsd),
  };

  const signals: RiskSignal[] = [];
  if (!configValid) return {
    transfer, score: null, verdict: 'indeterminate', signals, health,
    degradedReason: 'Cannot assess: invalid scorer configuration.',
  };

  const transferTimeValid = usableTimestamp(input.now) && usableTimestamp(transfer.timestamp) && transfer.timestamp <= input.now;
  const since = transfer.timestamp - config.velocityWindowSeconds;
  const historyValid = transferTimeValid && input.recent.every((t) =>
    t.route !== transfer.route || t.hash === transfer.hash ||
    (usableTimestamp(t.timestamp) && t.timestamp <= input.now &&
      (t.timestamp < since || t.timestamp > transfer.timestamp || usableUsd(t.amountUsd)))
  );
  // The legacy USD proof is a demo heuristic. Malformed numbers are unavailable
  // evidence, not proof of a mismatch. Exact adapter backing remains authoritative.
  const legacyProofValid = transfer.backing !== undefined ||
    [transfer.provenBurnUsd, transfer.claimedPayoutUsd].every((n) => n == null || usableUsd(n));
  const mismatch = proofPayoutMismatch(transfer, config);
  if (mismatch) signals.push(mismatch);
  const screen = screeningSignal(transfer, screening, flagged);
  if (screen) signals.push(screen);
  const contract = input.targetContract ? contractRisk(input.targetContract, config) : null;
  if (contract) signals.push(contract);
  if (baselineFresh && baseline && health.priceAvailable && transferTimeValid) {
    const size = sizeVsBaseline(transfer, baseline);
    if (size) signals.push(size);
    const velocity = historyValid ? withdrawalVelocity(transfer, input.recent, baseline, config) : null;
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
    if (!transferTimeValid) reasons.push('invalid transfer timestamp or assessment clock');
    if (!historyValid) reasons.push('recent route history contains unavailable amounts or invalid timestamps');
    if (!legacyProofValid) reasons.push('invalid legacy proof amounts');

    // Every required input must be usable. Missing evidence cannot lower the
    // score into "clear", even when other signals are available.
    if (reasons.length > 0) {
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
  // A signal may also name the tier it justifies alone (contract risk: throttle).
  const signalFloor = Math.max(0, ...signals.map((s) => (s.score > 0 ? (s.floor ?? 0) : 0)));
  // Corroboration. A drain-profile contract, and — independently — an outflow of
  // anomalous size or pace: two unrelated facts pointing the same way earn
  // DELAY. Still not proof, so never FREEZE. Without this, a route whose burns
  // are visible could never reach DELAY: a calm proof signal carries 0.4 of
  // the weight, which caps every non-proof score at the THROTTLE floor.
  const severe = (id: RiskSignal['id']) => signals.some((s) => s.id === id && s.score >= config.severeSignal);
  const corroborated =
    severe('contract_risk') && (severe('size_vs_baseline') || severe('withdrawal_velocity'))
      ? config.delayThreshold
      : 0;
  const floor = firedDeterministic
    ? 1
    : Math.max(severeFired ? config.elevatedThreshold : 0, signalFloor, corroborated);
  const score = clamp01(Math.max(weighted, floor));

  const verdict: Verdict =
    score >= config.tripThreshold
      ? 'trip'
      : score >= config.elevatedThreshold
        ? 'elevated'
        : 'clear';

  return { transfer, score, verdict, signals, health };
}
