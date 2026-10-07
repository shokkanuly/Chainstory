// Pure projection of an existing assessment, never a second scorer or release gate.
import { z } from 'zod';
import { behavioralShadowSchema, shadowContextSchema, type BehavioralAdvisory, type BehavioralShadow, type BehavioralSignalId, type BehavioralShadowSignal } from '../domain/behavioralShadow.js';
export type { ShadowContext } from '../domain/behavioralShadow.js';

const signalId = z.enum(['proof_payout_mismatch', 'counterparty_screen', 'size_vs_baseline', 'withdrawal_velocity', 'contract_risk']);
const assessmentSchema = z.object({ transfer: z.object({ route: shadowContextSchema.shape.route, hash: shadowContextSchema.shape.transferId }),
  signals: z.array(z.unknown()).max(5) }); // Other assessment fields do not become shadow claims.
const signalIdentity = z.object({ id: signalId });
const signalValue = z.object({ score: z.number().min(0).max(1), deterministic: z.boolean().optional() });
export type ShadowProjectionResult = { ok: true; value: BehavioralShadow } | { ok: false; reason: 'invalid-input' | 'scope-mismatch' };

export function projectBehavioralShadow(assessment: unknown, context: unknown): ShadowProjectionResult {
  const parsed = assessmentSchema.safeParse(assessment), scope = shadowContextSchema.safeParse(context);
  if (!parsed.success || !scope.success) return { ok: false, reason: 'invalid-input' };
  if (parsed.data.transfer.route !== scope.data.route || parsed.data.transfer.hash !== scope.data.transferId)
    return { ok: false, reason: 'scope-mismatch' };
  const signals = parsed.data.signals.map((raw) => ({ raw, identity: signalIdentity.safeParse(raw) }));
  if (signals.some((s) => !s.identity.success)) return { ok: false, reason: 'invalid-input' };
  const freshness = scope.data.capturedAt > scope.data.checkedAt ? 'future'
    : scope.data.checkedAt - scope.data.capturedAt > scope.data.maxAgeSeconds ? 'stale' : 'current';
  const project = (id: BehavioralSignalId): BehavioralShadowSignal => {
    if (freshness !== 'current') return { id, status: 'unavailable', score: null,
      reason: freshness === 'stale' ? 'stale-assessment' : 'future-assessment' };
    const candidates = signals.filter((s) => s.identity.success && s.identity.data.id === id);
    if (!candidates.length) return { id, status: 'unavailable', score: null, reason: 'not-reported' };
    if (candidates.length !== 1) return { id, status: 'unavailable', score: null, reason: 'invalid-signal' };
    const value = signalValue.safeParse(candidates[0].raw);
    if (!value.success || value.data.deterministic === true) return { id, status: 'unavailable', score: null, reason: 'invalid-signal' };
    return { id, status: 'reported', score: value.data.score, evidence: 'existing-scorer-signal' };
  };
  const value = behavioralShadowSchema.parse({ version: 1, mode: 'behavioral-shadow', enforcement: false,
    authorization: 'none', executionPolicy: 'legacy-enforced', source: 'existing-scorer', ...scope.data, freshness,
    signals: [project('size_vs_baseline'), project('withdrawal_velocity'), project('contract_risk')] });
  return { ok: true, value };
}

// No input means the producer did not run a scorer, not that risk is zero.
export function projectBehavioralAdvisory(assessment?: unknown, context?: unknown): BehavioralAdvisory {
  if (assessment === undefined) return { version: 1, status: 'unavailable', reason: 'assessment-not-produced' };
  const projected = projectBehavioralShadow(assessment, context);
  return projected.ok ? { version: 1, status: 'reported', assessment: projected.value }
    : { version: 1, status: 'unavailable', reason: projected.reason };
}
