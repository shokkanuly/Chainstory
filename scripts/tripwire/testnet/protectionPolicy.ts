import { z } from 'zod';

/** These markers validate the configured deployment, not arbitrary bytecode. */
export async function assertProtectionPolicy(reader: {
  guardianVersion(): Promise<unknown>;
  releaseVersion(): Promise<unknown>;
  routePermission(): Promise<unknown>;
}): Promise<void> {
  z.literal(2n).parse(await reader.guardianVersion());
  z.literal(2n).parse(await reader.releaseVersion());
  z.literal(true).parse(await reader.routePermission());
}
