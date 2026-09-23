// src/services/descriptionGenerator.ts
//
// Gemini integration for description-only generation.
// The category is already decided by the XGBoost classifier, so Gemini writes a plain-English summary.
// Includes graceful fallback to deterministic descriptions if Gemini API returns 404 / rate limits.

import type { RawTransaction, TaxCategory } from '../types';
import { getMethodLabel } from './methodRegistry';
import { describeTransaction } from './apiClient';

export async function generateDescription(
  tx: RawTransaction,
  category: TaxCategory,
  ethValue: number,
  usdValue: number | null
): Promise<string> {
  // Only structured fields cross the wire. The prompt is assembled on the
  // server so the endpoint cannot be driven as a general-purpose LLM.
  const generated = await describeTransaction({
    from: tx.from,
    to: tx.to,
    category,
    ethValue,
    usdValue,
    methodLabel: getMethodLabel(tx.input) ?? undefined,
    functionName: tx.functionName,
    tokenName: tx.tokenName,
    tokenSymbol: tx.tokenSymbol,
    isError: tx.isError === '1',
  });

  return generated ?? generateFallbackDescription(tx, category, ethValue);
}

export function generateFallbackDescription(
  tx: RawTransaction,
  category: TaxCategory,
  ethValue: number
): string {
  const methodHint = getMethodLabel(tx.input);
  const fnName = (tx.functionName || '').toLowerCase();
  const tokenSymbol = tx.tokenSymbol ? ` ${tx.tokenSymbol}` : '';
  const tokenInfo = tx.tokenName ? ` (${tx.tokenName})` : '';

  // 1. Direct method hint match
  if (methodHint) {
    return `${methodHint}${ethValue > 0 ? ` — ${ethValue.toFixed(4)} ETH` : tokenSymbol ? ` — ${tokenSymbol}` : ''}`;
  }

  // 2. Function name keyword analysis
  if (fnName.includes('swap')) {
    return `Token swap on DEX (${ethValue > 0 ? ethValue.toFixed(4) + ' ETH' : tokenSymbol || 'tokens'})`;
  }
  if (fnName.includes('mint')) {
    return `Minted NFT / token${tokenSymbol}${tokenInfo}`;
  }
  if (fnName.includes('claim') || fnName.includes('reward')) {
    return `Claimed rewards / income${ethValue > 0 ? ` (${ethValue.toFixed(4)} ETH)` : ''}`;
  }
  if (fnName.includes('deposit') || fnName.includes('stake')) {
    return `Deposited assets to protocol${ethValue > 0 ? ` (${ethValue.toFixed(4)} ETH)` : ''}`;
  }
  if (fnName.includes('withdraw') || fnName.includes('unstake')) {
    return `Withdrew assets from protocol${ethValue > 0 ? ` (${ethValue.toFixed(4)} ETH)` : ''}`;
  }

  // 3. Category fallback
  if (category === 'trade') {
    return `Crypto trade / swap (${ethValue > 0 ? ethValue.toFixed(4) + ' ETH' : 'token activity'})`;
  } else if (category === 'income') {
    return `Staking / Reward income claim (${ethValue.toFixed(4)} ETH)`;
  } else if (category === 'nft') {
    return `NFT collectible transaction (${ethValue > 0 ? ethValue.toFixed(4) + ' ETH' : 'NFT'})`;
  }

  return `Transferred ${ethValue > 0 ? ethValue.toFixed(4) + ' ETH' : tokenSymbol ? tokenSymbol.trim() : 'tokens'}`;
}

