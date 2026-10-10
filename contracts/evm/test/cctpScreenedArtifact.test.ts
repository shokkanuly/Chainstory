import { describe, expect, it } from 'vitest';
import { compileCctpScreenedPaymentEscrow } from '../compile.mjs';
import committed from '../../../scripts/tripwire/testnet/cctpScreenedPaymentEscrow.artifact.js';

describe('screened payment escrow artifact', () => {
  it('matches a fresh compile, fits EIP-170 and carries no test harness', () => {
    const fresh = compileCctpScreenedPaymentEscrow();
    expect(fresh.errors).toEqual([]);
    expect(committed).toEqual(fresh.artifact);
    // 23.4 KB of 24 KB: a growing contract must be split before it stops deploying.
    expect(fresh.runtimeBytes).toBeLessThan(24576);
    expect(committed.abi.some((entry) => entry.type === 'function' && entry.name === 'setFailure')).toBe(false);
  }, 60_000); // A full solc compile: over 6 s on GitHub's runners.
});
