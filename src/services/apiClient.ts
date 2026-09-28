// src/services/apiClient.ts
//
// The single path from the browser to any keyed API. Every explorer and Gemini
// request goes through our own origin, where the key is injected server side.
// No API key is reachable from client code any more.
//
// This also consolidates three near-identical call paths that previously lived
// in etherscan.ts, multiChain.ts and contractIntel.ts, each with its own
// slightly different retry behaviour.

import type { ChainId } from '../types';

const API_BASE = '/api';

/** Thrown when the server has no key configured. Callers fall back to demo data. */
export class NoServerKeyError extends Error {
  constructor(message = 'No API key configured on the server') {
    super(message);
    this.name = 'NoServerKeyError';
  }
}

// Explorer free tiers allow ~5 requests/sec. Stay under it.
const MIN_REQUEST_INTERVAL_MS = 250;
let lastRequestTime = 0;

async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ExplorerParams {
  module: string;
  action: string;
  [key: string]: string | number | undefined;
}

/** What explorerRequest reads from a response: a subset of fetch's Response. */
export interface TransportResponse {
  status: number;
  json(): Promise<any>;
}

/** Delivers one explorer query to the key-holding proxy. */
export type ExplorerTransport = (
  chainId: ChainId,
  params: Record<string, string>
) => Promise<TransportResponse>;

/** The default, in the browser: our own origin's /api/explorer, where the key is injected. */
export const httpExplorerTransport: ExplorerTransport = (chainId, params) => {
  const url = new URL(`${API_BASE}/explorer`, window.location.origin);
  url.searchParams.set('chain', chainId);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return fetch(url.toString());
};

let transport: ExplorerTransport = httpExplorerTransport;

/**
 * Route explorer calls somewhere other than HTTP. A Node process — the
 * Tripwire watcher — has no window.location and no /api to call, so it passes
 * server/explorerTransport.ts, which runs the same proxy handler in-process.
 * null restores the HTTP default.
 */
export function setExplorerTransport(next: ExplorerTransport | null): void {
  transport = next ?? httpExplorerTransport;
}

/**
 * Call the explorer proxy with throttling and exponential backoff.
 *
 * Retries on 429 and 5xx, and on the explorer's own in-payload rate-limit
 * notice, which arrives as HTTP 200 with status "0" and is easy to miss.
 */
export async function explorerRequest(
  chainId: ChainId,
  params: ExplorerParams,
  retries = 3,
  baseDelayMs = 1000
): Promise<any> {
  await throttle();

  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query[key] = String(value);
  }

  const res = await transport(chainId, query);

  if (res.status === 503) {
    throw new NoServerKeyError();
  }

  if (res.status === 429 || res.status >= 500) {
    if (retries > 0) {
      const delay = baseDelayMs * Math.pow(2, 3 - retries);
      console.warn(`Explorer proxy returned ${res.status}. Retrying in ${delay}ms.`);
      await sleep(delay);
      return explorerRequest(chainId, params, retries - 1, baseDelayMs);
    }
    throw new Error(`Explorer proxy HTTP ${res.status}`);
  }

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Explorer proxy HTTP ${res.status}`);
  }

  const data = await res.json();

  const notice = String(data.result || data.message || '').toLowerCase();
  const rateLimited =
    data.status === '0' &&
    (notice.includes('rate limit') || notice.includes('notok') || notice.includes('max rate'));

  if (rateLimited && retries > 0) {
    const delay = baseDelayMs * Math.pow(2, 3 - retries);
    console.warn(`Explorer rate-limit payload detected. Retrying in ${delay}ms.`);
    await sleep(delay);
    return explorerRequest(chainId, params, retries - 1, baseDelayMs);
  }

  return data;
}

export interface DescribePayload {
  from?: string;
  to?: string;
  category?: string;
  ethValue?: number;
  usdValue?: number | null;
  methodLabel?: string;
  functionName?: string;
  tokenName?: string;
  tokenSymbol?: string;
  isError?: boolean;
}

/**
 * Ask the server for a plain-English description.
 *
 * Only structured fields go over the wire; the prompt is assembled server side
 * so this endpoint cannot be used as a general-purpose LLM on our key. Returns
 * null whenever generation is unavailable, and the caller uses its
 * deterministic fallback.
 */
export async function describeTransaction(payload: DescribePayload): Promise<string | null> {
  return requestDescription(payload);
}

/**
 * Ask the server to word a "Check before you sign" verdict. Only the badge
 * and reason ids are sent; the server builds the prompt from fixed phrases.
 * Returns null whenever wording is unavailable: the verdict never depends on it.
 */
export async function phraseCheckVerdict(badge: string, reasonIds: string[]): Promise<string | null> {
  return requestDescription({ kind: 'check', badge, reasons: reasonIds });
}

async function requestDescription(body: unknown): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/describe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.description === 'string' && data.description ? data.description : null;
  } catch {
    return null;
  }
}
