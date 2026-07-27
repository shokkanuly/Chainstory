// src/services/coingecko.ts
//
// Unthrottled price oracle gateway using DefiLlama + IndexedDB client-side cache
// with legacy CoinGecko fallback.

import { getDefiLlamaHistoricalPrice, getCurrentDefiLlamaPrice } from './defillama';

const BASE_URL = 'https://api.coingecko.com/api/v3';
const priceCache = new Map<string, number>();

const TOKEN_ID_MAP: Record<string, string> = {
  ETH: 'ethereum',
  WETH: 'weth',
  BTC: 'bitcoin',
  WBTC: 'wrapped-bitcoin',
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  LINK: 'chainlink',
  UNI: 'uniswap',
  AAVE: 'aave',
  MATIC: 'matic-network',
  ARB: 'arbitrum',
  OP: 'optimism',
  CRV: 'curve-dao-token',
  LDO: 'lido-dao',
};

function formatDateForCoinGecko(timestamp: string): string {
  const date = new Date(parseInt(timestamp) * 1000);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export async function getHistoricalPrice(
  symbol: string,
  timestamp: string
): Promise<number | null> {
  const upperSymbol = (symbol || 'ETH').toUpperCase();

  // 1. Primary unthrottled path: DefiLlama + Persistent IndexedDB cache
  const defiLlamaPrice = await getDefiLlamaHistoricalPrice(upperSymbol, timestamp);
  if (defiLlamaPrice !== null) {
    return defiLlamaPrice;
  }

  // 2. Secondary fallback path: CoinGecko API
  const coinId = TOKEN_ID_MAP[upperSymbol];
  if (!coinId) return null;

  const dateStr = formatDateForCoinGecko(timestamp);
  const cacheKey = `${coinId}-${dateStr}`;

  if (priceCache.has(cacheKey)) {
    return priceCache.get(cacheKey)!;
  }

  try {
    const url = `${BASE_URL}/coins/${coinId}/history?date=${dateStr}&localization=false`;
    const res = await fetch(url);

    if (!res.ok) return null;

    const data = await res.json();
    const price = data?.market_data?.current_price?.usd ?? null;
    if (price !== null) {
      priceCache.set(cacheKey, price);
    }
    return price;
  } catch (err) {
    console.warn(`CoinGecko fallback error for ${coinId}:`, err);
    return null;
  }
}

export async function getCurrentEthPrice(): Promise<number | null> {
  const defiLlamaPrice = await getCurrentDefiLlamaPrice('ETH');
  if (defiLlamaPrice !== null) return defiLlamaPrice;

  const cacheKey = 'ethereum-current';
  if (priceCache.has(cacheKey)) return priceCache.get(cacheKey)!;

  try {
    const res = await fetch(`${BASE_URL}/simple/price?ids=ethereum&vs_currencies=usd`);
    const data = await res.json();
    const price = data?.ethereum?.usd ?? null;
    if (price !== null) {
      priceCache.set(cacheKey, price);
    }
    return price;
  } catch {
    return null;
  }
}
