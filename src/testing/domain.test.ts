import { describe, it, expect } from 'vitest';
import {
  NormalizedTxSchema,
  MovementSchema,
  createAssetKey,
  WELL_KNOWN_CHAINS,
} from '../domain';

describe('Domain Model Invariants', () => {
  it('creates canonical asset keys for native and ERC20/SPL assets', () => {
    const ethNative = createAssetKey(WELL_KNOWN_CHAINS.ETHEREUM, 'native');
    expect(ethNative).toBe('eip155:1/native');

    const usdcErc20 = createAssetKey(WELL_KNOWN_CHAINS.ETHEREUM, 'fungible', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    expect(usdcErc20).toBe('eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');

    const solNative = createAssetKey(WELL_KNOWN_CHAINS.SOLANA_MAINNET, 'native');
    expect(solNative).toBe('solana:mainnet/native');

    const usdcSpl = createAssetKey(WELL_KNOWN_CHAINS.SOLANA_MAINNET, 'fungible', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(usdcSpl).toBe('solana:mainnet/spl:epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v');
  });

  it('enforces non-negative movement amounts (Invariant I3)', () => {
    const validMovement = {
      asset: {
        key: 'eip155:1/native',
        chain: 'eip155:1',
        kind: 'native',
        symbol: 'ETH',
        decimals: 18,
      },
      amount: 1000000000000000000n,
      direction: 'in',
      state: 'standard',
      role: 'transfer',
    };

    expect(() => MovementSchema.parse(validMovement)).not.toThrow();

    const invalidMovement = {
      ...validMovement,
      amount: -100n,
    };

    expect(() => MovementSchema.parse(invalidMovement)).toThrow();
  });

  it('validates a complete NormalizedTx', () => {
    const sampleTx = {
      id: 'eip155:1:0xsampletxhash',
      chain: 'eip155:1',
      hash: '0xsampletxhash',
      time: 1772539200,
      position: { block: 19480112 },
      status: 'success',
      subject: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      feePayer: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      fee: {
        asset: {
          key: 'eip155:1/native',
          chain: 'eip155:1',
          kind: 'native',
          symbol: 'ETH',
          decimals: 18,
        },
        amount: 2100000000000000n,
        parts: {
          base: 2100000000000000n,
        },
      },
      movements: [
        {
          asset: {
            key: 'eip155:1/native',
            chain: 'eip155:1',
            kind: 'native',
            symbol: 'ETH',
            decimals: 18,
          },
          amount: 2000000000000000000n,
          direction: 'out',
          state: 'standard',
          role: 'swap_leg',
        },
      ],
      interactions: [
        {
          target: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          protocol: 'uniswap-v3',
          method: 'multicall',
          decoded: true,
        },
      ],
      tags: ['approval'],
      provenance: {
        adapter: 'evm',
        adapterVersion: '2.0.0',
        rawRef: 'etherscan:19480112',
      },
    };

    const parsed = NormalizedTxSchema.parse(sampleTx);
    expect(parsed.id).toBe('eip155:1:0xsampletxhash');
    expect(parsed.movements[0].amount).toBe(2000000000000000000n);
  });
});
