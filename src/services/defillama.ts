// src/services/defillama.ts
//
// DefiLlama Historical Price Oracle — unthrottled, free historical price API.
// Combined with client-side IndexedDB caching to completely replace rate-limited CoinGecko calls.

import { getPriceFromCache, savePriceToCache } from './indexedDbCache';

const DEFILLAMA_BASE_URL = 'https://coins.llama.fi';

// Token symbol to DefiLlama coin ID mapping
const TOKEN_DEFILLAMA_MAP: Record<string, string> = {
  ETH: 'coingecko:ethereum',
  WETH: 'coingecko:weth',
  BTC: 'coingecko:bitcoin',
  WBTC: 'coingecko:wrapped-bitcoin',
  USDC: 'coingecko:usd-coin',
  USDT: 'coingecko:tether',
  DAI: 'coingecko:dai',
  LINK: 'coingecko:chainlink',
  UNI: 'coingecko:uniswap',
  AAVE: 'coingecko:aave',
  MATIC: 'coingecko:matic-network',
  POL: 'coingecko:polygon-ecosystem-token',
  ARB: 'coingecko:arbitrum',
  OP: 'coingecko:optimism',
  CRV: 'coingecko:curve-dao-token',
  LDO: 'coingecko:lido-dao',
};

function timestampToDateStr(timestampSeconds: string | number): string {
  const date = new Date(Number(timestampSeconds) * 1000);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export async function getDefiLlamaHistoricalPrice(
  symbol: string,
  timestampSeconds: string | number
): Promise<number | null> {
  const upperSymbol = (symbol || 'ETH').toUpperCase();

  // Stablecoins — always $1.00 USD
  if (['USDC', 'USDT', 'DAI', 'BUSD', 'FRAX', 'LUSD', 'TUSD'].includes(upperSymbol)) {
    return 1.0;
  }

  const dateStr = timestampToDateStr(timestampSeconds);

  // 1. Check client-side IndexedDB cache first
  const cached = await getPriceFromCache(upperSymbol, dateStr);
  if (cached !== null) {
    return cached;
  }

  const coinId = TOKEN_DEFILLAMA_MAP[upperSymbol] || 'coingecko:ethereum';
  const timestamp = Math.floor(Number(timestampSeconds));

  try {
    const url = `${DEFILLAMA_BASE_URL}/prices/historical/${timestamp}/${coinId}?searchWidth=4h`;
    const res = await fetch(url);

    if (!res.ok) {
      console.warn(`DefiLlama price fetch failed for ${upperSymbol} at ${timestamp}: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const coinData = data?.coins?.[coinId];
    const priceUsd = coinData?.price ?? null;

    if (priceUsd !== null && typeof priceUsd === 'number') {
      // Save to IndexedDB cache
      await savePriceToCache(upperSymbol, dateStr, priceUsd);
      return priceUsd;
    }

    return null;
  } catch (err) {
    console.warn(`DefiLlama oracle error for ${upperSymbol}:`, err);
    return null;
  }
}

export async function getCurrentDefiLlamaPrice(symbol: string = 'ETH'): Promise<number | null> {
  const upperSymbol = symbol.toUpperCase();
  const coinId = TOKEN_DEFILLAMA_MAP[upperSymbol] || 'coingecko:ethereum';

  try {
    const res = await fetch(`${DEFILLAMA_BASE_URL}/prices/current/${coinId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.coins?.[coinId]?.price ?? null;
  } catch {
    return null;
  }
}
