// Keyless RPC transports, shared by the signing operator and the keyless audit/observer.
import { fallback, http, type Transport } from 'viem';

/**
 * Several RPC URLs fail over in the order given (MED-3): each endpoint gets one
 * short try per round, then the next; the whole round retries. No background
 * ranking: its timer never stops, so a finished CLI would never exit.
 * Every read that matters is still hash-checked, so endpoints cannot be mixed silently.
 */
export function rpcTransport(urls: readonly string[], fetchOptions?: { signal: AbortSignal }): Transport {
  if (!urls.length) throw new Error('No RPC URL configured.');
  if (urls.length === 1) return http(urls[0], { retryCount: 3, timeout: 30_000, fetchOptions });
  return fallback(urls.map((url) => http(url, { timeout: 10_000, fetchOptions })), { retryCount: 2 });
}

/** Comma-separated RPC URLs from one env value. */
export const rpcUrls = (value: string | undefined, fallbackUrl: string) =>
  (value ?? fallbackUrl).split(',').map((url) => url.trim()).filter(Boolean);
