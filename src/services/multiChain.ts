// src/services/multiChain.ts
//
// Multi-Chain Indexer Abstraction Layer supporting Ethereum, Arbitrum, Base, Optimism, and Polygon.
// Handles multi-chain fetching and internal transaction log extraction.

import type { ChainId, RawTransaction } from '../types';
import { CHAIN_CONFIGS, getChainConfig } from './chains';
import { decodeAbiData } from './abiDecoder';
import { explorerRequest } from './apiClient';


// Re-exported so existing importers of multiChain keep working.
export { CHAIN_CONFIGS, getChainConfig };


export async function fetchChainTransactions(
  address: string,
  chainId: ChainId = 'ethereum'
): Promise<RawTransaction[]> {
  try {
    const data = await explorerRequest(chainId, {
      module: 'account',
      action: 'txlist',
      address,
      startblock: 0,
      endblock: 99999999,
      page: 1,
      offset: 100,
      sort: 'desc',
    });
    if (data.status === '0') return [];

    return (data.result as RawTransaction[]).map((tx) => {
      const decoded = decodeAbiData(tx.input);
      return { ...tx, walletLabel: address, chainId, decodedAbiMethod: decoded.methodName };
    });
  } catch (err) {
    console.warn(`Fetch failed for chain ${chainId}:`, err);
    return [];
  }
}

export async function fetchInternalTransactions(
  address: string,
  chainId: ChainId = 'ethereum'
): Promise<RawTransaction[]> {
  try {
    const data = await explorerRequest(chainId, {
      module: 'account',
      action: 'txlistinternal',
      address,
      page: 1,
      offset: 50,
      sort: 'desc',
    });
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
