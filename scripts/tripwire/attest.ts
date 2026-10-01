// scripts/tripwire/attest.ts
//
// The attestor: the single signer (ADR-012). It turns a score into an EIP-712
// attestation and hands it to the guardian. It escalates new risk and refreshes
// a still-justified active tier near expiry using reconciled on-chain state.
//
// The signer is the one centralisation point in Tripwire; 2-of-3 threshold
// signing is the roadmap answer. Locally the key is a throwaway demo key; on a
// testnet it comes from the git-ignored .env.tripwire and never leaves it.

import type { Hex, LocalAccount } from 'viem';
import { z } from 'zod';
import {
  ResponseTier,
  getTierForScore,
  signAttestation,
  toOnChainScore,
  type Attestation,
} from '../../src/tripwire/onChain.js';
import type { RiskAssessment } from '../../src/tripwire/types.js';
import { guardianProtectionSchema } from './protection.js';

/** The guardian, however it is reached: an in-process EVM locally, an RPC on a testnet. */
export interface GuardianPort {
  address: Hex;
  chainId: number;
  currentTier(routeId: Hex): Promise<ResponseTier>;
  /** Required for automatic refresh; must bind tier/expiry/oracle to the same chain clock. */
  protectionState?(routeId: Hex): Promise<unknown>;
  submitAttestation(att: Attestation, signature: Hex): Promise<{ ok: boolean; error?: string; gas?: bigint; txHash?: Hex }>;
}

export type AttestationOutcome =
  | { action: 'skipped'; reason: string }
  | { action: 'unavailable'; reason: string }
  | {
      action: 'submitted' | 'rejected';
      purpose: 'escalate' | 'refresh';
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
  /** Refresh a matching active tier inside this buffer (default one hour). */
  refreshBeforeSeconds?: number;
}

function randomNonce(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return bytes.reduce((n, b) => (n << 8n) | BigInt(b), 0n);
}

export class Attestor {
  private lock: Promise<unknown> = Promise.resolve();
  private readonly ttl: number;
  private readonly refreshBefore: number;
  constructor(
    private signer: LocalAccount,
    private guardian: GuardianPort,
    private opts: AttestorOptions
  ) {
    this.ttl = z.number().int().min(1).max(600).parse(opts.ttlSeconds ?? 300);
    this.refreshBefore = z.number().int().min(1).max(3600).parse(opts.refreshBeforeSeconds ?? 3600);
  }

  handle(routeId: Hex, assessment: RiskAssessment): Promise<AttestationOutcome> {
    const run = this.lock.then(() => this.assess(routeId, assessment)); this.lock = run.catch(() => undefined); return run;
  }

  private async assess(routeId: Hex, assessment: RiskAssessment): Promise<AttestationOutcome> {
    if (assessment.score === null) {
      return { action: 'skipped', reason: assessment.degradedReason ?? 'the oracle could not assess this release' };
    }
    if (!z.number().finite().min(0).max(1).safeParse(assessment.score).success) {
      return { action: 'unavailable', reason: 'invalid risk score; no protection signature produced' };
    }
    const tier = getTierForScore(assessment.score);
    if (tier === ResponseTier.NONE) return { action: 'skipped', reason: 'below the THROTTLE threshold' };

    let active: ResponseTier;
    let now: bigint;
    let refresh = false;
    try {
      if (this.guardian.protectionState) {
        const state = guardianProtectionSchema.parse(await this.guardian.protectionState(routeId));
        if (!state.configured || state.oracle !== this.signer.address.toLowerCase()) {
          return { action: 'unavailable', reason: 'guardian route or oracle does not match this operator' };
        }
        now = state.now;
        active = now < state.expiresAt ? state.tier : ResponseTier.NONE;
        refresh = tier === active && state.expiresAt - now <= BigInt(this.refreshBefore);
      } else {
        // Legacy fixture ports can escalate but cannot infer expiry/refresh.
        active = z.number().int().min(0).max(3).parse(await this.guardian.currentTier(routeId));
        now = BigInt(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(this.opts.now()));
      }
    } catch {
      return { action: 'unavailable', reason: 'guardian protection state is unavailable or inconsistent; retry reconciliation' };
    }
    if (tier < active || (tier === active && !refresh)) {
      return { action: 'skipped', reason: `the route is already at ${ResponseTier[active]} with no justified refresh due` };
    }

    await this.opts.beforeSign?.();
    const attestation: Attestation = {
      routeId,
      riskScore: toOnChainScore(assessment.score),
      validUntil: now + BigInt(this.ttl),
      nonce: (this.opts.nextNonce ?? randomNonce)(),
    };
    const signature = await signAttestation(this.signer, this.guardian.address, attestation, this.guardian.chainId);
    const result = await this.guardian.submitAttestation(attestation, signature);
    return { action: result.ok ? 'submitted' : 'rejected', purpose: refresh ? 'refresh' : 'escalate', tier, attestation, result };
  }
}
