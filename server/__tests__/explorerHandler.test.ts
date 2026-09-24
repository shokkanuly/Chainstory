// The proxy holds the only copy of the API key, so its allowlist is a security
// boundary. These tests pin that boundary.

import { describe, expect, it, vi } from 'vitest';
import { handleExplorer, resolveKey } from '../explorerHandler.js';

const ADDR = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const ENV = { ETHERSCAN_API_KEY: 'test-key-123' };

function req(query: Record<string, string>, method = 'GET') {
  return { method, query };
}

/** Records the upstream URL so we can assert what would be forwarded. */
function spyFetch(payload: unknown = { status: '1', result: [] }) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => payload } as any;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('explorer proxy allowlist', () => {
  it('forwards a permitted request with the key injected server side', async () => {
    const { impl, calls } = spyFetch();
    const res = await handleExplorer(
      req({ chain: 'ethereum', module: 'account', action: 'txlist', address: ADDR, offset: '100', sort: 'desc' }),
      ENV,
      'ip-1',
      impl
    );
    expect(res.status).toBe(200);
    expect(calls[0]).toContain('apikey=test-key-123');
    expect(calls[0]).toContain(`address=${ADDR}`);
  });

  // The deprecated V1 per-chain domains answer HTTP 200 with a NOTOK body, so a
  // regression here would look like "no transactions" rather than an error.
  it.each([
    ['ethereum', '1'],
    ['optimism', '10'],
    ['polygon', '137'],
    ['base', '8453'],
    ['arbitrum', '42161'],
  ])('routes %s to the V2 endpoint with chainid %s', async (chain, id) => {
    const { impl, calls } = spyFetch();
    await handleExplorer(
      req({ chain, module: 'account', action: 'txlist', address: ADDR }),
      ENV, `ip-v2-${chain}`, impl
    );
    const url = new URL(calls[0]);
    expect(url.host).toBe('api.etherscan.io');
    expect(url.pathname).toBe('/v2/api');
    expect(url.searchParams.get('chainid')).toBe(id);
  });

  it('never calls a deprecated V1 per-chain domain', async () => {
    const { impl, calls } = spyFetch();
    for (const chain of ['ethereum', 'arbitrum', 'base', 'optimism', 'polygon']) {
      await handleExplorer(
        req({ chain, module: 'account', action: 'txlist', address: ADDR }),
        ENV, `ip-dep-${chain}`, impl
      );
    }
    const dead = ['arbiscan.io', 'basescan.org', 'polygonscan.com', 'api-optimistic.etherscan.io'];
    for (const url of calls) {
      for (const host of dead) expect(url).not.toContain(host);
    }
  });

  it.each([
    ['account', 'balance'],
    ['stats', 'ethprice'],
    ['account', 'tokenbalance'],
    ['gastracker', 'gasoracle'],
  ])('rejects unlisted action %s:%s', async (module, action) => {
    const { impl } = spyFetch();
    const res = await handleExplorer(req({ chain: 'ethereum', module, action, address: ADDR }), ENV, 'ip-2', impl);
    expect(res.status).toBe(400);
    expect(impl).not.toHaveBeenCalled();
  });

  it('rejects an unknown chain', async () => {
    const { impl } = spyFetch();
    const res = await handleExplorer(
      req({ chain: 'bitcoin', module: 'account', action: 'txlist', address: ADDR }),
      ENV, 'ip-3', impl
    );
    expect(res.status).toBe(400);
    expect(impl).not.toHaveBeenCalled();
  });

  it.each([
    ['address', 'not-an-address'],
    ['address', '0x123'],
    ['sort', '../../etc/passwd'],
    ['offset', '100000'],
    ['page', '-1'],
  ])('rejects invalid %s', async (param, value) => {
    const { impl } = spyFetch();
    const res = await handleExplorer(
      req({ chain: 'ethereum', module: 'account', action: 'txlist', address: ADDR, [param]: value }),
      ENV, 'ip-4', impl
    );
    expect(res.status).toBe(400);
    expect(impl).not.toHaveBeenCalled();
  });

  it('rejects an invalid tag on the action that accepts one', async () => {
    // `tag` only belongs to proxy:eth_getCode, and only 'latest' is allowed.
    const { impl } = spyFetch();
    const res = await handleExplorer(
      req({ chain: 'ethereum', module: 'proxy', action: 'eth_getCode', address: ADDR, tag: 'earliest' }),
      ENV, 'ip-tag', impl
    );
    expect(res.status).toBe(400);
    expect(impl).not.toHaveBeenCalled();
  });

  it('drops parameters that are not on the action allowlist', async () => {
    const { impl, calls } = spyFetch();
    // getsourcecode permits `address` only; `offset` must not survive.
    await handleExplorer(
      req({ chain: 'ethereum', module: 'contract', action: 'getsourcecode', address: ADDR, offset: '50' }),
      ENV, 'ip-5', impl
    );
    expect(calls[0]).not.toContain('offset');
  });

  it('rejects non-GET', async () => {
    const { impl } = spyFetch();
    const res = await handleExplorer(
      req({ chain: 'ethereum', module: 'account', action: 'txlist', address: ADDR }, 'POST'),
      ENV, 'ip-6', impl
    );
    expect(res.status).toBe(405);
  });

  it('validates input before consulting configuration', async () => {
    // A bad request is a 400 whether or not a key exists, so validation cannot
    // be masked by a missing key in one environment and not another.
    const { impl } = spyFetch();
    const res = await handleExplorer(
      req({ chain: 'ethereum', module: 'account', action: 'txlist', address: 'bad' }),
      {}, 'ip-7', impl
    );
    expect(res.status).toBe(400);
  });

  it('returns 503 with no key so the client shows labelled demo data', async () => {
    const { impl } = spyFetch();
    const res = await handleExplorer(
      req({ chain: 'ethereum', module: 'account', action: 'txlist', address: ADDR }),
      {}, 'ip-8', impl
    );
    expect(res.status).toBe(503);
    expect(impl).not.toHaveBeenCalled();
  });

  it('never leaks the key in a response body', async () => {
    const { impl } = spyFetch();
    const res = await handleExplorer(
      req({ chain: 'ethereum', module: 'account', action: 'balance', address: ADDR }),
      ENV, 'ip-9', impl
    );
    expect(JSON.stringify(res.body)).not.toContain('test-key-123');
  });

  it('rate limits a single IP', async () => {
    const { impl } = spyFetch();
    const q = { chain: 'ethereum', module: 'account', action: 'txlist', address: ADDR };
    let limited = 0;
    for (let i = 0; i < 70; i++) {
      const res = await handleExplorer(req(q), ENV, 'ip-flood', impl);
      if (res.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });
});

describe('resolveKey', () => {
  it('uses one key across every chain, as V2 allows', () => {
    const env = { ETHERSCAN_API_KEY: 'shared' };
    for (const c of ['ethereum', 'arbitrum', 'base', 'optimism', 'polygon'] as const) {
      expect(resolveKey(c, env)).toBe('shared');
    }
  });

  it('prefers a chain-specific key', () => {
    expect(resolveKey('base', { ETHERSCAN_API_KEY: 'shared', BASESCAN_API_KEY: 'base-key' })).toBe('base-key');
  });

  it('treats a placeholder value as unset', () => {
    expect(resolveKey('ethereum', { ETHERSCAN_API_KEY: 'your_etherscan_api_key_here' })).toBeNull();
    expect(resolveKey('ethereum', { ETHERSCAN_API_KEY: '   ' })).toBeNull();
  });
});
