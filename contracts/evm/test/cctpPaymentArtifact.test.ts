import { describe, expect, it } from 'vitest';
import { compileCctpPaymentEscrow, compileGuardian, solcVersion } from '../compile.mjs';
import committed from '../../../scripts/tripwire/testnet/cctpPaymentEscrow.artifact.js';
import acceptance from '../../../scripts/tripwire/testnet/cctpAcceptance.artifact.js';

describe('payment escrow artifact', () => {
  it('matches a fresh compile and fits EIP-170, without any test harness', () => {
    const fresh = compileCctpPaymentEscrow();
    expect(fresh.errors).toEqual([]);
    expect(committed).toEqual(fresh.artifact);
    expect(acceptance.compiler).toBe(solcVersion());
    expect(acceptance.payment).toEqual(fresh.runtime);
    expect(fresh.runtimeBytes).toBeLessThan(24576);
    expect(committed.abi.some((entry) => entry.type === 'function' && entry.name === 'setFailure')).toBe(false);
  });
  it('pins every guardian immutable reference to the fresh compiler output', () => {
    const fresh = compileGuardian(); expect(fresh.errors).toEqual([]); expect(acceptance.guardian).toEqual(fresh.runtime);
  });
});
