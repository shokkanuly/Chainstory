// src/services/descriptionGenerator.ts
//
// Gemini integration for description-only generation.
// The category is already decided by the XGBoost classifier, so Gemini writes a plain-English summary.
// Includes graceful fallback to deterministic descriptions if Gemini API returns 404 / rate limits.

import type { RawTransaction, TaxCategory } from '../types';
import { METHOD_HINTS } from './featureExtractor';

const GEMINI_API_URLS = [
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
];

function getGeminiKey(): string {
  const key = import.meta.env.VITE_GEMINI_API_KEY;
  if (!key || key === 'your_gemini_api_key_here') {
    throw new Error('VITE_GEMINI_API_KEY is not set. Please add it to your .env file.');
  }
  return key;
}

const CATEGORY_LABELS: Record<TaxCategory, string> = {
  trade: 'a crypto trade/swap (exchanging one asset for another)',
  income: 'crypto income (staking reward, airdrop, yield farming)',
  transfer: 'a simple transfer (moving assets between wallets, wrapping/unwrapping)',
  nft: 'an NFT operation (mint, purchase, sale, or transfer of a collectible)',
  unknown: 'a blockchain transaction',
};

export function buildDescriptionPrompt(
  tx: RawTransaction,
  category: TaxCategory,
  ethValue: number,
  usdValue: number | null
): string {
  const methodSignature = tx.input?.slice(0, 10) || '0x';
  const methodHint = METHOD_HINTS[methodSignature] || 'contract interaction';
  const usdText = usdValue !== null ? `~$${usdValue.toFixed(2)} USD` : 'unknown USD value';
  const tokenInfo = tx.tokenSymbol ? ` involving ${tx.tokenName} (${tx.tokenSymbol})` : '';
  const categoryDesc = CATEGORY_LABELS[category] || 'a blockchain transaction';

  return `Write a one-sentence, plain English description (max 15 words) of this Ethereum transaction.

This transaction has been classified as: ${categoryDesc}.

Details:
- From: ${tx.from}
- To: ${tx.to || 'Contract creation'}
- ETH value: ${ethValue.toFixed(6)} ETH (${usdText})
- Method: ${methodHint}${tokenInfo}
- Function: ${tx.functionName || 'N/A'}
- Failed: ${tx.isError === '1' ? 'YES' : 'No'}

Output ONLY the description text, nothing else. Examples:
- "Swapped 2 ETH for 3,400 USDC on Uniswap"
- "Claimed 0.045 ETH staking rewards from Lido"
- "Minted Bored Ape NFT #42069 for 0.8 ETH"
- "Transferred 1.5 ETH to secondary wallet"`;
}

export async function generateDescription(
  tx: RawTransaction,
  category: TaxCategory,
  ethValue: number,
  usdValue: number | null
): Promise<string> {
  let apiKey: string;
  try {
    apiKey = getGeminiKey();
  } catch {
    return generateFallbackDescription(tx, category, ethValue);
  }

  const prompt = buildDescriptionPrompt(tx, category, ethValue, usdValue);

  // Try API URLs in sequence
  for (const apiUrl of GEMINI_API_URLS) {
    try {
      const res = await fetch(`${apiUrl}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 80,
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
        const cleaned = text
          .replace(/^["']|["']$/g, '')
          .replace(/```.*$/gm, '')
          .trim();
        if (cleaned) return cleaned;
      }
    } catch {
      // Continue to next endpoint or fallback
    }
  }

  return generateFallbackDescription(tx, category, ethValue);
}

function generateFallbackDescription(
  tx: RawTransaction,
  category: TaxCategory,
  ethValue: number
): string {
  const methodSignature = tx.input?.slice(0, 10) || '0x';
  const methodHint = METHOD_HINTS[methodSignature];

  if (methodHint) {
    return `${methodHint} (${ethValue > 0 ? ethValue.toFixed(4) + ' ETH' : 'Token Activity'})`;
  }

  if (category === 'trade') {
    return `Token swap transaction (${ethValue.toFixed(4)} ETH)`;
  } else if (category === 'income') {
    return `Staking / Reward income claim (${ethValue.toFixed(4)} ETH)`;
  } else if (category === 'nft') {
    return `NFT collectible transaction (${ethValue.toFixed(4)} ETH)`;
  }

  return `Transferred ${ethValue > 0 ? ethValue.toFixed(4) + ' ETH' : 'tokens'}`;
}
