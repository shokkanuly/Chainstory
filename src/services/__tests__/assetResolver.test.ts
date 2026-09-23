import { describe, expect, it } from 'vitest';
import { gasCostInNative, isOutgoing, resolveAsset, scaleTokenAmount } from '../assetResolver';
import { rawTx } from './factories';

describe('resolveAsset', () => {
  it('treats a normal transaction as the native asset, wei-scaled', () => {
    const tx = rawTx({ value: '2000000000000000000' });
    expect(resolveAsset(tx)).toEqual({ symbol: 'ETH', amount: 2 });
  });

  it('does not reinterpret a swap as a token disposal just because a token is named', () => {
    // A swap record carries the token RECEIVED, but still moves native ETH.
    const tx = rawTx({ value: '2000000000000000000', tokenSymbol: 'USDC', tokenDecimal: '6' });
    expect(resolveAsset(tx)).toEqual({ symbol: 'ETH', amount: 2 });
  });

  it('scales a token transfer by its own decimals', () => {
    const tx = rawTx({
      value: '1500000', isTokenTransfer: true, tokenSymbol: 'USDC', tokenDecimal: '6',
    });
    expect(resolveAsset(tx)).toEqual({ symbol: 'USDC', amount: 1.5 });
  });

  it('uses the chain native symbol on Polygon', () => {
    const tx = rawTx({ value: '1000000000000000000', chainId: 'polygon' });
    expect(resolveAsset(tx).symbol).toBe('POL');
  });

  it('defaults a token with no declared decimals to 18', () => {
    const tx = rawTx({
      value: '1000000000000000000', isTokenTransfer: true, tokenSymbol: 'DAI',
    });
    expect(resolveAsset(tx).amount).toBe(1);
  });

  it('survives malformed values', () => {
    expect(resolveAsset(rawTx({ value: '' })).amount).toBe(0);
    expect(resolveAsset(rawTx({ value: 'not-a-number' })).amount).toBe(0);
  });
});

describe('scaleTokenAmount', () => {
  it('handles 6, 8 and 18 decimal tokens', () => {
    expect(scaleTokenAmount('1000000', '6')).toBe(1);
    expect(scaleTokenAmount('100000000', '8')).toBe(1);
    expect(scaleTokenAmount('1000000000000000000', '18')).toBe(1);
  });
});

describe('gasCostInNative', () => {
  it('multiplies gasUsed by gasPrice and converts from wei', () => {
    expect(gasCostInNative(rawTx({ gasUsed: '21000', gasPrice: '1000000000' })))
      .toBeCloseTo(0.000021, 12);
  });

  it('is zero for internal transfers, which pay no gas of their own', () => {
    expect(gasCostInNative(rawTx({ isInternal: true, gasUsed: '21000', gasPrice: '1000000000' })))
      .toBe(0);
  });
});

describe('isOutgoing', () => {
  it('compares addresses case-insensitively', () => {
    const tx = rawTx({ from: '0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa' });
    expect(isOutgoing(tx, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
    expect(isOutgoing(tx, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).toBe(false);
  });
});
