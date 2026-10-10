// Operator-only release reviews. They add an execution gate to the demo vault;
// they do not authenticate bridge messages or replace independent source proofs.
import { hashStruct, type Hex, type LocalAccount } from 'viem';
import type { Observation } from './watch.js';
import { getTierForScore, ResponseTier } from '../../src/tripwire/onChain.js';
import { ReleaseDecision, settlementVerdict } from './settlement.js';

export { ReleaseDecision };

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

/** Proof-first decision for one release; see settlement.ts (ADR-023). */
export function releaseDecision(observation: Observation): ReleaseDecision {
  return settlementVerdict(observation).decision;
}

export function signReleaseReview(signer: LocalAccount, vault: Hex, review: ReleaseReview, chainId: number): Promise<Hex> {
  return signer.signTypedData({
    domain: { name: 'TripwireProtectedVault', version: '2', chainId, verifyingContract: vault },
    types: RELEASE_REVIEW_TYPES, primaryType: 'ReleaseReview', message: review,
  });
}

export const PAYMENT_RELEASE_REVIEW_TYPES = { PaymentReleaseReview: [
  { name: 'releaseHash', type: 'bytes32' }, { name: 'policyVersion', type: 'uint256' }, { name: 'policyHash', type: 'bytes32' },
] } as const;
export function signPaymentReleaseReview(signer: LocalAccount, vault: Hex, review: ReleaseReview,
  policy: { version: bigint; hash: Hex }, chainId: number): Promise<Hex> {
  const releaseHash = hashStruct({ types: RELEASE_REVIEW_TYPES, primaryType: 'ReleaseReview', data: review });
  return signer.signTypedData({
    domain: { name: 'TripwireProtectedVault', version: '2', chainId, verifyingContract: vault },
    types: PAYMENT_RELEASE_REVIEW_TYPES, primaryType: 'PaymentReleaseReview',
    message: { releaseHash, policyVersion: policy.version, policyHash: policy.hash },
  });
}

/** Review format 4 (ADR-047): the payment review also commits to the issuer's screening receipt. */
export const SCREENED_PAYMENT_RELEASE_REVIEW_TYPES = { PaymentReleaseReview: [
  { name: 'releaseHash', type: 'bytes32' }, { name: 'policyVersion', type: 'uint256' }, { name: 'policyHash', type: 'bytes32' },
  { name: 'screeningReceiptHash', type: 'bytes32' }, { name: 'screeningHeadHash', type: 'bytes32' }, { name: 'screeningValidUntil', type: 'uint64' },
] } as const;
/** HOLD and REJECT pass zero screening commitments; ALLOW passes the accepted receipt's. */
export const NO_SCREENING = { receiptHash: `0x${'0'.repeat(64)}` as Hex, headHash: `0x${'0'.repeat(64)}` as Hex, validUntil: 0n };
export function signScreenedPaymentReleaseReview(signer: LocalAccount, vault: Hex, review: ReleaseReview,
  policy: { version: bigint; hash: Hex }, screening: { receiptHash: Hex; headHash: Hex; validUntil: bigint }, chainId: number): Promise<Hex> {
  const releaseHash = hashStruct({ types: RELEASE_REVIEW_TYPES, primaryType: 'ReleaseReview', data: review });
  return signer.signTypedData({
    domain: { name: 'TripwireProtectedVault', version: '2', chainId, verifyingContract: vault },
    types: SCREENED_PAYMENT_RELEASE_REVIEW_TYPES, primaryType: 'PaymentReleaseReview',
    message: { releaseHash, policyVersion: policy.version, policyHash: policy.hash, screeningReceiptHash: screening.receiptHash,
      screeningHeadHash: screening.headHash, screeningValidUntil: screening.validUntil },
  });
}

export function releaseMinimumTier(observation: Observation): ResponseTier {
  const score = observation.assessment.score;
  return score !== null && Number.isFinite(score) && score >= 0 && score <= 1 ? getTierForScore(score) : ResponseTier.NONE;
}
