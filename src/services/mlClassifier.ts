// src/services/mlClassifier.ts
//
// In-browser XGBoost inference via ONNX Runtime Web.
// Falls back to the legacy Gemini-based classification if the ONNX model
// is not available (e.g. not yet trained, or failed to load).
//
// FIX D: No Python microservice needed — the model runs entirely in the
// browser, so there's nothing to keep alive during a demo/judging.

import type { TaxCategory } from '../types';
import type { TransactionFeatures } from './featureExtractor';

// ONNX Runtime Web types — loaded dynamically
let onnxSession: any | null = null;
let onnxLoadAttempted = false;
let onnxLoadError: string | null = null;

// Feature encoding maps — must match the LabelEncoder used in train_classifier.py
// These are populated after training; for now, sensible defaults.
const METHOD_CATEGORY_ENCODING: Record<string, number> = {
  '1inch_swap': 0,
  'aave_deposit': 1,
  'aave_repay': 2,
  'aave_withdraw': 3,
  'erc20_approve': 4,
  'erc20_transfer': 5,
  'erc20_transfer_from': 6,
  'mint': 7,
  'nft_mint': 8,
  'simple_transfer': 9,
  'staking_claim': 10,
  'uniswap_swap_eth_for_tokens': 11,
  'uniswap_swap_tokens_for_eth': 12,
  'uniswap_swap_tokens_for_tokens': 13,
  'uniswap_universal_router_swap': 14,
  'uniswap_v3_multicall': 15,
  'uniswap_v3_swap': 16,
  'unknown': 17,
  'weth_deposit': 18,
  'weth_withdraw': 19,
};

const PROTOCOL_GROUP_ENCODING: Record<string, number> = {
  'bridge': 0,
  'dex': 1,
  'lending': 2,
  'nft_marketplace': 3,
  'staking_defi': 4,
  'unknown': 5,
  'wrapper': 6,
};

const CATEGORY_INDEX_TO_NAME: TaxCategory[] = ['trade', 'income', 'transfer', 'nft'];

export interface MLClassificationResult {
  category: TaxCategory;
  confidence: number;
  probabilities: Record<string, number>;
  source: 'ml' | 'fallback';
}

/**
 * Attempt to load the ONNX model from public/models/.
 * Called lazily on first classification request.
 */
async function loadOnnxModel(): Promise<boolean> {
  if (onnxLoadAttempted) return onnxSession !== null;
  onnxLoadAttempted = true;

  try {
    // Dynamic import so the app doesn't crash if onnxruntime-web isn't installed
    const ort = await import('onnxruntime-web');
    onnxSession = await ort.InferenceSession.create('/models/xgboost_classifier.onnx');
    console.log('✅ ONNX model loaded successfully — ML classification active');
    return true;
  } catch (err) {
    onnxLoadError = err instanceof Error ? err.message : String(err);
    console.warn(
      '⚠️ ONNX model not available — falling back to Gemini classification.',
      'This is expected if the model has not been trained yet.',
      onnxLoadError
    );
    return false;
  }
}

/**
 * Encode a TransactionFeatures object into a flat Float32 array matching
 * the feature order expected by the trained XGBoost model.
 *
 * Feature order (must match FEATURE_COLUMNS in train_classifier.py):
 * [method_category, direction, eth_value, usd_value, gas_used,
 *  has_token_transfer, protocol_group, input_data_length, is_failed,
 *  is_known_contract]
 */
function encodeFeatures(features: TransactionFeatures): Float32Array {
  return new Float32Array([
    METHOD_CATEGORY_ENCODING[features.methodCategory] ?? METHOD_CATEGORY_ENCODING['unknown'],
    features.direction === 'incoming' ? 1 : 0,
    features.ethValue,
    features.usdValue ?? 0,
    features.gasUsed,
    features.hasTokenTransfer ? 1 : 0,
    PROTOCOL_GROUP_ENCODING[features.protocolGroup] ?? PROTOCOL_GROUP_ENCODING['unknown'],
    features.inputDataLength,
    features.isFailed ? 1 : 0,
    features.isKnownContract ? 1 : 0,
  ]);
}

