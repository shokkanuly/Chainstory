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
import { generateDescription, generateFallbackDescription } from './descriptionGenerator';
import { getMethodLabel } from './methodRegistry';
import { resolveAsset } from './assetResolver';


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
  const asset = resolveAsset(tx);

  const base: ClassifiedTransaction = {
    ...tx,
    description: 'Classifying…',
    category: 'unknown',
    confidence: 0,
    usdValue: null,
    ethValue,
    assetSymbol: asset.symbol,
    assetAmount: asset.amount,
    ethPriceUsd: null,
    status: 'classifying',
    date,
  };

  try {
    // Step 1: Price the asset that actually moved, and — separately — the
    // native token, which is what gas is denominated in. For a native-asset
    // transfer these are the same lookup and the cache collapses them.
    const [assetPrice, ethUsdPrice] = await Promise.all([
      getHistoricalPrice(asset.symbol, tx.timeStamp),
      getHistoricalPrice('ETH', tx.timeStamp),
    ]);
    const usdValue = assetPrice !== null ? asset.amount * assetPrice : null;

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
      const methodHint = getMethodLabel(tx.input);
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
      ethPriceUsd: ethUsdPrice,
      status: 'classified',
    };

    if (onProgress) onProgress(classified);
    return classified;
  } catch (err) {
    // The path above is the only one that touches the network. Recovery is
    // entirely local so it cannot fail for the same reason twice: classify
    // from the rule engine and describe from the keyword engine.
    console.error('Classification failed for tx', tx.hash, err);

    const features = extractFeatures(tx, walletAddress, null);
    const rules = classifyWithRules(features);

    const recovered: ClassifiedTransaction = {
      ...base,
      description: generateFallbackDescription(tx, rules.category, ethValue),
      category: rules.category,
      confidence: rules.confidence,
      usdValue: null,
      status: 'classified',
    };

    if (onProgress) onProgress(recovered);
    return recovered;
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
