// src/services/watchlistStore.ts
//
// Persistent Watchlist Manager for saving, labeling, and quick-loading crypto wallets.

import type { ChainId } from '../types';

export interface WatchlistItem {
  id: string;
  address: string;
  label: string;
  chainId: ChainId;
  addedAt: number;
  tags?: string[];
}

const STORAGE_KEY = 'chainstory_watchlist_v1';

const DEFAULT_WATCHLIST: WatchlistItem[] = [
  {
    id: 'vitalik_eth',
    address: '0xd8DA6BF26964aF9Ded7ede3308C4157ed3714123',
    label: 'vitalik.eth (Ethereum Founder)',
    chainId: 'ethereum',
    addedAt: Date.now(),
    tags: ['Public Figure', 'Whale'],
  },
  {
    id: 'binance_hot',
    address: '0x28C6c06298d514Db089934071355E5743bf21d60',
    label: 'Binance 14 (Hot Wallet)',
    chainId: 'ethereum',
    addedAt: Date.now(),
    tags: ['Exchange', 'CEX'],
  },
  {
    id: 'uniswap_treasury',
    address: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
    label: 'Uniswap Governance Treasury',
    chainId: 'ethereum',
    addedAt: Date.now(),
    tags: ['DeFi', 'DAO'],
  },
];

export function getWatchlist(): WatchlistItem[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_WATCHLIST;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_WATCHLIST));
      return DEFAULT_WATCHLIST;
    }
    return JSON.parse(raw);
  } catch (err) {
    console.warn('Failed to read watchlist from localStorage:', err);
    return DEFAULT_WATCHLIST;
  }
}

export function saveWatchlist(items: WatchlistItem[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (err) {
    console.warn('Failed to save watchlist to localStorage:', err);
  }
}

export function addWatchlistItem(item: Omit<WatchlistItem, 'id' | 'addedAt'>): WatchlistItem[] {
  const current = getWatchlist();
  const exists = current.some((w) => w.address.toLowerCase() === item.address.toLowerCase());
  
  if (exists) return current;

  const newItem: WatchlistItem = {
    ...item,
    id: `w_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    addedAt: Date.now(),
  };

  const updated = [newItem, ...current];
  saveWatchlist(updated);
  return updated;
}

export function removeWatchlistItem(id: string): WatchlistItem[] {
  const current = getWatchlist();
  const updated = current.filter((w) => w.id !== id);
  saveWatchlist(updated);
  return updated;
}
