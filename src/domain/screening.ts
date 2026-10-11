// Screening evidence vocabulary (H4c2, ADR-045). Read-only: a result never
// authorizes a payout, signs, scores, selects a guardian tier or mutates state.
// EVM addresses, hashing and signatures live in src/chains/evm/screening.ts.
import { z } from 'zod';

/** Signed outcome values. NOT_LISTED means no match in that snapshot at that time, not "safe". */
export const SCREENING_OUTCOMES = ['UNKNOWN', 'NOT_LISTED', 'MATCHED'] as const;
export type ScreeningOutcome = typeof SCREENING_OUTCOMES[number];

/** The closed reason catalog of ADR-045. An arbitrary error message never selects one. */
export const SCREENING_UNAVAILABLE_REASONS = ['missing', 'invalid-input', 'unsupported-version', 'scope-mismatch',
  'profile-mismatch', 'head-mismatch', 'invalid-signature', 'issuer-conflict', 'future', 'expired', 'contradictory',
  'provider-unavailable'] as const;
export type ScreeningUnavailableReason = typeof SCREENING_UNAVAILABLE_REASONS[number];

/** What an external adapter reports when it has no evidence: a typed union, never free text. */
export const screeningProviderStatusSchema = z.enum(['missing', 'provider-unavailable']);

const uint64 = z.bigint().nonnegative().max((1n << 64n) - 1n);
const digest = z.string().regex(/^0x[0-9a-f]{64}$/);

export const screeningVerifiedSchema = z.object({
  status: z.literal('verified'), outcome: z.enum(SCREENING_OUTCOMES), authorization: z.literal('none'),
  /** Original issuer times; re-verifying later never refreshes them. */
  listAsOf: uint64, checkedAt: uint64, receiptValidUntil: uint64, headValidUntil: uint64, revision: uint64,
  /** The destination block time the caller supplied; the verifier reads no clock. */
  evaluatedAt: uint64,
  profileHash: digest, headHash: digest, receiptHash: digest, paymentContextHash: digest,
  /** Distinct authenticated receipts after deduplication (all with this outcome). */
  receipts: z.number().int().min(1).max(8),
  /** Caller-supplied inputs are not proven to come from canonical chain state (H4c3 supplies them). */
  provenance: z.literal('caller-supplied-scope'),
}).strict();
export type ScreeningVerified = z.infer<typeof screeningVerifiedSchema>;

export const screeningUnavailableSchema = z.object({
  status: z.literal('unavailable'), reason: z.enum(SCREENING_UNAVAILABLE_REASONS), authorization: z.literal('none'),
}).strict();
export type ScreeningUnavailable = z.infer<typeof screeningUnavailableSchema>;

export const screeningEvidenceSchema = z.discriminatedUnion('status', [screeningVerifiedSchema, screeningUnavailableSchema]);
export type ScreeningEvidence = z.infer<typeof screeningEvidenceSchema>;

export const screeningUnavailable = (reason: ScreeningUnavailableReason): ScreeningUnavailable =>
  ({ status: 'unavailable', reason, authorization: 'none' });
