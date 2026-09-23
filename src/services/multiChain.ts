// src/services/multiChain.ts
//
// Multi-Chain Indexer Abstraction Layer supporting Ethereum, Arbitrum, Base, Optimism, and Polygon.
// Handles multi-chain fetching and internal transaction log extraction.

import type { ChainId, RawTransaction } from '../types';
import { CHAIN_CONFIGS, getChainConfig } from './chains';
import { decodeAbiData } from './abiDecoder';
import { fetchWithRetry } from './etherscan';


// Re-exported so existing importers of multiChain keep working.
export { CHAIN_CONFIGS, getChainConfig };

export function getChainApiKey(chainId: ChainId = 'ethereum'): string | null {
  const getEnv = (key: string): string | undefined => {
    try {
      if (typeof import.meta !== 'undefined' && import.meta?.env) {
        return import.meta.env[key];
      }
    } catch { /* env source unavailable */ }
    try {
      const gProcess = (globalThis as any).process;
      if (gProcess && gProcess.env) {
        return gProcess.env[key];
      }
    } catch { /* env source unavailable */ }
    return undefined;
  };

  const ethKey = getEnv('VITE_ETHERSCAN_API_KEY');
  const envKeyMap: Record<ChainId, string | undefined> = {
    ethereum: ethKey,
    arbitrum: getEnv('VITE_ARBISCAN_API_KEY') || ethKey,
    base: getEnv('VITE_BASESCAN_API_KEY') || ethKey,
    optimism: getEnv('VITE_OPTIMISM_API_KEY') || ethKey,
    polygon: getEnv('VITE_POLYGONSCAN_API_KEY') || ethKey,
  };

  const key = envKeyMap[chainId] || ethKey;
  if (!key || key.includes('your_') || key.trim() === '') {
    return null;
  }
  return key;
}

export async function fetchChainTransactions(
  address: string,
  chainId: ChainId = 'ethereum'
): Promise<RawTransaction[]> {
  const apiKey = getChainApiKey(chainId);
  const chain = getChainConfig(chainId);

  if (!apiKey) {
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
    const data = await fetchWithRetry(url.toString());
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
  const apiKey = getChainApiKey(chainId);
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
    const data = await fetchWithRetry(url.toString());
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
