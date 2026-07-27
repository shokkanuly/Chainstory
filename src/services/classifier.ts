// src/services/classifier.ts
//
// Orchestrator — chains the three classification stages:
//   1. Feature extraction (instant, local)
//   2. ML classification via XGBoost/ONNX (instant, local) — with fallback
//   3. Description generation via Gemini (async, API call)
//
// Public API (classifyTransaction, classifyAll) is unchanged so App.tsx
// doesn't need any modifications to calling code.

import type { RawTransaction, ClassifiedTransaction, TaxCategory } from '../types';
import { weiToEth } from './etherscan';
import { getHistoricalPrice } from './coingecko';
import { extractFeatures } from './featureExtractor';
import { classifyWithML, classifyWithRules } from './mlClassifier';
import { generateDescription } from './descriptionGenerator';

// -------------------------------------------------------------------
// Legacy Gemini classifier fallback
// -------------------------------------------------------------------

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

const METHOD_HINTS: Record<string, string> = {
  '0xa9059cbb': 'ERC-20 token transfer',
  '0x23b872dd': 'ERC-20 transferFrom',
  '0x095ea7b3': 'ERC-20 approve (authorize spending)',
  '0x7ff36ab5': 'Uniswap swap ETH for tokens',
  '0x38ed1739': 'Uniswap swap tokens for tokens',
  '0x18cbafe5': 'Uniswap swap tokens for ETH',
  '0x5ae401dc': 'Uniswap V3 multicall (swap)',
  '0xb6f9de95': 'Uniswap V3 swap',
  '0x3593564c': 'Uniswap Universal Router swap',
  '0x12aa3caf': '1inch swap',
  '0xe449022e': '1inch swap',
  '0xa0712d68': 'Mint (NFT or token)',
  '0x1249c58b': 'Mint NFT',
  '0x6a627842': 'Mint',
  '0x4e71d92d': 'Claim rewards / staking rewards',
  '0x3d18b912': 'Claim staking rewards',
  '0x2e1a7d4d': 'Unwrap WETH',
  '0xd0e30db0': 'Wrap ETH (deposit to WETH)',
  '0xe8eda9df': 'Aave deposit',
  '0x69328dec': 'Aave withdraw',
  '0x573ade81': 'Aave repay',
  '0x': 'Simple ETH transfer (no contract call)',
};

function buildLegacyPrompt(tx: RawTransaction, ethUsdPrice: number | null, walletAddress: string): string {
  const ethValue = weiToEth(tx.value);
  const usdEstimateText = ethUsdPrice !== null ? `~$${(ethValue * ethUsdPrice).toFixed(2)} USD` : 'unknown price';
  const direction = tx.from.toLowerCase() === walletAddress.toLowerCase() ? 'outgoing' : 'incoming';
  const inputPrefix = tx.input?.slice(0, 10) || '0x';
  const methodHint = METHOD_HINTS[inputPrefix] || `Contract interaction (${inputPrefix})`;
  const tokenInfo = tx.tokenSymbol ? `Token: ${tx.tokenName} (${tx.tokenSymbol})` : '';

  return `You are a blockchain transaction classifier for a crypto tax app. Given a raw Ethereum transaction, output ONLY valid JSON with these exact fields: description, category, confidence.

Transaction details:
- Direction: ${direction} (wallet is ${walletAddress})
- From: ${tx.from}
- To: ${tx.to || 'Contract creation'}
- ETH value: ${ethValue.toFixed(6)} ETH (${usdEstimateText} at time of transaction)
- Method: ${methodHint}
${tokenInfo}
- Contract: ${tx.contractAddress || tx.to}
- Error: ${tx.isError === '1' ? 'YES - transaction failed' : 'No'}
- Function name: ${tx.functionName || 'N/A'}

Rules for category:
- "trade": swaps, token purchases/sales, DeFi trades that involve exchanging one asset for another
- "income": staking rewards, yield farming, airdrops, mining rewards — receiving tokens without giving something equivalent in return
- "transfer": moving assets between wallets you own, simple sends, wrapping/unwrapping
- "nft": NFT mints, NFT purchases, NFT sales, NFT transfers

Output ONLY this JSON (no markdown, no extra text):
{"description":"<one sentence, plain English, max 15 words, e.g. Swapped 0.5 ETH for 850 USDC on Uniswap>","category":"<trade|income|transfer|nft>","confidence":<0.0-1.0>}`;
}

