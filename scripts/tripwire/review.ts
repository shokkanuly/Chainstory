// Operator-only release reviews. They add an execution gate to the demo vault;
// they do not authenticate bridge messages or replace independent source proofs.
import type { Hex, LocalAccount } from 'viem';
import type { Observation } from './watch.js';
import { getTierForScore, ResponseTier } from '../../src/tripwire/onChain.js';

export enum ReleaseDecision { ALLOW = 0, HOLD = 1, REJECT = 2 }

export interface ReleaseReview {
  messageId: Hex;
  routeId: Hex;
  token: Hex;
  recipient: Hex;
  amount: bigint;
  decision: ReleaseDecision;
  minimumTier: ResponseTier;
  validUntil: bigint;
  /** Monotonically increasing for this message; read the vault's current nonce before signing. */
  nonce: bigint;
}

export const RELEASE_REVIEW_TYPES = {
  ReleaseReview: [
    { name: 'messageId', type: 'bytes32' },
    { name: 'routeId', type: 'bytes32' },
    { name: 'token', type: 'address' },
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'decision', type: 'uint8' },
    { name: 'minimumTier', type: 'uint8' },
    { name: 'validUntil', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

export function releaseDecision(observation: Observation): ReleaseDecision {
  const { assessment, source } = observation;
  if (source.status === 'invalid' || assessment.signals.some((s) =>
    s.id === 'proof_payout_mismatch' && s.deterministic && s.score > 0)) return ReleaseDecision.REJECT;
  if (source.status !== 'verified' || assessment.verdict === 'indeterminate' || assessment.score === null ||
    !Number.isFinite(assessment.score) || assessment.score < 0 || !assessment.health.baselineFresh ||
    !assessment.health.priceAvailable || !assessment.health.screeningAvailable || assessment.score >= 0.95) return ReleaseDecision.HOLD;
  return ReleaseDecision.ALLOW;
}

export function signReleaseReview(signer: LocalAccount, vault: Hex, review: ReleaseReview, chainId: number): Promise<Hex> {
  return signer.signTypedData({
    domain: { name: 'TripwireProtectedVault', version: '1', chainId, verifyingContract: vault },
    types: RELEASE_REVIEW_TYPES, primaryType: 'ReleaseReview', message: review,
  });
}

export function releaseMinimumTier(observation: Observation): ResponseTier {
  const score = observation.assessment.score;
  return score !== null && Number.isFinite(score) && score >= 0 && score <= 1 ? getTierForScore(score) : ResponseTier.NONE;
}
