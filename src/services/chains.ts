// src/services/chains.ts
//
// Static EVM chain registry. Deliberately dependency-free so that low-level
// modules (asset resolution, explorers) can read it without creating an
// import cycle through the fetch layer.

import type { ChainConfig, ChainId } from '../types';

export const CHAIN_CONFIGS: Record<ChainId, ChainConfig> = {
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum Mainnet',
    symbol: 'ETH',
    icon: 'https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg',
    explorerUrl: 'https://etherscan.io',
    apiUrl: 'https://api.etherscan.io/api',
    color: '#627EEA',
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum One',
    symbol: 'ETH',
    icon: 'https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg',
    explorerUrl: 'https://arbiscan.io',
    apiUrl: 'https://api.arbiscan.io/api',
    color: '#28A0F0',
  },
  base: {
    id: 'base',
    name: 'Base L2',
    symbol: 'ETH',
    icon: 'https://icons.llamao.fi/icons/chains/rsz_base.jpg',
    explorerUrl: 'https://basescan.org',
    apiUrl: 'https://api.basescan.org/api',
    color: '#0052FF',
  },
  optimism: {
    id: 'optimism',
    name: 'Optimism Mainnet',
    symbol: 'ETH',
    icon: 'https://icons.llamao.fi/icons/chains/rsz_optimism.jpg',
    explorerUrl: 'https://optimistic.etherscan.io',
    apiUrl: 'https://api-optimistic.etherscan.io/api',
    color: '#FF0420',
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon PoS',
    symbol: 'POL',
    icon: 'https://icons.llamao.fi/icons/chains/rsz_polygon.jpg',
    explorerUrl: 'https://polygonscan.com',
    apiUrl: 'https://api.polygonscan.com/api',
    color: '#8247E5',
  },
};

export function getChainConfig(chainId: ChainId = 'ethereum'): ChainConfig {
  return CHAIN_CONFIGS[chainId] || CHAIN_CONFIGS.ethereum;
}

/**
 * Link to a transaction on the right explorer for its chain.
 *
 * Every link in the app used to point at etherscan.io, so an Arbitrum or Base
 * transaction led to a dead page. The per-chain URLs were already here; they
 * simply were not used.
 */
export function explorerTxUrl(hash: string, chainId: ChainId = 'ethereum'): string {
  return `${getChainConfig(chainId).explorerUrl}/tx/${hash}`;
}
