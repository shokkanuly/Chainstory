import { z } from 'zod';

/**
 * These markers validate the configured deployment, not arbitrary bytecode.
 * Version 3 (ADR-021): the oracle may be a k-of-n TripwireQuorum contract.
 */
export async function assertProtectionPolicy(reader: {
  guardianVersion(): Promise<unknown>;
  releaseVersion(): Promise<unknown>;
  routePermission(): Promise<unknown>;
}): Promise<void> {
  z.literal(3n).parse(await reader.guardianVersion());
  z.literal(3n).parse(await reader.releaseVersion());
  z.literal(true).parse(await reader.routePermission());
}
