// src/services/multiChain.ts
//
// Multi-Chain Indexer Abstraction Layer supporting Ethereum, Arbitrum, Base, Optimism, and Polygon.
// Handles multi-chain fetching and internal transaction log extraction.

import type { ChainConfig, ChainId, RawTransaction } from '../types';
import { decodeAbiData } from './abiDecoder';

export const CHAIN_CONFIGS: Record<ChainId, ChainConfig> = {
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum Mainnet',
    symbol: 'ETH',
    icon: '⟠',
    explorerUrl: 'https://etherscan.io',
    apiUrl: 'https://api.etherscan.io/api',
    color: '#627EEA',
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum One',
    symbol: 'ETH',
    icon: '🔵',
    explorerUrl: 'https://arbiscan.io',
    apiUrl: 'https://api.arbiscan.io/api',
    color: '#28A0F0',
  },
  base: {
    id: 'base',
    name: 'Base L2',
    symbol: 'ETH',
    icon: '🔷',
    explorerUrl: 'https://basescan.org',
    apiUrl: 'https://api.basescan.org/api',
    color: '#0052FF',
  },
  optimism: {
    id: 'optimism',
    name: 'Optimism Mainnet',
    symbol: 'ETH',
    icon: '🔴',
    explorerUrl: 'https://optimistic.etherscan.io',
    apiUrl: 'https://api-optimistic.etherscan.io/api',
    color: '#FF0420',
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon PoS',
    symbol: 'POL',
    icon: '💜',
    explorerUrl: 'https://polygonscan.com',
    apiUrl: 'https://api.polygonscan.com/api',
    color: '#8247E5',
  },
};

export function getChainConfig(chainId: ChainId = 'ethereum'): ChainConfig {
  return CHAIN_CONFIGS[chainId] || CHAIN_CONFIGS.ethereum;
}

export function getEtherscanApiKey(): string | null {
  const key = import.meta.env.VITE_ETHERSCAN_API_KEY;
  if (!key || key === 'your_etherscan_api_key_here' || key.trim() === '') {
    return null;
  }
  return key;
}

export async function fetchChainTransactions(
  address: string,
  chainId: ChainId = 'ethereum'
): Promise<RawTransaction[]> {
  const apiKey = getEtherscanApiKey();
  const chain = getChainConfig(chainId);

  if (!apiKey) {
    // If no key set, fallback to mainnet demo transactions tagged with target chainId
    return [];
  }

  const url = new URL(chain.apiUrl);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'txlist');
  url.searchParams.set('address', address);
  url.searchParams.set('startblock', '0');
  url.searchParams.set('endblock', '99999999');
  url.searchParams.set('page', '1');
  url.searchParams.set('offset', '100');
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('apikey', apiKey);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];

    const data = await res.json();
    if (data.status === '0') return [];

    const txs = (data.result as RawTransaction[]).map((tx) => {
      const decoded = decodeAbiData(tx.input);
      return {
        ...tx,
        walletLabel: address,
        chainId,
        decodedAbiMethod: decoded.methodName,
      };
    });

    return txs;
  } catch (err) {
    console.warn(`Fetch failed for chain ${chainId}:`, err);
    return [];
  }
}

export async function fetchInternalTransactions(
  address: string,
  chainId: ChainId = 'ethereum'
): Promise<RawTransaction[]> {
  const apiKey = getEtherscanApiKey();
  const chain = getChainConfig(chainId);
  if (!apiKey) return [];

  const url = new URL(chain.apiUrl);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'txlistinternal');
  url.searchParams.set('address', address);
  url.searchParams.set('page', '1');
  url.searchParams.set('offset', '50');
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('apikey', apiKey);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];

    const data = await res.json();
    if (data.status === '0') return [];

    return (data.result as RawTransaction[]).map((tx) => ({
      ...tx,
      walletLabel: address,
      chainId,
      isInternal: true,
      decodedAbiMethod: 'Internal Smart Contract Call',
    }));
  } catch (err) {
    console.warn(`Internal tx fetch failed for chain ${chainId}:`, err);
    return [];
  }
}
