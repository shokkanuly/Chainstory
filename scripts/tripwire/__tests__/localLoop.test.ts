// Stage 3's "done when": the local loop goes NONE → THROTTLE → DELAY → FREEZE,
// with the on-chain tier asserted after every step, and every tier earned by
// the watcher's own score — the script sets none of them.

import { describe, expect, it } from 'vitest';
import { ResponseTier } from '../../../src/tripwire/onChain.js';
import { runLocalLoop, type StepResult } from '../localLoop.js';

describe('the local watch → attest → guardian loop', async () => {
  const steps: StepResult[] = await runLocalLoop();
  const attested = (s: StepResult) =>
    s.payouts.flatMap((p) => (p.attestation.action === 'submitted' ? [p.attestation.attestation.riskScore] : []));
  const outcome = (s: StepResult) => s.payouts.map((p) => (p.outflow.ok ? 'paid' : p.outflow.error));

  it('the guardian tier after each step: NONE → THROTTLE → DELAY → FREEZE', () => {
    expect(steps.map((s) => s.tierAfter)).toEqual([
      ResponseTier.NONE,
      ResponseTier.THROTTLE,
      ResponseTier.DELAY,
      ResponseTier.FREEZE,
    ]);
  });

  it('ordinary traffic scores clear, costs no attestation, and is paid out', () => {
    expect(steps[0].payouts.every((p) => p.assessment.verdict === 'clear')).toBe(true);
    expect(attested(steps[0])).toEqual([]);
    expect(outcome(steps[0])).toEqual(['paid', 'paid', 'paid']);
  });

  it('each escalation is one signed attestation, at the score the watcher computed', () => {
    expect(steps.slice(1).map(attested)).toEqual([[65n], [85n], [100n]]);
  });

  it('THROTTLE still pays a modest payout under the halved cap', () => {
    expect(outcome(steps[1])).toEqual(['paid']);
  });

  it('DELAY holds the large payout and lets the honest small one through', () => {
    expect(outcome(steps[2])).toEqual(['ReleaseDelayed', 'paid']);
    // The small one needs no attestation: the route is already at DELAY.
    expect(steps[2].payouts[1].attestation.action).toBe('skipped');
  });

  it('FREEZE stops the forged release before it pays anything', () => {
    const forged = steps[3].payouts[0];
    expect(forged.burned).toBe(0n);
    expect(forged.assessment.signals.find((s) => s.id === 'proof_payout_mismatch')?.deterministic).toBe(true);
    expect(outcome(steps[3])).toEqual(['ReleaseRejected']);
    expect(forged.review.ok).toBe(true);
  });
});
