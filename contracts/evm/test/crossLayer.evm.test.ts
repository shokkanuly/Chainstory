// The oracle and the guardian are separate layers, and nothing used to force
// them to agree on the boundary. They disagreed: the oracle's most certain
// verdict (a deterministic signal, floored to exactly 0.75) mapped to 75, and
// the guardian — then pausing only on `> 75` — refused it. This file is the
// guard that keeps them aligned.

import { describe, expect, it } from 'vitest';
import { keccak256, toHex } from 'viem';
import { deployGuardian, oracle, owner, relayer, signAttestation } from './evm.js';
import { DEFAULT_CONFIG, scoreTransfer } from '../../../src/tripwire/riskScorer.js';
import {
  ON_CHAIN_DELAY_THRESHOLD,
  ON_CHAIN_FREEZE_THRESHOLD,
  ON_CHAIN_THROTTLE_THRESHOLD,
  ResponseTier,
  getTierForScore,
  toOnChainScore,
} from '../../../src/tripwire/onChain.js';

const NOW = 1_780_000_000;
const ROUTE = keccak256(toHex('eth:arb:USDC'));

/** Submit one attestation to a fresh guardian; report whether it landed and the tier it left. */
async function guardianResponse(riskScore: bigint) {
  const g = await deployGuardian();
  await g.send(owner, 'configureRoute', [ROUTE, 1_000_000n, 3600n]);
  const a = { routeId: ROUTE, riskScore, validUntil: g.now + 300n, nonce: 1n };
  const res = await g.send(relayer, 'submitAttestation', [
    a.routeId, a.riskScore, a.validUntil, a.nonce, await signAttestation(oracle, g.address, a),
  ]);
  return { accepted: res.ok, tier: await g.read<number>('currentTier', [ROUTE]) };
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
    expect(await guardianResponse(toOnChainScore(assessment.score!))).toEqual({
      accepted: true,
      tier: ResponseTier.FREEZE,
    });
  });

  // Read from the deployed bytecode, not from a copy of it.
  it('the scorer, the TS mirror and the contract agree on every threshold', async () => {
    const g = await deployGuardian();
    for (const [scorer, mirror, name] of [
      [DEFAULT_CONFIG.tripThreshold, ON_CHAIN_THROTTLE_THRESHOLD, 'THROTTLE_THRESHOLD'],
      [DEFAULT_CONFIG.delayThreshold, ON_CHAIN_DELAY_THRESHOLD, 'DELAY_THRESHOLD'],
      [DEFAULT_CONFIG.freezeThreshold, ON_CHAIN_FREEZE_THRESHOLD, 'FREEZE_THRESHOLD'],
    ] as const) {
      expect(await g.read(name)).toBe(BigInt(mirror));
      expect(toOnChainScore(scorer)).toBe(BigInt(mirror));
    }
  });

  // Floor, not round: rounding would lift 0.645 to 65 and throttle a transfer
  // the oracle only rated `elevated`, or lift 0.945 into FREEZE.
  it.each([0.6449, 0.645, 0.6499999, 0.65, 0.6500001, 0.8499, 0.85, 0.9499, 0.95, 1])(
    'score %s: the oracle trips exactly when the guardian accepts, at the same tier',
    async (score) => {
      const oracleTrips = score >= DEFAULT_CONFIG.tripThreshold;
      expect(await guardianResponse(toOnChainScore(score))).toEqual({
        accepted: oracleTrips,
        tier: getTierForScore(score),
      });
    }
  );
});
