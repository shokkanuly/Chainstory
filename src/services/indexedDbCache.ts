// src/services/indexedDbCache.ts
//
// Persistent browser-side IndexedDB caching layer for historical crypto prices.
// Completely eliminates redundant network queries and prevents rate limits (429s).

const DB_NAME = 'chainstory_db';
const DB_VERSION = 1;
const STORE_NAME = 'historical_prices';

export interface CachedPriceRecord {
  key: string;       // e.g. "ETH_2026-03-15"
  symbol: string;
  dateStr: string;   // YYYY-MM-DD
  priceUsd: number;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

export async function getPriceFromCache(symbol: string, dateStr: string): Promise<number | null> {
  const upperSymbol = symbol.toUpperCase();
  const key = `${upperSymbol}_${dateStr}`;

  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        const result = request.result as CachedPriceRecord | undefined;
        if (result && typeof result.priceUsd === 'number') {
          resolve(result.priceUsd);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('IndexedDB cache read error:', err);
    return null;
  }
}

export async function savePriceToCache(symbol: string, dateStr: string, priceUsd: number): Promise<void> {
  const upperSymbol = symbol.toUpperCase();
  const key = `${upperSymbol}_${dateStr}`;

  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const record: CachedPriceRecord = {
      key,
      symbol: upperSymbol,
      dateStr,
      priceUsd,
      updatedAt: Date.now(),
    };

    store.put(record);
  } catch (err) {
    console.warn('IndexedDB cache write error:', err);
  }
}
