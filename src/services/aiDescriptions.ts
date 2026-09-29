// src/services/aiDescriptions.ts
//
// AI descriptions are opt-in (docs/06 §2): off by default, switched on per
// browser, with a preview of exactly what leaves the device. The preview and
// the request are built by the same function, so what the switch shows is
// what is sent.

import type { RawTransaction, TaxCategory } from '../types';
import type { DescribePayload } from './apiClient';
import { getMethodLabel } from './methodRegistry';

const STORAGE_KEY = 'retold-ai-descriptions';

/** Off unless this browser switched it on. Blocked storage (private windows) reads as off. */
export function isAiDescriptionsEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setAiDescriptionsEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, 'on');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nowhere to remember it: the switch lasts for this page only.
  }
}

/** 0x1234…abcd: enough to tell wallets apart in a sentence, not to identify one. */
export function shortAddress(address: string | undefined): string | undefined {
  if (!address) return undefined;
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : undefined;
}

/** Exactly what is sent to /api/describe for one transaction. */
export function buildDescribePayload(
  tx: RawTransaction,
  category: TaxCategory,
  ethValue: number,
  usdValue: number | null
): DescribePayload {
  return {
    from: shortAddress(tx.from),
    to: shortAddress(tx.to),
    category,
    ethValue,
    usdValue,
    methodLabel: getMethodLabel(tx.input) ?? undefined,
    functionName: tx.functionName,
    tokenName: tx.tokenName,
    tokenSymbol: tx.tokenSymbol,
    isError: tx.isError === '1',
  };
}
