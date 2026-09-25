// src/services/etherscan.ts
//
// Ethereum history, ENS resolution and the shared address helpers.
// All keyed requests go through services/apiClient, which talks to our own
// /api proxy. No explorer key is readable from client code.

import type { FetchResult, RawTransaction } from '../types';
import { explorerRequest, NoServerKeyError } from './apiClient';

// Helper to generate realistic mock transactions when no API key or network fallback occurs
// Synthetic transactions for offline/no-key demos. Every record is flagged
// `isDemo` so the UI can label it — callers must never present these as
// real chain history.
function generateMockTransactionsForAddress(address: string): RawTransaction[] {
  const cleanAddr = address.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const day = 86400;

  return [
    {
      hash: `0x1a8f9c2d${cleanAddr.slice(2, 10)}88219`,
      blockNumber: '19482010',
      timeStamp: String(now - day * 0.2),
      from: address,
      to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      value: '1500000000000000000', // 1.5 ETH
      gas: '21000',
      gasPrice: '22000000000',
      gasUsed: '21000',
      input: '0x',
      isError: '0',
      txreceipt_status: '1',
      functionName: 'transfer(address to, uint256 amount)',
      walletLabel: address,
      isDemo: true,
    },
    {
      hash: `0x7b3e104f${cleanAddr.slice(2, 10)}90412`,
      blockNumber: '19475102',
      timeStamp: String(now - day * 1.5),
      from: '0x1111111254fb6c44bac0bed2854e76f90643097d', // 1inch / Uniswap
      to: address,
      value: '0',
      gas: '185000',
      gasPrice: '25000000000',
      gasUsed: '142000',
      input: '0x12aa3caf000000000000000000000000',
      isError: '0',
      txreceipt_status: '1',
      functionName: 'swap(address caller, tuple desc, bytes data)',
      tokenName: 'USD Coin',
      tokenSymbol: 'USDC',
      tokenDecimal: '6',
      walletLabel: address,
      isDemo: true,
    },
    {
      hash: `0x4c99021a${cleanAddr.slice(2, 10)}51182`,
      blockNumber: '19460010',
      timeStamp: String(now - day * 3.1),
      from: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', // Lido Staking
      to: address,
      value: '45000000000000000', // 0.045 ETH
      gas: '54000',
      gasPrice: '18000000000',
      gasUsed: '51200',
      input: '0x4e71d92d',
      isError: '0',
      txreceipt_status: '1',
      functionName: 'claimRewards()',
      walletLabel: address,
      isDemo: true,
    },
    {
      hash: `0x9e812d44${cleanAddr.slice(2, 10)}11094`,
      blockNumber: '19441200',
      timeStamp: String(now - day * 5.8),
      from: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', // NFT Contract
      to: address,
      value: '800000000000000000', // 0.8 ETH
      gas: '120000',
      gasPrice: '21000000000',
      gasUsed: '115000',
      input: '0xa0712d68000000000000000000000000',
      isError: '0',
      txreceipt_status: '1',
      functionName: 'mint(uint256 quantity)',
      tokenName: 'Bored Ape Yacht Club',
      tokenSymbol: 'BAYC',
      contractAddress: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
      walletLabel: address,
      isDemo: true,
    },
    {
      hash: `0x3f5c9102${cleanAddr.slice(2, 10)}33211`,
      blockNumber: '19420000',
      timeStamp: String(now - day * 8.4),
      from: address,
      to: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f',
      value: '2000000000000000000', // 2.0 ETH
      gas: '21000',
      gasPrice: '20000000000',
      gasUsed: '21000',
      input: '0x',
      isError: '0',
      txreceipt_status: '1',
      functionName: 'transfer(address to, uint256 amount)',
      walletLabel: address,
      isDemo: true,
    },
  ];
}


export async function fetchNormalTransactions(address: string): Promise<FetchResult> {
  try {
    const data = await explorerRequest('ethereum', {
      module: 'account',
      action: 'txlist',
      address,
      startblock: 0,
      endblock: 99999999,
      page: 1,
      offset: 100,
      sort: 'desc',
    });

    if (data.status === '0') {
      // An empty history is a real, correct answer, not a reason for demo data.
      if (data.message === 'No transactions found') {
        return { transactions: [], source: 'live' };
      }
      const notice = String(data.message || data.result);
      console.warn(`Explorer notice: ${notice}`);
      return {
        transactions: generateMockTransactionsForAddress(address),
        source: 'demo',
        demoReason: `Explorer returned: ${notice}`,
      };
    }

    return {
      transactions: (data.result as RawTransaction[]).map((tx) => ({ ...tx, walletLabel: address })),
      source: 'live',
    };
  } catch (err) {
    const reason =
      err instanceof NoServerKeyError
        ? 'No explorer API key configured on the server'
        : err instanceof Error
          ? err.message
          : 'Explorer request failed';
    console.warn(`Explorer fetch failed for ${address}, falling back to demo data`, err);
    return {
      transactions: generateMockTransactionsForAddress(address),
      source: 'demo',
      demoReason: reason,
    };
  }
}

