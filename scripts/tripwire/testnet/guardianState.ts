import { z } from 'zod';
import { blockHeaderSchema } from '../finality.js';
import { guardianProtectionSchema, type GuardianProtection } from '../protection.js';

interface GuardianStateReader {
  getBlock(args: { blockTag: 'latest' } | { blockNumber: bigint }): Promise<unknown>;
  readRoute(blockNumber: bigint): Promise<unknown>;
  readOracle(blockNumber: bigint): Promise<unknown>;
  /** Do not reconcile against a head behind an already observed write receipt. */
  minimumBlock?(): bigint;
}
const routeSchema = z.object({ tier: z.number().int().min(0).max(3),
  tierExpiresAt: z.bigint().nonnegative(), windowSeconds: z.bigint().nonnegative() });

/** Latest state is needed for refresh/review TTLs; source proofs stay finalized. */
export async function readGuardianProtection(reader: GuardianStateReader): Promise<GuardianProtection> {
  const head = blockHeaderSchema.parse(await reader.getBlock({ blockTag: 'latest' }));
  if (head.number < (reader.minimumBlock?.() ?? 0n)) throw new Error('Guardian RPC is behind an observed transaction.');
  const route = routeSchema.parse(await reader.readRoute(head.number));
  const oracle = await reader.readOracle(head.number);
  const checked = blockHeaderSchema.parse(await reader.getBlock({ blockNumber: head.number }));
  if (checked.number !== head.number || checked.hash !== head.hash || checked.timestamp !== head.timestamp) {
    throw new Error('Guardian state block changed while reading protection.');
  }
  return guardianProtectionSchema.parse({ tier: route.tier, expiresAt: route.tierExpiresAt, now: head.timestamp,
    configured: route.windowSeconds > 0n, oracle });
}
