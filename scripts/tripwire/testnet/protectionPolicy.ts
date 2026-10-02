import { z } from 'zod';

/**
 * These markers validate the configured deployment, not arbitrary bytecode.
 * Version 3 (ADR-021): the oracle may be a k-of-n TripwireQuorum contract.
 * Version 4 (ADR-024, ADR-025): time-locked oracle rotation and kill switch,
 * 72-hour oracle protection spans, cumulative DELAY, and a 7-day REJECT hold
 * in place of terminal rejection. A v3 deployment is refused: its REJECT can
 * strand funds and its owner can swap the oracle instantly.
 */
export async function assertProtectionPolicy(reader: {
  guardianVersion(): Promise<unknown>;
  releaseVersion(): Promise<unknown>;
  routePermission(): Promise<unknown>;
}): Promise<void> {
  z.literal(4n).parse(await reader.guardianVersion());
  z.literal(4n).parse(await reader.releaseVersion());
  z.literal(true).parse(await reader.routePermission());
}
