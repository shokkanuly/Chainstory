// The oracle and the guardian are separate layers, and nothing used to force
// them to agree on the boundary. They disagreed: the oracle's most certain
// verdict (a deterministic signal, floored to exactly 0.75) mapped to 75, and
// the guardian — then pausing only on `> 75` — refused it. This file is the
// guard that keeps them aligned.

import { describe, expect, it } from 'vitest';
import { keccak256, toHex } from 'viem';
import { deployGuardian, oracle, owner, relayer, signAttestation } from './evm.js';
import { DEFAULT_CONFIG, scoreTransfer } from '../../../src/tripwire/riskScorer.js';
import { ON_CHAIN_TRIP_THRESHOLD, toOnChainScore } from '../../../src/tripwire/onChain.js';

const NOW = 1_780_000_000;
const ROUTE = keccak256(toHex('eth:arb:USDC'));

async function guardianAccepts(riskScore: bigint) {
  const g = await deployGuardian();
  await g.send(owner, 'configureRoute', [ROUTE, 1_000_000n, 3600n]);
  const a = { routeId: ROUTE, riskScore, validUntil: g.now + 300n, nonce: 1n };
  const res = await g.send(relayer, 'submitAttestation', [
    a.routeId, a.riskScore, a.validUntil, a.nonce, await signAttestation(oracle, g.address, a),
  ]);
  return res.ok;
}

describe('oracle → guardian boundary', () => {
  it('the Verus case trips the oracle and pauses the guardian', async () => {
    const assessment = scoreTransfer({
      transfer: {
        hash: '0xverus', chain: 'ethereum', route: 'eth:arb:USDC', token: 'USDC', amountUsd: 25_000,
        timestamp: NOW, from: '0xbridge', to: '0xrecipient', provenBurnUsd: 25_000, claimedPayoutUsd: 11_580_000,
      },
      baseline: {
        route: 'eth:arb:USDC', windowHours: 24, sampleSize: 400, medianTransferUsd: 12_000,
        p95TransferUsd: 90_000, rollingTvlUsd: 40_000_000, computedAt: NOW - 600,
      },
      recent: [],
      screening: { isFlagged: () => false, describe: () => undefined },
      now: NOW,
    });
    expect(assessment.verdict).toBe('trip');
    expect(await guardianAccepts(toOnChainScore(assessment.score!))).toBe(true);
  });

  it('the thresholds line up exactly', () => {
    expect(toOnChainScore(DEFAULT_CONFIG.tripThreshold)).toBe(BigInt(ON_CHAIN_TRIP_THRESHOLD));
  });

  // Floor, not round: rounding would lift 0.745 to 75 and pause on a transfer
  // the oracle only rated `elevated`.
  it.each([0.7449, 0.745, 0.7499999, 0.75, 0.7500001, 0.99, 1])(
    'score %s: the oracle trips exactly when the guardian accepts',
    async (score) => {
      const oracleTrips = score >= DEFAULT_CONFIG.tripThreshold;
      expect(await guardianAccepts(toOnChainScore(score))).toBe(oracleTrips);
    }
  );
});
