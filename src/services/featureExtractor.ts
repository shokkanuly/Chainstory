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

// Complete method signature hints — sourced from the original classifier.ts
// METHOD_HINTS, with machine-friendly category names for XGBoost features.
const METHOD_HINTS: Record<string, string> = {
  // ERC-20 token operations
  '0xa9059cbb': 'erc20_transfer',
  '0x23b872dd': 'erc20_transfer_from',
  '0x095ea7b3': 'erc20_approve',

  // Uniswap swaps (V2 / V3 / Universal Router)
  '0x7ff36ab5': 'uniswap_swap_eth_for_tokens',
  '0x38ed1739': 'uniswap_swap_tokens_for_tokens',
  '0x18cbafe5': 'uniswap_swap_tokens_for_eth',
  '0x5ae401dc': 'uniswap_v3_multicall',
  '0xb6f9de95': 'uniswap_v3_swap',
  '0x3593564c': 'uniswap_universal_router_swap',

  // 1inch swaps
  '0x12aa3caf': '1inch_swap',
  '0xe449022e': '1inch_swap',

  // NFT operations
  '0xa0712d68': 'nft_mint',
  '0x1249c58b': 'nft_mint',
  '0x6a627842': 'mint',

  // Staking / Rewards
  '0x4e71d92d': 'staking_claim',
  '0x3d18b912': 'staking_claim',

  // WETH wrap / unwrap
  '0x2e1a7d4d': 'weth_withdraw',
  '0xd0e30db0': 'weth_deposit',

  // Aave lending operations
  '0xe8eda9df': 'aave_deposit',
  '0x69328dec': 'aave_withdraw',
  '0x573ade81': 'aave_repay',

  // Simple ETH transfer (empty calldata)
  '0x': 'simple_transfer',
};

function weiToEth(weiStr: string): number {
  try {
    const num = parseFloat(weiStr);
    if (isNaN(num)) return 0;
    return num / 1e18;
  } catch {
    return 0;
  }
}

export function extractFeatures(
  tx: RawTransaction,
  walletAddress: string,
  ethUsdPrice: number | null
): TransactionFeatures {
  const methodSignature = tx.input?.slice(0, 10) || '0x';
  const methodCategory = METHOD_HINTS[methodSignature] || 'unknown';
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

// Export METHOD_HINTS for use by the description generator
export { METHOD_HINTS };
