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

// ENS resolution lives behind the proxy because the browser-side third-party
// resolver it replaced failed open: when the service 500'd, the unresolved name
// went to the explorer, which rejected it, and the app blamed a missing key.
describe('ENS resolution', () => {
  const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const word = (addr: string) => '0x' + '0'.repeat(24) + addr.slice(2).toLowerCase();
  const ZERO_WORD = '0x' + '0'.repeat(64);

  /** Registry lookup first, then the resolver's addr(). */
  function ensFetch(results: string[]) {
    const calls: string[] = [];
    let i = 0;
    const impl = vi.fn(async (url: string) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ result: results[i++] }) } as any;
    });
    return { impl: impl as unknown as typeof fetch, calls };
  }

  it('reads the registry and returns the resolved address', async () => {
    const { impl, calls } = ensFetch([word('0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41'), word(VITALIK)]);
    const res = await handleExplorer(
      req({ chain: 'ethereum', module: 'ens', action: 'resolve', name: 'vitalik.eth' }),
      ENV,
      'ens-1',
      impl
    );
    expect(res.status).toBe(200);
    expect((res.body as { address: string }).address.toLowerCase()).toBe(VITALIK.toLowerCase());
    // EIP-137 namehash of vitalik.eth, so a bad hash cannot pass silently.
    expect(calls[0]).toContain('ee6c4522aab0003e8d14cd40a6af439055fd2577951148c14b6cea9a53475835');
    expect(calls[0]).toContain('chainid=1');
  });

  it('reports a name with no resolver rather than falling through', async () => {
    const { impl } = ensFetch([ZERO_WORD]);
    const res = await handleExplorer(
      req({ chain: 'ethereum', module: 'ens', action: 'resolve', name: 'nonexistent-xyz.eth' }),
      ENV,
      'ens-2',
      impl
    );
    expect(res.status).toBe(404);
  });

  it('reports a name whose resolver holds no address', async () => {
    const { impl } = ensFetch([word('0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41'), ZERO_WORD]);
    const res = await handleExplorer(
      req({ chain: 'ethereum', module: 'ens', action: 'resolve', name: 'unset.eth' }),
      ENV,
      'ens-3',
      impl
    );
    expect(res.status).toBe(404);
  });

  it.each([
    ['not-an-ens-name', 'vitalik'],
    ['a non-eth TLD', 'vitalik.com'],
    ['a hex address', VITALIK],
    ['unicode, which needs UTS-46 to be safe', 'vitaIik.eth'.replace('I', 'ı')],
    ['an empty name', ''],
  ])('rejects %s', async (_label, name) => {
    const { impl } = ensFetch([]);
    const res = await handleExplorer(
      req({ chain: 'ethereum', module: 'ens', action: 'resolve', name }),
      ENV,
      'ens-4',
      impl
    );
    expect(res.status).toBe(400);
    expect(impl).not.toHaveBeenCalled();
  });

  // The whole point of the allowlist is that the proxy is not a generic RPC.
  it('still refuses a raw eth_call, so ENS did not open a passthrough', async () => {
    const { impl } = ensFetch([]);
    const res = await handleExplorer(
      req({ chain: 'ethereum', module: 'proxy', action: 'eth_call', to: VITALIK, data: '0xdeadbeef' }),
      ENV,
      'ens-5',
      impl
    );
    expect(res.status).toBe(400);
    expect(impl).not.toHaveBeenCalled();
  });
});
