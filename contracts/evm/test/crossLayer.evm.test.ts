// The oracle and the guardian are separate layers with separate boundary
// conventions, and nothing forced them to agree. This file does.
//
// KNOWN BUG, pinned deliberately. The TS scorer trips at `score >= 0.75` and
// floors deterministic signals to exactly 0.75; the guardian (per spec) pauses
// only on `riskScore > 75`. So the Verus case — the oracle's most certain
// signal — maps to 75 and the contract refuses it with ScoreBelowThreshold.
//
// `it.fails` passes while the bug exists. When Phase 2 fixes the score
// mapping, this starts failing — flip it to `it` and it becomes the guard.
// Recommended fix: a deterministic signal is proof of a broken invariant, so
// floor it to 1.0 (CRITICAL) rather than to the trip threshold.

import { describe, expect, it } from 'vitest';
import { keccak256, toHex } from 'viem';
import { Guardian, oracle, owner, signAttestation, stranger } from './evm.js';
import { scoreTransfer } from '../../../src/tripwire/riskScorer.js';

const NOW = 1_780_000_000;

function scoreVerusCase() {
  return scoreTransfer({
    transfer: {
      hash: '0xverus',
      chain: 'ethereum',
      route: 'eth:arb:USDC',
      token: 'USDC',
      amountUsd: 25_000,
      timestamp: NOW,
      from: '0xbridge',
      to: '0xrecipient',
      provenBurnUsd: 25_000,
      claimedPayoutUsd: 11_580_000,
    },
    baseline: {
      route: 'eth:arb:USDC',
      windowHours: 24,
      sampleSize: 400,
      medianTransferUsd: 12_000,
      p95TransferUsd: 90_000,
      rollingTvlUsd: 40_000_000,
      computedAt: NOW - 600,
    },
    recent: [],
    screening: { isFlagged: () => false, describe: () => undefined },
    now: NOW,
  });
}

describe('oracle → guardian boundary', () => {
  it('the oracle trips on the Verus case', () => {
    expect(scoreVerusCase().verdict).toBe('trip');
  });

  it.fails('every oracle TRIP is an attestation the guardian accepts', async () => {
    const assessment = scoreVerusCase();
    const g = await Guardian.deploy();
    const route = keccak256(toHex('eth:arb:USDC'));
    await g.send(owner, 'configureRoute', [route, 1_000_000n, 3600n]);

    const a = {
      routeId: route,
      riskScore: BigInt(Math.round(assessment.score! * 100)),
      validUntil: g.now + 300n,
      nonce: 1n,
    };
    const res = await g.send(stranger, 'submitAttestation', [
      a.routeId, a.riskScore, a.validUntil, a.nonce, await signAttestation(oracle, g.address, a),
    ]);
    expect(res.error).toBeUndefined();
    expect(await g.read('isPaused', [route])).toBe(true);
  });
});
