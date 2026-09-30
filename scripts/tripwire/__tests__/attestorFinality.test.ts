import { expect, it, vi } from 'vitest';
import { keccak256, toHex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { scoreTransfer } from '../../../src/tripwire/riskScorer.js';
import { Attestor } from '../attest.js';
import { FinalityConflictError } from '../finality.js';

it('checks canonical history before producing an EIP-712 protection signature', async () => {
  const routeId = keccak256(toHex('attestor-finality'));
  const signer = { ...actors.oracle };
  const sign = vi.spyOn(signer, 'signTypedData');
  const submitAttestation = vi.fn();
  const attestor = new Attestor(signer, { address: actors.owner.address, chainId: 31337,
    currentTier: async () => 0, submitAttestation }, { now: () => 1000,
    beforeSign: async () => { throw new FinalityConflictError('Canonical source checkpoint changed'); } });
  const assessment = scoreTransfer({ transfer: { hash: routeId, chain: 'base', route: 'test-route', token: 'USDC',
    amountUsd: 100, timestamp: 1000, from: actors.owner.address, to: actors.bridge.address,
    backing: { burned: 0n, claimed: 100_000_000n, toleranceBps: 0n } },
    baseline: null, recent: [], now: 1000, screening: { isFlagged: () => false, describe: () => undefined } });
  expect(assessment.score).toBe(1);
  await expect(attestor.handle(routeId, assessment)).rejects.toThrow('checkpoint changed');
  expect(sign).not.toHaveBeenCalled(); expect(submitAttestation).not.toHaveBeenCalled();
});