/**
 * Run the XGBoost classifier on a single transaction's features.
 * Returns null if the model is not available (triggers fallback).
 */
export async function classifyWithML(
  features: TransactionFeatures
): Promise<MLClassificationResult | null> {
  const modelReady = await loadOnnxModel();
  if (!modelReady || !onnxSession) return null;

  try {
    const ort = await import('onnxruntime-web');
    const inputTensor = new ort.Tensor('float32', encodeFeatures(features), [1, 10]);

    const results = await onnxSession.run({ input: inputTensor });

    // XGBoost ONNX outputs probabilities as 'probabilities' or 'output_probability'
    const outputName = onnxSession.outputNames[0];
    const outputData = results[outputName].data as Float32Array;

    // For multi-class softprob, output is [batch_size * num_classes]
    const probs = Array.from(outputData);

    // Find the predicted class (highest probability)
    let maxIdx = 0;
    let maxProb = probs[0];
    for (let i = 1; i < probs.length && i < 4; i++) {
      if (probs[i] > maxProb) {
        maxProb = probs[i];
        maxIdx = i;
      }
    }

    const category = CATEGORY_INDEX_TO_NAME[maxIdx] || 'unknown';
    const probabilities: Record<string, number> = {};
    CATEGORY_INDEX_TO_NAME.forEach((name, idx) => {
      probabilities[name] = probs[idx] || 0;
    });

    return {
      category,
      confidence: maxProb,
      probabilities,
      source: 'ml',
    };
  } catch (err) {
    console.error('ONNX inference error:', err);
    return null;
  }
}

/**
 * Rule-based fallback classifier — uses method signature and protocol
 * group heuristics when neither ONNX nor Gemini is available.
 * Better than returning 'unknown' for every transaction.
 */
export function classifyWithRules(features: TransactionFeatures): MLClassificationResult {
  const { methodCategory, protocolGroup, direction, hasTokenTransfer } = features;

  let category: TaxCategory = 'unknown';
  let confidence = 0.5;

  // Swap / DEX interactions → trade
  if (methodCategory.includes('swap') || methodCategory.includes('1inch') ||
      protocolGroup === 'dex') {
    category = 'trade';
    confidence = 0.85;
  }
  // NFT operations
  else if (methodCategory.includes('nft_mint') || protocolGroup === 'nft_marketplace') {
    category = 'nft';
    confidence = 0.85;
  }
  // Staking claims → income
  else if (methodCategory.includes('staking_claim') || methodCategory.includes('claim')) {
    category = 'income';
    confidence = 0.80;
  }
  // Simple transfers
  else if (methodCategory === 'simple_transfer' ||
           methodCategory === 'erc20_transfer') {
    category = 'transfer';
    confidence = 0.80;
  }
  // WETH wrap/unwrap → transfer
  else if (methodCategory.includes('weth_') || protocolGroup === 'wrapper') {
    category = 'transfer';
    confidence = 0.85;
  }
  // Aave / lending → trade (depositing/withdrawing is a taxable event in some jurisdictions)
  else if (methodCategory.includes('aave_') || protocolGroup === 'lending') {
    category = 'trade';
    confidence = 0.60;
  }
  // Token approval → transfer (non-taxable, just permission granting)
  else if (methodCategory === 'erc20_approve') {
    category = 'transfer';
    confidence = 0.90;
  }
  // Incoming + no contract interaction → could be income (airdrop) or transfer
  else if (direction === 'incoming' && !hasTokenTransfer) {
    category = 'transfer';
    confidence = 0.50;
  }

  return {
    category,
    confidence,
    probabilities: { [category]: confidence },
    source: 'fallback',
  };
}

/**
 * Check if the ONNX model is available.
 */
export function isMLModelAvailable(): boolean {
  return onnxSession !== null;
}

/**
 * Get the reason the model failed to load, if any.
 */
export function getMLLoadError(): string | null {
  return onnxLoadError;
}
