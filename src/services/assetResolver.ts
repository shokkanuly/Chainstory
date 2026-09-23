// src/services/assetResolver.ts
//
// Single source of truth for "what asset did this transaction move, and how
// much of it?".
//
// This exists because the two explorer endpoints denominate `value`
// differently, and getting them confused silently corrupts tax accounting:
//
//   txlist  (normal tx)     → value is WEI of the chain's native token
//   tokentx (token transfer) → value is in the TOKEN's own decimals
//
// The previous implementation derived the asset as `tx.tokenSymbol || 'ETH'`
// while always using the wei-scaled amount. On an ETH→USDC swap that booked a
// disposal of "USDC" using the ETH quantity, so no ETH lot ever matched and
// cost basis came out as zero. Resolve it once, here, and nowhere else.

import type { ChainId, RawTransaction } from '../types';
import { CHAIN_CONFIGS } from './chains';

export interface ResolvedAsset {
  symbol: string;
  amount: number;
}

/** The native gas token for a chain — ETH everywhere except Polygon (POL). */
export function getNativeSymbol(chainId: ChainId = 'ethereum'): string {
  return CHAIN_CONFIGS[chainId]?.symbol ?? 'ETH';
}

export function weiToEth(wei: string): number {
  const num = parseFloat(wei);
  if (!wei || isNaN(num)) return 0;
  return num / 1e18;
}

/** Scale a raw token amount by its declared decimals. Defaults to 18. */
export function scaleTokenAmount(rawValue: string, decimals: string | undefined): number {
  const num = parseFloat(rawValue);
  if (!rawValue || isNaN(num)) return 0;
  const dp = parseInt(decimals || '18', 10);
  return num / Math.pow(10, Number.isFinite(dp) ? dp : 18);
}

/**
 * Resolve the asset and quantity a transaction actually moved.
 *
 * Only a record flagged `isTokenTransfer` is denominated in token units.
 * A normal transaction that merely *mentions* a token (e.g. a swap annotated
 * with the token received) still moves the native asset, so its `value`
 * stays wei-scaled.
 */
export function resolveAsset(tx: RawTransaction): ResolvedAsset {
  if (tx.isTokenTransfer && tx.tokenSymbol) {
    return {
      symbol: tx.tokenSymbol.toUpperCase(),
      amount: scaleTokenAmount(tx.value, tx.tokenDecimal),
    };
  }

  return {
    symbol: getNativeSymbol(tx.chainId),
    amount: weiToEth(tx.value),
  };
}

/** Gas paid by the sender, in native-token units. Zero for internal transfers. */
export function gasCostInNative(tx: RawTransaction): number {
  if (tx.isInternal) return 0;
  const used = parseFloat(tx.gasUsed || '0');
  const price = parseFloat(tx.gasPrice || '0');
  if (isNaN(used) || isNaN(price)) return 0;
  return (used * price) / 1e18;
}

/** True when `walletAddress` is the sender — i.e. it paid the gas. */
export function isOutgoing(tx: RawTransaction, walletAddress: string): boolean {
  return (tx.from || '').toLowerCase() === walletAddress.toLowerCase();
}
