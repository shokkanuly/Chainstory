import { describe, expect, it } from 'vitest';
import { keccak256, toHex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { ResponseTier } from '../../../src/tripwire/onChain.js';
import type { RiskAssessment, RiskSignal } from '../../../src/tripwire/types.js';
import { MemoryFeed, type BurnEvent, type ReleaseEvent } from '../events.js';
import { ReleaseDecision, routePolicySchema, settlementVerdict, type RoutePolicy } from '../settlement.js';
import { Watcher, type Observation, type SourceEvidence } from '../watch.js';

const NOW = 1_780_000_000;
const MESSAGE = keccak256(toHex('settlement-firewall'));
const AMOUNT = 40_000n * 10n ** 6n;
const release: ReleaseEvent = { messageId: MESSAGE, amount: AMOUNT, recipient: actors.bridge.address, timestamp: NOW };
const healthy = { baselineFresh: true, priceAvailable: true, screeningAvailable: true };

function observation(over: {
  source?: SourceEvidence; score?: number | null; verdict?: RiskAssessment['verdict']; health?: Partial<RiskAssessment['health']>;
  signals?: RiskSignal[]; burned?: bigint | null; policy?: RoutePolicy; amount?: bigint;
} = {}): Observation {
  const source = over.source ?? { status: 'verified', amount: AMOUNT };
  const burned = over.burned !== undefined ? over.burned : source.status === 'verified' ? source.amount : source.status === 'invalid' ? 0n : null;
  const score = over.score === undefined ? 0.1 : over.score;
  return {
    release: { ...release, amount: over.amount ?? AMOUNT }, burned, source, ...(over.policy ? { policy: over.policy } : {}),
    assessment: {
      transfer: { hash: MESSAGE, chain: 'base', route: 'r', token: 'USDC', amountUsd: 40_000, timestamp: NOW, from: actors.owner.address, to: actors.bridge.address },
      score, verdict: over.verdict ?? (score === null ? 'indeterminate' : 'clear'),
      signals: over.signals ?? [], health: { ...healthy, ...over.health },
    },
  };
}

const mismatch: RiskSignal = { id: 'proof_payout_mismatch', score: 1, weight: 0.4, deterministic: true, reason: 'Claimed payout exceeds backing.' };
const flagged: RiskSignal = { id: 'counterparty_screen', score: 1, weight: 0.1, deterministic: true, reason: 'Recipient is on the screening list.' };
const clean: RiskSignal = { id: 'counterparty_screen', score: 0, weight: 0.1, reason: 'Recipient is not on the screening list.' };

/** The pre-ADR-023 rule from review.ts, kept verbatim as the equivalence oracle. */
function legacyDecision(o: Observation): ReleaseDecision {
  const { assessment, source } = o;
  if (source.status === 'invalid' || assessment.signals.some((s) =>
    s.id === 'proof_payout_mismatch' && s.deterministic && s.score > 0)) return ReleaseDecision.REJECT;
  if (source.status !== 'verified' || assessment.verdict === 'indeterminate' || assessment.score === null ||
    !Number.isFinite(assessment.score) || assessment.score < 0 || !assessment.health.baselineFresh ||
    !assessment.health.priceAvailable || !assessment.health.screeningAvailable || assessment.score >= 0.95) return ReleaseDecision.HOLD;
  return ReleaseDecision.ALLOW;
}

describe('the engine decides exactly as the rule it replaces, for every assessment the scorer can produce', () => {
  const sources: SourceEvidence[] = [
    { status: 'verified', amount: AMOUNT }, { status: 'pending', reason: 'p' },
    { status: 'unavailable', reason: 'u' }, { status: 'invalid', reason: 'i' },
  ];
  const scores = [null, Number.NaN, -0.1, 0, 0.64, 0.65, 0.85, 0.949, 0.95, 1];
  const healths = [healthy, { baselineFresh: false }, { priceAvailable: false }, { screeningAvailable: false }];
  const signalSets = [[], [clean], [flagged], [mismatch], [mismatch, flagged]];
  let cases = 0;
  it('across every combination of source status, score, health and signals', () => {
    for (const source of sources) for (const rawScore of scores) for (const health of healths) for (const signals of signalSets) {
      // scoreTransfer floors any fired deterministic signal to 1.0 (riskScorer.ts).
      const fired = signals.some((sig) => sig.deterministic && sig.score > 0);
      const score = fired && rawScore !== null && Number.isFinite(rawScore) && rawScore >= 0 ? 1 : rawScore;
      const o = observation({ source, score, health, signals });
      expect(settlementVerdict(o).decision, JSON.stringify({ source, score, health, signals }, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))).toBe(legacyDecision(o));
      cases++;
    }
    expect(cases).toBe(800);
  });

  it('is stricter than the old rule on an incoherent assessment: a screening hit holds whatever the score says', () => {
    const o = observation({ signals: [flagged], score: 0 });
    expect(legacyDecision(o)).toBe(ReleaseDecision.ALLOW);
    expect(settlementVerdict(o)).toMatchObject({ decision: ReleaseDecision.HOLD, reason: flagged.reason });
  });
});

