// src/services/methodRegistry.ts
//
// One table of known 4-byte function selectors, with both representations:
//
//   slug  — machine-friendly, fed to the classifier as a categorical feature
//   label — human-friendly, shown to the user in fallback descriptions
//
// These used to be two separate `METHOD_HINTS` maps (classifier.ts held the
// prose, featureExtractor.ts held the slugs) which drifted apart and leaked
// slugs like "erc20_approve" into user-facing text. Keep them together so a
// new selector can only ever be added with both halves.
//
// Deliberately incomplete: `unknown` is a first-class value. The classifier
// must still work on selectors that are not in this table.

export interface MethodInfo {
  slug: string;
  label: string;
}

export const METHOD_REGISTRY: Record<string, MethodInfo> = {
  // ERC-20 token operations
  '0xa9059cbb': { slug: 'erc20_transfer', label: 'ERC-20 token transfer' },
  '0x23b872dd': { slug: 'erc20_transfer_from', label: 'ERC-20 transferFrom' },
  '0x095ea7b3': { slug: 'erc20_approve', label: 'ERC-20 approve (authorize spending)' },

  // Uniswap swaps (V2 / V3 / Universal Router)
  '0x7ff36ab5': { slug: 'uniswap_swap_eth_for_tokens', label: 'Uniswap swap ETH for tokens' },
  '0x38ed1739': { slug: 'uniswap_swap_tokens_for_tokens', label: 'Uniswap swap tokens for tokens' },
  '0x18cbafe5': { slug: 'uniswap_swap_tokens_for_eth', label: 'Uniswap swap tokens for ETH' },
  '0x5ae401dc': { slug: 'uniswap_v3_multicall', label: 'Uniswap V3 multicall (swap)' },
  '0xb6f9de95': { slug: 'uniswap_v3_swap', label: 'Uniswap V3 swap' },
  '0x3593564c': { slug: 'uniswap_universal_router_swap', label: 'Uniswap Universal Router swap' },

  // 1inch swaps
  '0x12aa3caf': { slug: '1inch_swap', label: '1inch swap' },
  '0xe449022e': { slug: '1inch_swap', label: '1inch swap' },

  // NFT operations
  '0xa0712d68': { slug: 'nft_mint', label: 'Mint (NFT or token)' },
  '0x1249c58b': { slug: 'nft_mint', label: 'Mint NFT' },
  '0x6a627842': { slug: 'mint', label: 'Mint' },

  // Staking / Rewards
  '0x4e71d92d': { slug: 'staking_claim', label: 'Claim rewards / staking rewards' },
  '0x3d18b912': { slug: 'staking_claim', label: 'Claim staking rewards' },

  // WETH wrap / unwrap
  '0x2e1a7d4d': { slug: 'weth_withdraw', label: 'Unwrap WETH' },
  '0xd0e30db0': { slug: 'weth_deposit', label: 'Wrap ETH (deposit to WETH)' },

  // Aave lending operations
  '0xe8eda9df': { slug: 'aave_deposit', label: 'Aave deposit' },
  '0x69328dec': { slug: 'aave_withdraw', label: 'Aave withdraw' },
  '0x573ade81': { slug: 'aave_repay', label: 'Aave repay' },

  // Simple native transfer (empty calldata)
  '0x': { slug: 'simple_transfer', label: 'Simple ETH transfer (no contract call)' },
};

/** Normalise calldata to its 4-byte selector, or '0x' for a plain transfer. */
export function getSelector(input: string | undefined): string {
  if (!input || input === '0x' || input.length < 10) return '0x';
  return input.slice(0, 10).toLowerCase();
}

/** Machine-readable category for the classifier feature vector. */
export function getMethodSlug(input: string | undefined): string {
  return METHOD_REGISTRY[getSelector(input)]?.slug ?? 'unknown';
}

/** Human-readable label, or null when the selector is unrecognised. */
export function getMethodLabel(input: string | undefined): string | null {
  return METHOD_REGISTRY[getSelector(input)]?.label ?? null;
}
