// src/tripwire/onChain.ts
//
// The one place the oracle's 0..1 score meets the guardian's 0..100 integer.
//
// These two layers once disagreed about the boundary: the oracle tripped at
// `score >= 0.75` while the guardian paused only on `> 75`, so the oracle's
// most certain verdict — a deterministic signal floored to exactly 0.75 — was
// refused on-chain. Both now use an inclusive threshold, and the mapping below
// is a floor, so `verdict === 'trip'` holds exactly when the guardian accepts.

import type { Hex, LocalAccount } from 'viem';
import { DEFAULT_CONFIG } from './riskScorer.js';

/** Mirrors TripwireGuardian.TRIP_THRESHOLD. */
export const ON_CHAIN_TRIP_THRESHOLD = 75;

/**
 * Floor, not round: rounding would lift 0.745 to 75 and have the guardian
 * pause on a transfer the oracle only rated `elevated`.
 */
export function toOnChainScore(score: number): bigint {
  return BigInt(Math.min(100, Math.max(0, Math.floor(score * 100))));
}

if (toOnChainScore(DEFAULT_CONFIG.tripThreshold) !== BigInt(ON_CHAIN_TRIP_THRESHOLD)) {
  // Fail at import rather than in production: a drifted threshold means some
  // oracle trips are silently refused by the contract.
  throw new Error('Oracle trip threshold does not map onto the guardian TRIP_THRESHOLD');
}

export const ATTESTATION_TYPES = {
  Attestation: [
    { name: 'routeId', type: 'bytes32' },
    { name: 'riskScore', type: 'uint256' },
    { name: 'validUntil', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

export interface Attestation {
  routeId: Hex;
  riskScore: bigint;
  validUntil: bigint;
  nonce: bigint;
}

export function attestationDomain(chainId: number, verifyingContract: Hex) {
  return { name: 'TripwireGuardian', version: '1', chainId, verifyingContract } as const;
}

/** Sign exactly as the guardian verifies — EIP-712 typed data. */
export function signAttestation(
  signer: LocalAccount,
  verifyingContract: Hex,
  attestation: Attestation,
  chainId: number
): Promise<Hex> {
  return signer.signTypedData({
    domain: attestationDomain(chainId, verifyingContract),
    types: ATTESTATION_TYPES,
    primaryType: 'Attestation',
    message: attestation,
  });
}