describe('proof first', () => {
  it('rejects a release whose source proof failed and freezes the route, however calm the score', () => {
    const v = settlementVerdict(observation({ source: { status: 'invalid', reason: 'Source event is not MessageSent.' }, score: 0 }));
    expect(v).toMatchObject({ decision: ReleaseDecision.REJECT, routeTier: ResponseTier.FREEZE, reason: 'Source event is not MessageSent.' });
  });

  it('rejects a proven payout mismatch even with an authenticated source', () => {
    const v = settlementVerdict(observation({ signals: [mismatch], score: 0.2 }));
    expect(v.decision).toBe(ReleaseDecision.REJECT);
    expect(v.checks.find((c) => c.id === 'backing_covers_release')).toMatchObject({ kind: 'proof', status: 'fail' });
  });

  it.each(['pending', 'unavailable'] as const)('never allows on %s evidence, even with a zero score', (status) => {
    const v = settlementVerdict(observation({ source: { status, reason: 'Source receipt is not finalized.' }, score: 0 }));
    expect(v).toMatchObject({ decision: ReleaseDecision.HOLD, reason: 'Source receipt is not finalized.' });
  });

  it('lets suspicion hold a proven release but never reject it', () => {
    const v = settlementVerdict(observation({ signals: [flagged], score: 1 }));
    expect(v.decision).toBe(ReleaseDecision.HOLD);
    expect(v.routeTier).toBe(ResponseTier.FREEZE);
  });

  it('records every check with its kind, so an incident review can see why', () => {
    const v = settlementVerdict(observation({ signals: [clean] }));
    expect(v.decision).toBe(ReleaseDecision.ALLOW);
    expect(v.checks.map((c) => [c.id, c.kind, c.status])).toEqual([
      ['source_authenticated_final', 'proof', 'pass'], ['backing_covers_release', 'proof', 'pass'],
      ['risk_assessed', 'safety', 'pass'], ['oracle_health', 'safety', 'pass'], ['counterparty_screen', 'safety', 'pass'],
      ['route_policy_size', 'safety', 'pass'], ['risk_below_hold', 'safety', 'pass'],
    ]);
  });

  it('is deterministic: the same observation always yields the same verdict', () => {
    const o = observation({ signals: [flagged], score: 0.97 });
    expect(settlementVerdict(o)).toEqual(settlementVerdict(structuredClone(o)));
  });
});

describe('programmable route policy', () => {
  it('holds a proven release above the route\'s single-release limit, and allows one at it', () => {
    const over = settlementVerdict(observation({ policy: { maxSingleRelease: AMOUNT - 1n } }));
    expect(over).toMatchObject({ decision: ReleaseDecision.HOLD });
    expect(over.reason).toContain('exceeds the route limit');
    expect(settlementVerdict(observation({ policy: { maxSingleRelease: AMOUNT } })).decision).toBe(ReleaseDecision.ALLOW);
  });

  it('lowers the hold line, but a policy cannot raise it or drop below THROTTLE', () => {
    expect(settlementVerdict(observation({ score: 0.72, policy: { holdAtScore: 0.7 } })).decision).toBe(ReleaseDecision.HOLD);
    expect(settlementVerdict(observation({ score: 0.72 })).decision).toBe(ReleaseDecision.ALLOW);
    expect(routePolicySchema.safeParse({ holdAtScore: 0.99 }).success).toBe(false);
    expect(routePolicySchema.safeParse({ holdAtScore: 0.5 }).success).toBe(false);
    expect(routePolicySchema.safeParse({ maxSingleRelease: 0n }).success).toBe(false);
    expect(routePolicySchema.safeParse({ requireProof: false }).success).toBe(false);
  });

  it('cannot turn an unproven release into a payment', () => {
    const v = settlementVerdict(observation({ source: { status: 'pending', reason: 'Awaiting finality.' }, policy: { maxSingleRelease: AMOUNT * 10n } }));
    expect(v.decision).toBe(ReleaseDecision.HOLD);
  });

  it('is attached by the watcher to every observation, so decision and signed review read one policy', async () => {
    const ingress = new MemoryFeed<BurnEvent>(), egress = new MemoryFeed<ReleaseEvent>();
    const watcher = new Watcher({
      route: 'r', chain: 'base', token: 'USDC', decimals: 6, bridge: actors.owner.address, ingress, egress,
      baseline: { route: 'r', windowHours: 24, sampleSize: 100, medianTransferUsd: 10_000, p95TransferUsd: 100_000, rollingTvlUsd: 40_000_000, computedAt: NOW },
      screening: { isFlagged: () => false, describe: () => undefined }, now: () => NOW,
      verifySource: async (_r, burned) => burned === null ? { status: 'pending', reason: 'Not yet.' } : { status: 'verified', amount: burned },
      policy: { maxSingleRelease: 10_000n * 10n ** 6n },
    });
    ingress.emit({ messageId: MESSAGE, amount: AMOUNT, timestamp: NOW });
    egress.emit(release);
    const [o] = await watcher.tick();
    expect(o.policy).toEqual({ maxSingleRelease: 10_000n * 10n ** 6n });
    expect(settlementVerdict(o)).toMatchObject({ decision: ReleaseDecision.HOLD });
  });

  it('refuses an invalid policy when the watcher is configured', () => {
    expect(() => new Watcher({
      route: 'r', chain: 'base', token: 'USDC', decimals: 6, bridge: actors.owner.address,
      ingress: new MemoryFeed<BurnEvent>(), egress: new MemoryFeed<ReleaseEvent>(), baseline: null,
      screening: { isFlagged: () => false, describe: () => undefined }, now: () => NOW,
      policy: { holdAtScore: 1 },
    })).toThrow();
  });
});
