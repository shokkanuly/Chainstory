// src/services/featureExtractor.ts
//
// Pure feature extraction — no API calls, no side effects. Takes a raw
// transaction + context and produces the tabular feature vector consumed
// by the XGBoost/ONNX classifier.
//
// IMPORTANT: methodCategory (the rule-based signature lookup) is kept as
// ONE feature among several, not the dominant signal. The model needs to
// be able to classify transactions where methodCategory === 'unknown'
// using direction/value/gas/protocol features — that's the entire reason
// to train a model instead of just extending the lookup table.

import type { RawTransaction } from '../types';
import { getProtocolGroup, isKnownContract } from './protocolRegistry';
import { getMethodSlug, getSelector } from './methodRegistry';
import { weiToEth } from './assetResolver';

export interface TransactionFeatures {
  methodSignature: string;
  methodCategory: string;
  direction: 'incoming' | 'outgoing';
  ethValue: number;
  usdValue: number | null;
  gasUsed: number;
  gasPrice: number;
  hasTokenTransfer: boolean;
  tokenSymbol: string | null;
  protocolGroup: string;
  isKnownContract: boolean;     // explicit "have we seen this address" signal
  isContractCreation: boolean;
  isFailed: boolean;
  inputDataLength: number;
}


export function extractFeatures(
  tx: RawTransaction,
  walletAddress: string,
  ethUsdPrice: number | null
): TransactionFeatures {
  const methodSignature = getSelector(tx.input);
  const methodCategory = getMethodSlug(tx.input);
  const direction = tx.from?.toLowerCase() === walletAddress.toLowerCase()
    ? 'outgoing' : 'incoming';
  const ethValue = weiToEth(tx.value);
  const usdValue = ethUsdPrice != null ? ethValue * ethUsdPrice : null;

  return {
    methodSignature,
    methodCategory,
    direction,
    ethValue,
    usdValue,
    gasUsed: Number(tx.gasUsed || 0),
    gasPrice: Number(tx.gasPrice || 0),
    hasTokenTransfer: tx.tokenSymbol != null && tx.tokenSymbol !== undefined,
    tokenSymbol: tx.tokenSymbol || null,
    protocolGroup: getProtocolGroup(tx.to),
    isKnownContract: isKnownContract(tx.to),
    isContractCreation: !tx.to || tx.to === '',
    isFailed: tx.isError === '1',
    inputDataLength: tx.input?.length || 0,
  };
}