async function callGeminiLegacy(prompt: string): Promise<{ description: string; category: TaxCategory; confidence: number }> {
  let apiKey: string;
  try {
    apiKey = getGeminiKey();
  } catch {
    return { description: 'Transaction processed locally', category: 'unknown', confidence: 0.5 };
  }

  for (const apiUrl of GEMINI_API_URLS) {
    try {
      const res = await fetch(`${apiUrl}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 150,
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleaned);

        return {
          description: parsed.description || 'Transaction details processed',
          category: (['trade', 'income', 'transfer', 'nft'].includes(parsed.category)
            ? parsed.category
            : 'unknown') as TaxCategory,
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        };
      }
    } catch {
      // Continue to next endpoint
    }
  }

  return { description: 'Transaction processed locally', category: 'unknown', confidence: 0.5 };
}

function createConcurrencyLimiter(maxConcurrent: number) {
  let running = 0;
  const queue: Array<() => void> = [];

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => {
        running++;
        fn()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            running--;
            if (queue.length > 0) queue.shift()!();
          });
      };

      if (running < maxConcurrent) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

const limit = createConcurrencyLimiter(3);

export async function classifyTransaction(
  tx: RawTransaction,
  walletAddress: string,
  onProgress?: (classified: ClassifiedTransaction) => void
): Promise<ClassifiedTransaction> {
  const ethValue = weiToEth(tx.value);
  const date = new Date(parseInt(tx.timeStamp) * 1000);

  const base: ClassifiedTransaction = {
    ...tx,
    description: 'Classifying…',
    category: 'unknown',
    confidence: 0,
    usdValue: null,
    ethValue,
    status: 'classifying',
    date,
  };

  try {
    // Step 1: Get historical ETH price (DefiLlama + IndexedDB)
    const ethUsdPrice = await getHistoricalPrice('ETH', tx.timeStamp);
    const usdValue = ethUsdPrice !== null ? ethValue * ethUsdPrice : null;

    // Step 2: Extract features (instant, local)
    const features = extractFeatures(tx, walletAddress, ethUsdPrice);

    // Step 3: Classify — try ML first, then rule-based fallback
    let category: TaxCategory;
    let confidence: number;
    let classificationSource: 'ml' | 'rules' | 'gemini';

    const mlResult = await classifyWithML(features);

    if (mlResult) {
      category = mlResult.category;
      confidence = mlResult.confidence;
      classificationSource = 'ml';
    } else {
      const rulesResult = classifyWithRules(features);
      category = rulesResult.category;
      confidence = rulesResult.confidence;
      classificationSource = 'rules';
    }

    // Step 4: Generate description via Gemini (with local fallback)
    let description: string;
    try {
      description = await limit(() =>
        generateDescription(tx, category, ethValue, usdValue)
      );
    } catch (descErr) {
      console.warn('Description generation failed, using fallback', descErr);
      const inputPrefix = tx.input?.slice(0, 10) || '0x';
      const methodHint = METHOD_HINTS[inputPrefix];
      description = methodHint
        ? `${methodHint} — ${ethValue.toFixed(4)} ETH`
        : `${category} transaction (${ethValue.toFixed(4)} ETH)`;
    }

    console.log(`[${classificationSource}] ${tx.hash.slice(0, 10)}… → ${category} (${(confidence * 100).toFixed(0)}%)`);

    const classified: ClassifiedTransaction = {
      ...base,
      description,
      category,
      confidence,
      usdValue,
      status: 'classified',
    };

    if (onProgress) onProgress(classified);
    return classified;
  } catch (err) {
    console.error('Classification failed for tx', tx.hash, err);

    try {
      const ethUsdPrice = await getHistoricalPrice('ETH', tx.timeStamp);
      const usdValue = ethUsdPrice !== null ? ethValue * ethUsdPrice : null;
      const prompt = buildLegacyPrompt(tx, ethUsdPrice, walletAddress);
      const result = await limit(() => callGeminiLegacy(prompt));

      const classified: ClassifiedTransaction = {
        ...base,
        description: result.description,
        category: result.category,
        confidence: result.confidence,
        usdValue,
        status: 'classified',
      };

      if (onProgress) onProgress(classified);
      return classified;
    } catch {
      const failed: ClassifiedTransaction = {
        ...base,
        description: `Uncategorized transaction (${ethValue.toFixed(4)} ETH)`,
        category: 'unknown',
        status: 'classified',
        confidence: 0.0,
        usdValue: null,
      };
      if (onProgress) onProgress(failed);
      return failed;
    }
  }
}

export async function classifyAll(
  transactions: RawTransaction[],
  walletAddress: string,
  onEachClassified: (classified: ClassifiedTransaction) => void
): Promise<ClassifiedTransaction[]> {
  const results = await Promise.all(
    transactions.map(tx => classifyTransaction(tx, walletAddress, onEachClassified))
  );
  return results;
}
