// Display-only vocabulary. No execution decision, proof, signature or guardian tier.
import { z } from 'zod';

export const BEHAVIORAL_SIGNAL_IDS = ['size_vs_baseline', 'withdrawal_velocity', 'contract_risk'] as const;
export type BehavioralSignalId = typeof BEHAVIORAL_SIGNAL_IDS[number];
const clock = z.number().int().min(0).max(253402300799);
const identity = z.string().min(1).max(256).regex(/^[\x21-\x7e]+$/);
export const shadowContextSchema = z.object({ route: identity, transferId: identity, capturedAt: clock, checkedAt: clock,
  maxAgeSeconds: z.number().int().min(1).max(21600).default(300), synthetic: z.boolean() }).strict();
export type ShadowContext = z.input<typeof shadowContextSchema>;
const missingReason = z.enum(['not-reported', 'invalid-signal', 'stale-assessment', 'future-assessment']);
function signalSchema<T extends BehavioralSignalId>(id: T) {
  return z.discriminatedUnion('status', [
    z.object({ id: z.literal(id), status: z.literal('reported'), score: z.number().min(0).max(1),
      evidence: z.literal('existing-scorer-signal') }).strict(),
    z.object({ id: z.literal(id), status: z.literal('unavailable'), score: z.null(), reason: missingReason }).strict(),
  ]);
}
export const behavioralShadowSchema = shadowContextSchema.extend({
  version: z.literal(1), mode: z.literal('behavioral-shadow'), enforcement: z.literal(false),
  authorization: z.literal('none'), executionPolicy: z.literal('legacy-enforced'),
  source: z.literal('existing-scorer'), maxAgeSeconds: shadowContextSchema.shape.maxAgeSeconds.removeDefault(),
  freshness: z.enum(['current', 'stale', 'future']),
  signals: z.tuple([signalSchema('size_vs_baseline'), signalSchema('withdrawal_velocity'), signalSchema('contract_risk')]),
}).strict().superRefine((value, ctx) => {
  const freshness = value.capturedAt > value.checkedAt ? 'future'
    : value.checkedAt - value.capturedAt > value.maxAgeSeconds ? 'stale' : 'current';
  if (freshness !== value.freshness) ctx.addIssue({ code: 'custom', message: 'Shadow freshness differs from its original capture time.' });
  if (freshness !== 'current') {
    const reason = freshness === 'stale' ? 'stale-assessment' : 'future-assessment';
    if (value.signals.some((s) => s.status !== 'unavailable' || s.reason !== reason))
      ctx.addIssue({ code: 'custom', message: 'Old or future shadow signals cannot report current scores.' });
  } else if (value.signals.some((s) => s.status === 'unavailable' && ['stale-assessment', 'future-assessment'].includes(s.reason))) {
    ctx.addIssue({ code: 'custom', message: 'Current capture time contradicts signal freshness.' });
  }
});
export type BehavioralShadow = z.infer<typeof behavioralShadowSchema>;
export type BehavioralShadowSignal = BehavioralShadow['signals'][number];
