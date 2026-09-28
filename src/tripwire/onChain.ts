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

/** Graduated response thresholds mirroring TripwireGuardian.sol */
export const ON_CHAIN_THROTTLE_THRESHOLD = 65;
export const ON_CHAIN_DELAY_THRESHOLD = 85;
export const ON_CHAIN_FREEZE_THRESHOLD = 95;

/** Default trip threshold where Guardian takes automated action (Throttle starts at 65) */
export const ON_CHAIN_TRIP_THRESHOLD = 65;

/**
 * Floor, not round: rounding would lift 0.645 to 65 and have the guardian
 * throttle on a transfer the oracle only rated clear.
 */
export function toOnChainScore(score: number): bigint {
  return BigInt(Math.min(100, Math.max(0, Math.floor(score * 100))));
}

export enum ResponseTier {
  NONE = 0,
  THROTTLE = 1,
  DELAY = 2,
  FREEZE = 3,
}

export function getTierForScore(score: number): ResponseTier {
  const onChain = Number(toOnChainScore(score));
  if (onChain >= ON_CHAIN_FREEZE_THRESHOLD) return ResponseTier.FREEZE;
  if (onChain >= ON_CHAIN_DELAY_THRESHOLD) return ResponseTier.DELAY;
  if (onChain >= ON_CHAIN_THROTTLE_THRESHOLD) return ResponseTier.THROTTLE;
  return ResponseTier.NONE;
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
