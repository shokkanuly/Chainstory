// Synthetic scorer observations. No network, imported approval or live baseline.
import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { projectBehavioralShadow, projectBehavioralAdvisory, type ShadowContext } from '../behavioralShadow.js';
import { behavioralShadowSchema, behavioralAdvisorySchema } from '../../domain/behavioralShadow.js';
import { scoreTransfer, type ScoreInput } from '../riskScorer.js';
import type { RiskAssessment } from '../types.js';
import { releaseDecision, ReleaseDecision } from '../../../scripts/tripwire/review.js';
import type { Observation, SourceEvidence } from '../../../scripts/tripwire/watch.js';

const now = 1_780_000_000;
const input = (override: Partial<ScoreInput> = {}): ScoreInput => ({
  transfer: { hash: `0x${'12'.repeat(32)}`, chain: 'base', route: 'synthetic:route', token: 'USDC', amountUsd: 1,
    timestamp: now, from: 'synthetic-source', to: 'synthetic-recipient', backing: { burned: 1_000_000n, claimed: 1_000_000n, toleranceBps: 0n } },
  baseline: { route: 'synthetic:route', computedAt: now, windowHours: 24, sampleSize: 100,
    medianTransferUsd: 100, p95TransferUsd: 1000, rollingTvlUsd: 1_000_000 },
  recent: [], screening: { isFlagged: () => false, describe: () => undefined }, now, ...override,
});
const context: ShadowContext = { route: 'synthetic:route', transferId: input().transfer.hash, capturedAt: now, checkedAt: now, synthetic: true };
function project(assessment: unknown = scoreTransfer(input()), change: Partial<ShadowContext> = {}) {
  const result = projectBehavioralShadow(assessment, { ...context, ...change });
  if (!result.ok) throw new Error(`Synthetic projection failed: ${result.reason}`); return result.value;
}
function observation(assessment: RiskAssessment, source: SourceEvidence = { status: 'verified', amount: 1_000_000n }): Observation {
  return { release: { messageId: input().transfer.hash as `0x${string}`, recipient: `0x${'34'.repeat(20)}`, amount: 1_000_000n, timestamp: now },
    burned: source.status === 'verified' ? source.amount : null, source, assessment };
}
describe('read-only behavioral shadow contract', () => {
  it('wraps an actual existing scorer assessment for display without copying raw reasons or affecting HOLD', () => {
    const assessment = scoreTransfer(input({ baseline: null, targetContract: {
      address: 'synthetic-recipient', isVerified: false, ageDays: 1, isUpgradeable: true, adminFunctions: [],
    } }));
    assessment.signals[0].reason = 'https://secret:REDACTION_SENTINEL@rpc.invalid';
    const before = structuredClone(assessment), advisory = projectBehavioralAdvisory(assessment, context);
    expect(behavioralAdvisorySchema.parse(JSON.parse(JSON.stringify(advisory)))).toEqual(advisory);
    expect(advisory.status).toBe('reported'); expect(JSON.stringify(advisory)).not.toContain('REDACTION_SENTINEL');
    expect(assessment).toEqual(before); expect(releaseDecision(observation(assessment))).toBe(ReleaseDecision.HOLD);
  });
  it('turns missing/refused display input into fixed unavailable reasons, never fabricated scores', () => {
    expect(projectBehavioralAdvisory()).toEqual({ version: 1, status: 'unavailable', reason: 'assessment-not-produced' });
    expect(projectBehavioralAdvisory({}, context)).toEqual({ version: 1, status: 'unavailable', reason: 'invalid-input' });
    expect(projectBehavioralAdvisory(scoreTransfer(input()), { ...context, transferId: 'other' }))
      .toEqual({ version: 1, status: 'unavailable', reason: 'scope-mismatch' });
  });
  it('validates the standalone synthetic fixture without making it an assessment or observation', () => {
    const value = behavioralShadowSchema.parse(JSON.parse(readFileSync('src/testing/fixtures/tripwire/behavioral-shadow-synthetic.json', 'utf8')));
    expect(value.synthetic).toBe(true); expect(value.authorization).toBe('none');
    expectTypeOf(value).not.toMatchTypeOf<RiskAssessment>(); expectTypeOf(value).not.toMatchTypeOf<Observation>();
  });
  it('projects existing scores without total verdict, tiers, money or mandatory-signal demotion', () => {
    const assessment = scoreTransfer(input()), value = project(assessment);
    expect(value.signals.map((s) => s.id)).toEqual(['size_vs_baseline', 'withdrawal_velocity', 'contract_risk']);
    expect(value.signals[0]).toMatchObject({ status: 'reported', score: assessment.signals.find((s) => s.id === 'size_vs_baseline')?.score });
    expect(value.signals[2]).toEqual({ id: 'contract_risk', status: 'unavailable', score: null, reason: 'not-reported' });
    expect(value).toMatchObject({ mode: 'behavioral-shadow', authorization: 'none', enforcement: false, executionPolicy: 'legacy-enforced', synthetic: true });
    expect(JSON.stringify(value)).not.toMatch(/proof_payout_mismatch|counterparty_screen|"verdict"|minimumTier|validUntil|signature|"amount"/);
    expect(behavioralShadowSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });
  it('retains observed contract indicators when the existing scorer cannot form an aggregate opinion', () => {
    const assessment = scoreTransfer(input({ baseline: null, targetContract: {
      address: 'synthetic-recipient', isVerified: false, ageDays: 1, isUpgradeable: true, adminFunctions: [],
    } }));
    expect(assessment.verdict).toBe('indeterminate'); const value = project(assessment);
    expect(value.signals[0]).toMatchObject({ status: 'unavailable', score: null });
    expect(value.signals[2]).toMatchObject({ status: 'reported', score: 0.9 });
    expect(releaseDecision(observation(assessment))).toBe(ReleaseDecision.HOLD);
  });
  it('does not read/reprice/score again or mutate the original observation', () => {
    const assessment = scoreTransfer(input()), before = structuredClone(assessment); project(assessment);
    expect(assessment).toEqual(before); expect(releaseDecision(observation(assessment))).toBe(ReleaseDecision.ALLOW);
  });
  it.each(['baseline', 'price', 'screening', 'source-pending', 'source-unavailable', 'source-invalid', 'mismatch'] as const)
    ('leaves the existing release gate unchanged with %s failure', (failure) => {
      const scored = input(); let source: SourceEvidence = { status: 'verified', amount: 1_000_000n };
      if (failure === 'baseline') scored.baseline = null;
      if (failure === 'price') scored.transfer.amountUsd = null;
      if (failure === 'screening') scored.screening = { isFlagged: () => null, describe: () => undefined };
      if (failure.startsWith('source-')) source = { status: failure.slice(7) as 'pending' | 'unavailable' | 'invalid', reason: 'Synthetic missing or invalid evidence' };
      if (failure === 'mismatch') scored.transfer.backing = { burned: 999_999n, claimed: 1_000_000n, toleranceBps: 0n };
      const o = observation(scoreTransfer(scored), source), before = structuredClone(o), decision = releaseDecision(o);
      const value = project(o.assessment); expect(o).toEqual(before); expect(releaseDecision(o)).toBe(decision);
      expect(decision).toBe(['source-invalid', 'mismatch'].includes(failure) ? ReleaseDecision.REJECT : ReleaseDecision.HOLD);
      expect(value.authorization).toBe('none'); expect(value.enforcement).toBe(false);
    });
  it.each([{ enforcement: true }, { authorization: 'ALLOW' }, { executionPolicy: 'shadow-only' }, { decision: 0 },
    { minimumTier: 0 }, { signature: 'synthetic' }, { version: 2 }, { score: 0 }, { verdict: 'clear' }])
    ('refuses execution or incompatible fields %j', (change) => expect(behavioralShadowSchema.safeParse({ ...project(), ...change }).success).toBe(false));
  it.each(['proof_payout_mismatch', 'counterparty_screen', 'unknown'])('refuses %s as a projected behavioral signal', (id) => {
    const value = project(); const signals = structuredClone(value.signals); const modified = { ...signals[0], id };
    expect(behavioralShadowSchema.safeParse({ ...value, signals: [modified, signals[1], signals[2]] }).success).toBe(false);
  });
  it.each([NaN, Infinity, -1, 1.1, null])('does not turn malformed signal score %s into zero', (score) => {
    const value = project({ transfer: { route: context.route, hash: context.transferId }, signals: [{ id: 'size_vs_baseline', score }] });
    expect(value.signals[0]).toMatchObject({ status: 'unavailable', score: null, reason: 'invalid-signal' });
  });
  it('refuses duplicate or deterministic-tagged behavioral input', () => {
    for (const signals of [[{ id: 'size_vs_baseline', score: 0 }, { id: 'size_vs_baseline', score: 1 }],
      [{ id: 'size_vs_baseline', score: 0, deterministic: true }]]) {
      expect(project({ transfer: { route: context.route, hash: context.transferId }, signals }).signals[0]).toMatchObject({ reason: 'invalid-signal', score: null });
    }
  });
  it('keeps missing signals explicitly unavailable and refuses reordered/incomplete reports', () => {
    const value = project({ transfer: { route: context.route, hash: context.transferId }, signals: [] });
    expect(value.signals.every((s) => s.status === 'unavailable' && s.score === null)).toBe(true);
    expect(behavioralShadowSchema.safeParse({ ...value, signals: value.signals.slice(1) }).success).toBe(false);
    expect(behavioralShadowSchema.safeParse({ ...value, signals: [...value.signals].reverse() }).success).toBe(false);
  });
  it('suppresses stale/future scores without changing capture time, and respects the exact age boundary', () => {
    expect(project(undefined, { checkedAt: now + 300 }).freshness).toBe('current');
    for (const change of [{ checkedAt: now + 301 }, { checkedAt: now - 1 }]) {
      const value = project(undefined, change); expect(value.capturedAt).toBe(now);
      expect(value.signals.every((s) => s.status === 'unavailable' && s.score === null)).toBe(true);
      const signals = structuredClone(value.signals); signals[0] = project().signals[0];
      expect(behavioralShadowSchema.safeParse({ ...value, signals }).success).toBe(false);
      expect(behavioralShadowSchema.safeParse({ ...value, freshness: 'current' }).success).toBe(false);
    }
  });
  it.each([{ capturedAt: NaN }, { checkedAt: Infinity }, { capturedAt: -1 }, { maxAgeSeconds: 0 }, { synthetic: undefined }])
    ('refuses malformed capture context %j instead of inventing current evidence', (change) => {
      expect(projectBehavioralShadow(scoreTransfer(input()), { ...context, ...change })).toEqual({ ok: false, reason: 'invalid-input' });
    });
  it.each([{ route: 'other' }, { transferId: 'other' }])('refuses cross-scope projection %j', (change) => {
    expect(projectBehavioralShadow(scoreTransfer(input()), { ...context, ...change })).toEqual({ ok: false, reason: 'scope-mismatch' });
  });
  it('refuses unknown source signals and never copies raw input prose or credentials', () => {
    const assessment = scoreTransfer(input()); assessment.signals[0].reason = 'https://user:REDACTION_SENTINEL@rpc.invalid';
    expect(JSON.stringify(project(assessment))).not.toContain('REDACTION_SENTINEL');
    expect(projectBehavioralShadow({ ...assessment, signals: [{ id: 'unknown', score: 0 }] }, context)).toEqual({ ok: false, reason: 'invalid-input' });
  });
});
