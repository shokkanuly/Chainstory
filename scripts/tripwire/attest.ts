// scripts/tripwire/attest.ts
//
// The attestor: the single signer (ADR-012). It turns a score into an EIP-712
// attestation and hands it to the guardian, and it signs only to escalate —
// the guardian ignores anything at or below the route's active tier, so
// signing it would only spend a nonce and gas.
//
// The signer is the one centralisation point in Tripwire; 2-of-3 threshold
// signing is the roadmap answer. Locally the key is a throwaway demo key; on a
// testnet it comes from the git-ignored .env.tripwire and never leaves it.

import type { Hex, LocalAccount } from 'viem';
import {
  ResponseTier,
  getTierForScore,
  signAttestation,
  toOnChainScore,
  type Attestation,
} from '../../src/tripwire/onChain.js';
import type { RiskAssessment } from '../../src/tripwire/types.js';

/** The guardian, however it is reached: an in-process EVM locally, an RPC on a testnet. */
export interface GuardianPort {
  address: Hex;
  chainId: number;
  currentTier(routeId: Hex): Promise<ResponseTier>;
  submitAttestation(att: Attestation, signature: Hex): Promise<{ ok: boolean; error?: string; gas?: bigint; txHash?: Hex }>;
}

export type AttestationOutcome =
  | { action: 'skipped'; reason: string }
  | {
      action: 'submitted' | 'rejected';
      tier: ResponseTier;
      attestation: Attestation;
      result: Awaited<ReturnType<GuardianPort['submitAttestation']>>;
    };

export interface AttestorOptions {
  /** Seconds since epoch, on the guardian's clock. */
  now: () => number;
  /** How long a signature stays valid. The guardian refuses more than 10 minutes. */
  ttlSeconds?: number;
  /** Defaults to 64 random bits, so a restarted attestor cannot reuse a nonce. */
  nextNonce?: () => bigint;
  /** Real-chain operators revalidate canonical source/destination anchors before signing. */
  beforeSign?: () => Promise<void>;
}

function randomNonce(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return bytes.reduce((n, b) => (n << 8n) | BigInt(b), 0n);
}

export class Attestor {
  constructor(
    private signer: LocalAccount,
    private guardian: GuardianPort,
    private opts: AttestorOptions
  ) {}

  async handle(routeId: Hex, assessment: RiskAssessment): Promise<AttestationOutcome> {
    if (assessment.score === null) {
      return { action: 'skipped', reason: assessment.degradedReason ?? 'the oracle could not assess this release' };
    }
    const tier = getTierForScore(assessment.score);
    if (tier === ResponseTier.NONE) return { action: 'skipped', reason: 'below the THROTTLE threshold' };

    const active = Number(await this.guardian.currentTier(routeId)) as ResponseTier;
    if (tier <= active) return { action: 'skipped', reason: `the route is already at ${ResponseTier[active]}` };

    await this.opts.beforeSign?.();
    const attestation: Attestation = {
      routeId,
      riskScore: toOnChainScore(assessment.score),
      validUntil: BigInt(this.opts.now() + (this.opts.ttlSeconds ?? 300)),
      nonce: (this.opts.nextNonce ?? randomNonce)(),
    };
    const signature = await signAttestation(this.signer, this.guardian.address, attestation, this.guardian.chainId);
    const result = await this.guardian.submitAttestation(attestation, signature);
    return { action: result.ok ? 'submitted' : 'rejected', tier, attestation, result };
  }
}
