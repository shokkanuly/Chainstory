// scripts/tripwire/settlement.ts
//
// The settlement firewall's decision, in one pure function (ADR-023). Given an
// observed release and its evidence, it answers: may this money move?
//
// Proof first. Two kinds of check, and the order is the point:
//
//   PROOF invariants are facts about the chain. Is the source event
//   authenticated and final? Does it back this exact payout? A failed proof is
//   terminal: REJECT, and the route is frozen. An unknown proof holds; missing
//   evidence never becomes permission.
//
//   SAFETY checks are operating limits and supporting risk signals: route
//   policy, oracle health, counterparty screening, the behavioral score. They
//   can only HOLD a release whose proof passed. They can never approve one
//   whose proof did not, and never reject on suspicion alone.
//
// Every caller that decides or signs a release reads this function, so the
// operator's decision and the signed review cannot disagree. No clock, network
// or randomness: the same observation always yields the same verdict.
import { z } from 'zod';
import { getTierForScore, ResponseTier } from '../../src/tripwire/onChain.js';
import type { Observation } from './watch.js';

export enum ReleaseDecision { ALLOW = 0, HOLD = 1, REJECT = 2 }

/** The firewall's default line: a supporting score at or above this holds a proven release. */
export const DEFAULT_HOLD_SCORE = 0.95;

/**
 * Programmable per-route limits. A policy can only tighten the defaults: it
 * adds holds, never removes a proof requirement or a hold.
 */
export const routePolicySchema = z.object({
  /** Largest single release, in token base units, that may pay without a human. */
  maxSingleRelease: z.bigint().positive().optional(),
  /** Hold proven releases whose supporting risk score reaches this (0.65 THROTTLE … 0.95 default). */
  holdAtScore: z.number().min(0.65).max(DEFAULT_HOLD_SCORE).optional(),
}).strict();
export type RoutePolicy = z.infer<typeof routePolicySchema>;

export type CheckKind = 'proof' | 'safety';
export type CheckStatus = 'pass' | 'fail' | 'unknown';
export type CheckId =
  | 'source_authenticated_final'
  | 'backing_covers_release'
  | 'risk_assessed'
  | 'oracle_health'
  | 'counterparty_screen'
  | 'route_policy_size'
  | 'risk_below_hold';

export interface InvariantCheck { id: CheckId; kind: CheckKind; status: CheckStatus; detail: string }

export interface SettlementVerdict {
  decision: ReleaseDecision;
  /** Guardian tier the evidence justifies for the route. A failed proof freezes. */
  routeTier: ResponseTier;
  /** The check that decided, for the incident record. */
  reason: string;
  checks: InvariantCheck[];
}

const check = (id: CheckId, kind: CheckKind, status: CheckStatus, detail: string): InvariantCheck => ({ id, kind, status, detail });

