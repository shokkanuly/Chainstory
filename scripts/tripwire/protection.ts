// Operator state boundary; no keys, persistence or contract mutation here.
import { z } from 'zod';
import type { Hex } from 'viem';

export const guardianProtectionSchema = z.object({
  tier: z.number().int().min(0).max(3),
  expiresAt: z.bigint().nonnegative().max((1n << 64n) - 1n),
  /** Policy v4: the latest expiry an attestation could set now. At or before `now`, the oracle's span is spent. */
  limit: z.bigint().nonnegative().max((1n << 64n) - 1n),
  now: z.bigint().nonnegative().max(BigInt(Number.MAX_SAFE_INTEGER)),
  configured: z.boolean(),
  oracle: z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((value) => value.toLowerCase() as Hex),
}).strict().refine((state) => state.tier === 0 ? state.expiresAt === 0n : state.expiresAt > 0n,
  'Guardian tier and expiry are inconsistent.');
export type GuardianProtection = z.infer<typeof guardianProtectionSchema>;
