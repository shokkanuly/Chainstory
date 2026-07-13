// src/services/coingecko.ts

const BASE_URL = 'https://api.coingecko.com/api/v3';

// Cache to avoid redundant calls
const priceCache = new Map<string, number>();

// Symbol to CoinGecko ID mapping (common tokens)
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
  SNX: 'havven',
  MKR: 'maker',
  COMP: 'compound-governance-token',
  SUSHI: 'sushi',
  '1INCH': '1inch',
  LDO: 'lido-dao',
  RPL: 'rocket-pool',
  STETH: 'staked-ether',
  FTM: 'fantom',
  SHIB: 'shiba-inu',
  APE: 'apecoin',
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
  const upperSymbol = upperSymbolOrBlank(symbol);

  // Stablecoins — always $1
  if (['USDC', 'USDT', 'DAI', 'BUSD', 'FRAX', 'LUSD', 'TUSD'].includes(upperSymbol)) {
    return 1.0;
  }

  const coinId = TOKEN_ID_MAP[upperSymbol];
  if (!coinId) {
    return null; // Unknown token — return null to flag unavailable
  }

  const dateStr = formatDateForCoinGecko(timestamp);
  const cacheKey = `${coinId}-${dateStr}`;

  if (priceCache.has(cacheKey)) {
    return priceCache.get(cacheKey)!;
  }

  try {
    const url = `${BASE_URL}/coins/${coinId}/history?date=${dateStr}&localization=false`;
    const res = await fetch(url);

    if (!res.ok) {
      console.warn(`CoinGecko price fetch failed for ${coinId} on ${dateStr}: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const price = data?.market_data?.current_price?.usd ?? null;
    if (price !== null) {
      priceCache.set(cacheKey, price);
    }
    return price;
  } catch (err) {
    console.warn(`CoinGecko error for ${coinId}:`, err);
    return null;
  }
}

export async function getCurrentEthPrice(): Promise<number | null> {
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

function upperSymbolOrBlank(symbol: string): string {
  return (symbol || '').toUpperCase();
}