export async function fetchTokenTransfers(address: string): Promise<RawTransaction[]> {
  try {
    const data = await explorerRequest('ethereum', {
      module: 'account',
      action: 'tokentx',
      address,
      page: 1,
      offset: 100,
      sort: 'desc',
    });
    if (data.status === '0') return [];
    return (data.result as RawTransaction[]).map((tx) => ({
      ...tx,
      walletLabel: address,
      // `value` here is in the token's own decimals, not wei. See assetResolver.
      isTokenTransfer: true,
    }));
  } catch (err) {
    console.warn('Failed to fetch token transfers', err);
    return [];
  }
}

export async function fetchMultiWalletTransactions(addresses: string[]): Promise<FetchResult> {
  const uniqueAddresses = Array.from(new Set(addresses.map(a => a.toLowerCase())));

  const results = await Promise.all(
    uniqueAddresses.map(async (addr) => {
      let targetAddr = addr;
      if (!isValidEthAddress(addr)) {
        let resolved: string | null = null;
        let reason = `Could not resolve ${addr}. Check the name, or paste a 0x address.`;
        try {
          resolved = await resolveENS(addr);
        } catch (err) {
          if (err instanceof NoServerKeyError) {
            reason = 'No explorer API key configured on the server';
          }
        }
        if (!resolved) {
          // Never hand an unresolved name to the explorer. It answers 400
          // "Invalid value for address", which previously surfaced as a
          // misleading "add an API key" notice.
          return {
            transactions: generateMockTransactionsForAddress(addr),
            result: {
              transactions: [],
              source: 'demo' as const,
              demoReason: reason,
            },
            resolved: addr,
          };
        }
        targetAddr = resolved;
      }

      const [normalResult, tokenTxs] = await Promise.all([
        fetchNormalTransactions(targetAddr),
        fetchTokenTransfers(targetAddr).catch(() => [] as RawTransaction[]),
      ]);

      const txMap = new Map<string, RawTransaction>();
      for (const tx of normalResult.transactions) txMap.set(tx.hash, { ...tx, walletLabel: addr });
      for (const tx of tokenTxs) {
        if (!txMap.has(tx.hash)) txMap.set(tx.hash, { ...tx, walletLabel: addr });
      }

      return { transactions: Array.from(txMap.values()), result: normalResult, resolved: targetAddr };
    })
  );

  // Deduplicate across wallets if multiple wallets participated in same tx
  const finalMap = new Map<string, RawTransaction>();
  for (const tx of results.flatMap(r => r.transactions)) {
    if (!finalMap.has(tx.hash)) {
      finalMap.set(tx.hash, tx);
    }
  }

  // If any wallet fell back to demo data the whole batch is untrustworthy,
  // so report the batch as demo rather than quietly mixing the two.
  const demoResult = results.find(r => r.result.source === 'demo');

  return {
    transactions: Array.from(finalMap.values()).sort(
      (a, b) => parseInt(b.timeStamp) - parseInt(a.timeStamp)
    ),
    source: demoResult ? 'demo' : 'live',
    demoReason: demoResult?.result.demoReason,
    resolvedAddresses: results.map((r) => r.resolved),
  };
}

/**
 * Resolve an ENS name through our own proxy, which reads the ENS registry.
 *
 * This used to call enstate.rs from the browser. When that service started
 * answering 500, resolution returned null, the caller passed the unresolved
 * name straight to the explorer, and the app showed synthetic data blaming a
 * missing API key that was in fact present. One unreliable third party is now
 * off the critical path.
 */
export async function resolveENS(name: string): Promise<string | null> {
  try {
    const data = await explorerRequest('ethereum', {
      module: 'ens',
      action: 'resolve',
      name,
    });
    return typeof data?.address === 'string' ? data.address : null;
  } catch (err) {
    // A missing server key is a different problem from an unresolvable name,
    // and conflating the two is what made the original failure so hard to
    // read. Let the caller tell the user which one actually happened.
    if (err instanceof NoServerKeyError) throw err;
    console.warn(`ENS resolution failed for ${name}`, err);
    return null;
  }
}

export function isValidEthAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

export function isValidEthAddressOrEns(input: string): boolean {
  const isAddress = isValidEthAddress(input);
  const isEns = /^[a-zA-Z0-9-._]+\.eth$/.test(input);
  return isAddress || isEns;
}

export function parseMultipleAddresses(input: string): string[] {
  if (!input) return [];
  return input
    .split(/[\n,;]+/)
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

// Canonical implementation lives in assetResolver — re-exported here so the
// many existing `import { weiToEth } from './etherscan'` call sites keep working.
export { weiToEth } from './assetResolver';

export function formatAddress(address: string): string {
  if (!address) return '—';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
