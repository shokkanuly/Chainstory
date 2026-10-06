import { z } from 'zod';

/** These markers validate the configured deployment, not arbitrary bytecode. */
export async function assertProtectionPolicy(reader: {
  guardianVersion(): Promise<unknown>;
  releaseVersion(): Promise<unknown>;
  reviewFormat(): Promise<unknown>;
  routePermission(): Promise<unknown>;
}, reviewFormat: 2 | 3 = 2): Promise<void> {
  z.literal(2n).parse(await reader.guardianVersion());
  z.literal(2n).parse(await reader.releaseVersion());
  z.literal(BigInt(reviewFormat)).parse(await reader.reviewFormat());
  z.literal(true).parse(await reader.routePermission());
}
