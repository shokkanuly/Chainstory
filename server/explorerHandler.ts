// server/explorerHandler.ts
//
// Server-side proxy for the Etherscan-family explorer APIs.
//
// Why this exists: Vite inlines every VITE_* variable into the client bundle,
// so an explorer key shipped that way is readable by anyone who opens devtools
// on a deployed build. The key now lives only here, and the browser talks to
// our own origin.
//
// This is deliberately NOT a generic passthrough. An open proxy would let
// anyone burn our rate limit on arbitrary calls, so only the exact
// module/action pairs the app actually uses are allowed, each with its own
// parameter allowlist, and every value is validated before it is forwarded.
//
// Etherscan API V2. The per-chain domains (arbiscan.io, basescan.org, ...) were
// V1 and are now deprecated: they answer HTTP 200 with a NOTOK body telling you
// to migrate, which is easy to mistake for a working call returning no data.
// V2 is one host plus a numeric `chainid`, and a single key covers every chain.

import { keccak_256 } from '@noble/hashes/sha3.js';

export type ChainId = 'ethereum' | 'arbitrum' | 'base' | 'optimism' | 'polygon';

const V2_BASE = 'https://api.etherscan.io/v2/api';

/** Numeric chain ids, from https://api.etherscan.io/v2/chainlist */
const CHAIN_IDS: Record<ChainId, number> = {
  ethereum: 1,
  optimism: 10,
  polygon: 137,
  base: 8453,
  arbitrum: 42161,
};

/** module:action -> the query parameters that may accompany it. */
const ALLOWED: Record<string, readonly string[]> = {
  'account:txlist': ['address', 'startblock', 'endblock', 'page', 'offset', 'sort'],
  'account:tokentx': ['address', 'startblock', 'endblock', 'page', 'offset', 'sort'],
  'account:txlistinternal': ['address', 'page', 'offset', 'sort'],
  'contract:getsourcecode': ['address'],
  'contract:getcontractcreation': ['contractaddresses'],
  'proxy:eth_getCode': ['address', 'tag'],
  'proxy:eth_getTransactionByHash': ['txhash'],
  'block:getblockreward': ['blockno'],
};

// --- ENS ---------------------------------------------------------------
//
// Resolved here rather than in the browser. The previous client-side path
// called a third-party resolver (enstate.rs) directly; when that service went
// down it returned null, the unresolved name was passed to the explorer
// anyway, and the app quietly served synthetic data blaming a missing API key.
// Reading the registry ourselves removes that dependency entirely — it is the
// same Etherscan key and the same proxy that already work for hex addresses.
//
// The registry is immutable, so these two calls cannot rot.
const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const SEL_RESOLVER = '0x0178b8bf'; // resolver(bytes32)
const SEL_ADDR = '0x3b3b57de';     // addr(bytes32)

// Deliberately narrow: lowercase ASCII labels only. Full ENS allows unicode
// under UTS-46, and normalising that correctly needs a dedicated library —
// getting it wrong would resolve a homograph to the wrong wallet, which in a
// tax and risk product is worse than refusing to answer.
const IS_ENS_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/;

