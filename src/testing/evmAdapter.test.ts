import { describe, it, expect } from 'vitest';
import { EvmAdapter } from '../chains/evm/adapter';
import { matchAddress } from '../chains/registry';
import { KNOWN_WALLET_FIXTURES, KNOWN_PUBLIC_WALLET } from '../services/knownWalletValidation';
import { NormalizedTxSchema, WELL_KNOWN_CHAINS } from '../domain';

describe('EvmAdapter & Registry', () => {
  const adapter = new EvmAdapter();

  it('matches EVM addresses and ENS names, and rejects invalid strings', () => {
    expect(matchAddress('0xd8dA6BF26964aF9Ded7ede3308C4157ed3714123')?.family).toBe('evm');
    expect(matchAddress('vitalik.eth')?.family).toBe('evm');
    expect(matchAddress('not-an-address')).toBeNull();
  });

  it('normalizes raw EVM transactions into valid NormalizedTx domain models', () => {
    const rawTx = KNOWN_WALLET_FIXTURES[0]; // 5.0 ETH transfer in
    const normalized = adapter.normalize(rawTx, KNOWN_PUBLIC_WALLET, {
      chainId: WELL_KNOWN_CHAINS.ETHEREUM,
      subject: KNOWN_PUBLIC_WALLET,
    });

    expect(() => NormalizedTxSchema.parse(normalized)).not.toThrow();
    expect(normalized.status).toBe('success');
    expect(normalized.movements).toHaveLength(1);
    expect(normalized.movements[0].direction).toBe('in');
    expect(normalized.movements[0].amount).toBe(5000000000000000000n);
    expect(normalized.movements[0].asset.symbol).toBe('ETH');
  });

  it('correctly tags and marks outgoing ETH swap movements', () => {
    const rawSwap = KNOWN_WALLET_FIXTURES[2]; // 2.0 ETH swap out
    const normalized = adapter.normalize(rawSwap, KNOWN_PUBLIC_WALLET, {
      chainId: WELL_KNOWN_CHAINS.ETHEREUM,
      subject: KNOWN_PUBLIC_WALLET,
    });

    expect(normalized.movements).toHaveLength(1);
    expect(normalized.movements[0].direction).toBe('out');
    expect(normalized.movements[0].amount).toBe(2000000000000000000n);
    expect(normalized.movements[0].role).toBe('swap_leg');
  });
});
