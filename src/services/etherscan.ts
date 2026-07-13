// src/services/etherscan.ts
import type { RawTransaction } from '../types';

const BASE_URL = 'https://api.etherscan.io/api';

function getApiKey(): string {
  const key = import.meta.env.VITE_ETHERSCAN_API_KEY;
  if (!key || key === 'your_etherscan_api_key_here') {
    throw new Error('VITE_ETHERSCAN_API_KEY is not set. Please add it to your .env file.');
  }
  return key;
}

// Fetch helper with rate-limit retry (1-second backoff, 1 retry)
async function fetchWithRetry(url: string, retries = 1): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Etherscan API error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();

  // Etherscan standard rate-limiting return signature check
  if (data.status === '0' && data.result && String(data.result).toLowerCase().includes('rate limit')) {
    if (retries > 0) {
      console.warn("Etherscan rate limited, retrying in 1s...");
      await new Promise(resolve => setTimeout(resolve, 1000));
      return fetchWithRetry(url, retries - 1);
    } else {
      throw new Error("Etherscan is rate-limiting requests right now. Try again in a moment.");
    }
  }
  return data;
}

export async function fetchNormalTransactions(address: string): Promise<RawTransaction[]> {
  const apiKey = getApiKey();
  const url = new URL(BASE_URL);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'txlist');
  url.searchParams.set('address', address);
  url.searchParams.set('startblock', '0');
  url.searchParams.set('endblock', '99999999');
  url.searchParams.set('page', '1');
  url.searchParams.set('offset', '100'); // Limit to 100 most recent
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('apikey', apiKey);

  const data = await fetchWithRetry(url.toString());

  if (data.status === '0') {
    if (data.message === 'No transactions found') {
      return [];
    }
    throw new Error(`Etherscan: ${data.message || data.result}`);
  }

  return data.result as RawTransaction[];
}

export async function fetchTokenTransfers(address: string): Promise<RawTransaction[]> {
  const apiKey = getApiKey();
  const url = new URL(BASE_URL);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'tokentx');
  url.searchParams.set('address', address);
  url.searchParams.set('page', '1');
  url.searchParams.set('offset', '100'); // Increase from 50 to match the 100 limit
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('apikey', apiKey);

  try {
    const data = await fetchWithRetry(url.toString());
    if (data.status === '0') return [];

    return (data.result as RawTransaction[]).map(tx => ({
      ...tx,
      _isTokenTransfer: true,
    } as RawTransaction));
  } catch (err) {
    console.warn("Failed to fetch token transfers", err);
    return [];
  }
}

export async function resolveENS(name: string): Promise<string | null> {
  try {
    const res = await fetch(`https://enstate.rs/n/${name}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.address || null;
  } catch (err) {
    console.error("ENS resolution failed", err);
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

export function weiToEth(wei: string): number {
  return parseFloat(wei) / 1e18;
}

export function formatAddress(address: string): string {
  if (!address) return '—';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