export function settlementChecks(observation: Observation): InvariantCheck[] {
  const { assessment, source, release } = observation;
  const policy = routePolicySchema.parse(observation.policy ?? {});
  const signal = (id: string) => assessment.signals.find((s) => s.id === id);
  const score = assessment.score;
  const scored = assessment.verdict !== 'indeterminate' && score !== null && Number.isFinite(score) && score >= 0;
  const backing = signal('proof_payout_mismatch');
  const screen = signal('counterparty_screen');
  const health = assessment.health;
  const holdAt = policy.holdAtScore ?? DEFAULT_HOLD_SCORE;

  return [
    source.status === 'verified'
      ? check('source_authenticated_final', 'proof', 'pass', 'Source event is authenticated and final.')
      : check('source_authenticated_final', 'proof', source.status === 'invalid' ? 'fail' : 'unknown', source.reason),
    backing?.deterministic && backing.score > 0
      ? check('backing_covers_release', 'proof', 'fail', backing.reason)
      : observation.burned === null
        ? check('backing_covers_release', 'proof', 'unknown', 'No verified source amount to compare against.')
        : check('backing_covers_release', 'proof', 'pass', 'Verified source backing covers this exact payout.'),
    scored
      ? check('risk_assessed', 'safety', 'pass', `Supporting risk score ${score.toFixed(2)}.`)
      : check('risk_assessed', 'safety', 'unknown', assessment.degradedReason ?? 'The release could not be scored.'),
    health.baselineFresh && health.priceAvailable && health.screeningAvailable
      ? check('oracle_health', 'safety', 'pass', 'Baseline, pricing and screening are available.')
      : check('oracle_health', 'safety', 'fail', [
        !health.baselineFresh && 'route baseline is missing or stale',
        !health.priceAvailable && 'the transfer could not be priced',
        !health.screeningAvailable && 'the screening list is unavailable',
      ].filter(Boolean).join('; ') + '.'),
    screen?.deterministic && screen.score > 0
      ? check('counterparty_screen', 'safety', 'fail', screen.reason)
      : check('counterparty_screen', 'safety', screen ? 'pass' : 'unknown', screen?.reason ?? 'Screening did not run.'),
    policy.maxSingleRelease === undefined || release.amount <= policy.maxSingleRelease
      ? check('route_policy_size', 'safety', 'pass', 'Within the route\'s single-release limit.')
      : check('route_policy_size', 'safety', 'fail', `Release of ${release.amount} base units exceeds the route limit of ${policy.maxSingleRelease}.`),
    !scored
      ? check('risk_below_hold', 'safety', 'unknown', 'No supporting score to compare with the hold line.')
      : score < holdAt
        ? check('risk_below_hold', 'safety', 'pass', `Below the hold line of ${holdAt}.`)
        : check('risk_below_hold', 'safety', 'fail', `Supporting score ${score.toFixed(2)} reaches the hold line of ${holdAt}.`),
  ];
}

/**
 * `legacy` (default): proofs and safety checks decide, as above.
 * `advisory`: only on a screened escrow whose customer consented on chain
 * (ADR-045/048). Proofs still decide; safety checks are reported but never
 * hold, and the verdict asks for no route tier: nothing here feeds the
 * aggregate attestor. The authenticated screening gate, customer policy and
 * guardian execution checks still apply after this.
 */
export type SettlementMode = 'legacy' | 'advisory';

export function settlementVerdict(observation: Observation, mode: SettlementMode = 'legacy'): SettlementVerdict {
  const checks = settlementChecks(observation);
  const failedProof = checks.find((c) => c.kind === 'proof' && c.status === 'fail');
  if (mode === 'advisory') {
    const unproven = checks.find((c) => c.kind === 'proof' && c.status === 'unknown');
    if (failedProof) return { decision: ReleaseDecision.REJECT, routeTier: ResponseTier.NONE, reason: failedProof.detail, checks };
    if (unproven) return { decision: ReleaseDecision.HOLD, routeTier: ResponseTier.NONE, reason: unproven.detail, checks };
    return { decision: ReleaseDecision.ALLOW, routeTier: ResponseTier.NONE,
      reason: 'Every proof invariant holds; behavioral signals are advisory under the customer\'s on-chain consent.', checks };
  }
  const score = observation.assessment.score;
  const tier = score !== null && Number.isFinite(score) && score >= 0 && score <= 1 ? getTierForScore(score) : ResponseTier.NONE;
  if (failedProof) return { decision: ReleaseDecision.REJECT, routeTier: ResponseTier.FREEZE, reason: failedProof.detail, checks };
  // Screening is a safety check, but an unrun screen only matters through health.
  const blocking = checks.find((c) => c.status === 'fail' || (c.status === 'unknown' && c.id !== 'counterparty_screen'));
  if (blocking) return { decision: ReleaseDecision.HOLD, routeTier: tier, reason: blocking.detail, checks };
  return { decision: ReleaseDecision.ALLOW, routeTier: tier, reason: 'Every proof invariant and safety limit holds.', checks };
}
