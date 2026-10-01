import { describe, expect, it } from 'vitest';
import { compileCctpEscrow } from '../compile.mjs';
import committed from '../../../scripts/tripwire/testnet/cctpEscrow.artifact.js';

describe('CCTP escrow artifact', () => {
  it('matches a fresh compile, including ABI, and fits EIP-170', () => {
    const fresh = compileCctpEscrow();
    expect(fresh.errors).toEqual([]);
    expect(committed).toEqual(fresh.artifact);
    expect(fresh.runtimeBytes).toBeLessThan(24576);
  });
});