/** EIP-137 namehash. */
export function namehash(name: string): string {
  let node = new Uint8Array(32);
  for (const label of name.split('.').reverse()) {
    const labelHash = keccak_256(new TextEncoder().encode(label));
    const combined = new Uint8Array(64);
    combined.set(node, 0);
    combined.set(labelHash, 32);
    node = keccak_256(combined);
  }
  return '0x' + Array.from(node, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Pull the address out of a 32-byte ABI word. Returns null for the zero address. */
function decodeAddressWord(word: unknown): string | null {
  if (typeof word !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(word)) return null;
  const addr = '0x' + word.slice(-40);
  return /^0x0{40}$/.test(addr) ? null : addr;
}

const IS_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const IS_TXHASH = /^0x[0-9a-fA-F]{64}$/;
const IS_DIGITS = /^\d{1,12}$/;

function validateParam(name: string, value: string): boolean {
  switch (name) {
    case 'address':
      return IS_ADDRESS.test(value);
    case 'contractaddresses':
      // The app only ever asks about one contract at a time.
      return IS_ADDRESS.test(value);
    case 'txhash':
      return IS_TXHASH.test(value);
    case 'startblock':
    case 'endblock':
    case 'page':
    case 'blockno':
      return IS_DIGITS.test(value);
    case 'offset':
      // Cap the page size so one request cannot pull an unbounded history.
      return IS_DIGITS.test(value) && Number(value) > 0 && Number(value) <= 200;
    case 'sort':
      return value === 'asc' || value === 'desc';
    case 'tag':
      return value === 'latest';
    default:
      return false;
  }
}

export interface HandlerRequest {
  method: string;
  query: Record<string, string | string[] | undefined>;
}

export interface HandlerResponse {
  status: number;
  body: unknown;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Simple fixed-window limiter, per IP. In-memory, so it resets when a
 * serverless instance recycles and is not shared across instances. That is
 * enough to stop casual scraping; it is not a defence against a determined
 * attacker, which would need a shared store.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(ip: string, now = Date.now()): boolean {
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_PER_WINDOW) return false;
  entry.count += 1;
  return true;
}

/** Drop expired buckets so a long-lived instance does not grow unbounded. */
function sweep(now = Date.now()): void {
  if (hits.size < 5000) return;
  for (const [ip, entry] of hits) {
    if (now > entry.resetAt) hits.delete(ip);
  }
}

/**
 * Under V2 a single Etherscan key covers every supported chain, so the old
 * per-chain variables are no longer needed. They are still honoured as an
 * override for anyone who has separate keys provisioned.
 */
export function resolveKey(
  chainId: ChainId,
  env: Record<string, string | undefined>
): string | null {
  const legacyVar: Record<ChainId, string> = {
    ethereum: 'ETHERSCAN_API_KEY',
    arbitrum: 'ARBISCAN_API_KEY',
    base: 'BASESCAN_API_KEY',
    optimism: 'OPTIMISM_API_KEY',
    polygon: 'POLYGONSCAN_API_KEY',
  };
  const key = env[legacyVar[chainId]] || env.ETHERSCAN_API_KEY;
  if (!key || key.trim() === '' || key.includes('your_')) return null;
  return key.trim();
}

/**
 * Resolve an ENS name to an address by reading the registry.
 *
 * Exposed as its own action rather than by allowing `proxy:eth_call`, because
 * a general eth_call would turn this proxy into exactly the open passthrough
 * the parameter allowlist exists to prevent. The client never supplies `to`
 * or `data`; both are built here.
 */
async function handleEnsResolve(
  name: string,
  apiKey: string,
  fetchImpl: typeof fetch
): Promise<HandlerResponse> {
  const node = namehash(name);

  const ethCall = async (to: string, data: string): Promise<unknown> => {
    const url = new URL(V2_BASE);
    url.searchParams.set('chainid', '1'); // ENS is mainnet-only.
    url.searchParams.set('module', 'proxy');
    url.searchParams.set('action', 'eth_call');
    url.searchParams.set('to', to);
    url.searchParams.set('data', data);
    url.searchParams.set('tag', 'latest');
    url.searchParams.set('apikey', apiKey);
    const upstream = await fetchImpl(url.toString());
    const payload = await upstream.json();
    return (payload as { result?: unknown }).result;
  };

  try {
    const resolver = decodeAddressWord(await ethCall(ENS_REGISTRY, SEL_RESOLVER + node.slice(2)));
    if (!resolver) {
      return { status: 404, body: { error: `No resolver is set for ${name}` } };
    }

    const address = decodeAddressWord(await ethCall(resolver, SEL_ADDR + node.slice(2)));
    if (!address) {
      return { status: 404, body: { error: `${name} does not resolve to an address` } };
    }

    return { status: 200, body: { name, address } };
  } catch (err) {
    console.error('ENS resolution failed', err);
    return { status: 502, body: { error: 'ENS resolution failed' } };
  }
}

export async function handleExplorer(
  req: HandlerRequest,
  env: Record<string, string | undefined>,
  clientIp: string,
  fetchImpl: typeof fetch = fetch
): Promise<HandlerResponse> {
  if (req.method !== 'GET') {
    return { status: 405, body: { error: 'Method not allowed' } };
  }

  sweep();
  if (!rateLimit(clientIp)) {
    return { status: 429, body: { error: 'Rate limit exceeded. Try again shortly.' } };
  }

  const chainId = first(req.query.chain) as ChainId | undefined;
  if (!chainId || !(chainId in CHAIN_IDS)) {
    return { status: 400, body: { error: 'Unknown or missing chain' } };
  }

  const module = first(req.query.module);
  const action = first(req.query.action);

  if (module === 'ens' && action === 'resolve') {
    const raw = first(req.query.name);
    const name = raw?.trim().toLowerCase();
    if (!name || !IS_ENS_NAME.test(name)) {
      return { status: 400, body: { error: 'Invalid value for name' } };
    }
    const ensKey = resolveKey('ethereum', env);
    if (!ensKey) {
      return { status: 503, body: { error: 'No explorer API key configured on the server' } };
    }
    return handleEnsResolve(name, ensKey, fetchImpl);
  }

  const allowedParams = ALLOWED[`${module}:${action}`];
  if (!allowedParams) {
    return { status: 400, body: { error: 'This module/action pair is not permitted' } };
  }

  // Validate every parameter before looking at configuration, so malformed
  // input is rejected identically whether or not a key happens to be set.
  const url = new URL(V2_BASE);
  url.searchParams.set('chainid', String(CHAIN_IDS[chainId]));
  url.searchParams.set('module', module!);
  url.searchParams.set('action', action!);

  for (const name of allowedParams) {
    const value = first(req.query[name]);
    if (value === undefined) continue;
    if (!validateParam(name, value)) {
      return { status: 400, body: { error: `Invalid value for ${name}` } };
    }
    url.searchParams.set(name, value);
  }

  const apiKey = resolveKey(chainId, env);
  if (!apiKey) {
    // The client turns this into its labelled demo-data path.
    return { status: 503, body: { error: 'No explorer API key configured on the server' } };
  }

  url.searchParams.set('apikey', apiKey);

  try {
    const upstream = await fetchImpl(url.toString());
    const data = await upstream.json();
    return { status: upstream.ok ? 200 : upstream.status, body: data };
  } catch (err) {
    console.error('Explorer upstream failed', err);
    return { status: 502, body: { error: 'Explorer request failed' } };
  }
}
