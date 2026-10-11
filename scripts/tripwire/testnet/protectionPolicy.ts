import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError } from 'viem';
import { z } from 'zod';

/**
 * These markers validate the configured deployment, not arbitrary bytecode.
 * Version 3 (ADR-021): the oracle may be a k-of-n TripwireQuorum contract.
 * Version 4 (ADR-024, ADR-025): time-locked oracle rotation and kill switch,
 * 72-hour oracle protection spans, cumulative DELAY, and a 7-day REJECT hold
 * in place of terminal rejection. A v3 deployment is refused: its REJECT can
 * strand funds and its owner can swap the oracle instantly.
 * Review format 2 is the plain vault/escrow; format 3 is the customer payment
 * escrow (ADR-028), whose reviews also commit to the customer policy;
 * format 4 is the screened escrow (ADR-047), whose ALLOW also commits to the
 * issuer's screening receipt.
 */
export async function assertProtectionPolicy(reader: {
  guardianVersion(): Promise<unknown>;
  releaseVersion(): Promise<unknown>;
  reviewFormat(): Promise<unknown>;
  routePermission(): Promise<unknown>;
}, reviewFormat: 2 | 3 | 4 = 2): Promise<void> {
  z.literal(4n).parse(await reader.guardianVersion());
  z.literal(4n).parse(await reader.releaseVersion());
  // Policy v4 vaults deployed before REVIEW_FORMAT_VERSION existed (Sepolia,
  // 2026-10-03) sign format 2 and have no getter: an empty revert means 2.
  // Any other failure, and every format-3 check, still refuses.
  const format = await reader.reviewFormat().catch((error: unknown) => {
    if (reviewFormat === 2 && missingGetter(error)) return 2n;
    throw error;
  });
  z.literal(BigInt(reviewFormat)).parse(format);
  z.literal(true).parse(await reader.routePermission());
}

/** The call reached the contract and it has no such function: an empty revert, not an RPC failure. */
function missingGetter(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  const cause = error.walk((e) => e instanceof ContractFunctionRevertedError || e instanceof ContractFunctionZeroDataError);
  if (cause instanceof ContractFunctionZeroDataError) return true;
  return cause instanceof ContractFunctionRevertedError && cause.data === undefined && cause.reason === undefined && cause.signature === undefined;
}
