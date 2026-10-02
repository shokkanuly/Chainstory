import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { CctpSourceAdapter, type CctpRpc } from '../cctp.js';
import { FinalityConflictError } from '../finality.js';
import { OperatorStore } from '../store.js';
import { RpcDisagreementError, RpcQuorumUnavailableError, rpcQuorum } from '../rpcQuorum.js';
import { fixture, scope, vault } from './fixtures/cctp.js';

const hash = (byte: string) => `0x${byte.repeat(32)}` as Hex;
const header = (number: bigint, h = hash('ab')) => ({ number, hash: h, parentHash: hash('00'), timestamp: 1_780_000_000n });

/** A provider with a finalized head and a canonical hash per height. */
function provider(opts: { finalized?: bigint; hashAt?: (n: bigint) => Hex; receipt?: unknown; chainId?: number; down?: boolean } = {}) {
  const fail = async () => { throw new Error('offline'); };
  const port: CctpRpc = {
    getChainId: vi.fn(opts.down ? fail : async () => opts.chainId ?? 11155111),
    getTransactionReceipt: vi.fn(opts.down ? fail : async () => opts.receipt ?? null),
    getBlock: vi.fn(opts.down ? fail : async (args: Parameters<CctpRpc['getBlock']>[0]) => 'blockNumber' in args && args.blockNumber !== undefined
      ? header(args.blockNumber, opts.hashAt?.(args.blockNumber))
      : header(opts.finalized ?? 100n, opts.hashAt?.(opts.finalized ?? 100n))),
  };
  return port;
}

describe('RPC quorum configuration', () => {
  it.each([
    ['no providers', 0, 1], ['one-of-two', 2, 1], ['more than configured', 2, 3], ['fractional', 3, 1.5],
  ])('refuses %s', (_name, n, quorum) => {
    expect(() => rpcQuorum(Array.from({ length: n }, () => provider()), { quorum })).toThrow();
  });
  it('allows a single provider for local development', async () => {
    expect(await rpcQuorum([provider()], { quorum: 1 }).getChainId()).toBe(11155111);
  });
});

describe('agreement among independent providers', () => {
  it('answers when a quorum responds and every responder agrees', async () => {
    const rpc = rpcQuorum([provider(), provider(), provider({ down: true })], { quorum: 2 });
    expect(await rpc.getChainId()).toBe(11155111);
    expect(await rpc.getBlock({ blockNumber: 7n })).toMatchObject({ number: 7n });
  });

  it('is unavailable below quorum, never answering from fewer providers', async () => {
    const rpc = rpcQuorum([provider(), provider({ down: true }), provider({ down: true })], { quorum: 2 });
    await expect(rpc.getChainId()).rejects.toBeInstanceOf(RpcQuorumUnavailableError);
  });

  it('treats one dissenting provider as unavailable, even when outvoted', async () => {
    const rpc = rpcQuorum([provider(), provider(), provider({ chainId: 1 })], { quorum: 2 });
    await expect(rpc.getChainId()).rejects.toBeInstanceOf(RpcDisagreementError);
    const forked = rpcQuorum([provider(), provider({ hashAt: () => hash('cd') })], { quorum: 2 });
    await expect(forked.getBlock({ blockNumber: 7n })).rejects.toBeInstanceOf(RpcDisagreementError);
  });

  it('compares the receipt fields a proof depends on, not presentation fields', async () => {
    const f = fixture();
    const decorated = { ...f.sourceReceipt, effectiveGasPrice: 7n, extra: 'provider-specific' };
    const rpc = rpcQuorum([provider({ receipt: f.sourceReceipt }), provider({ receipt: decorated })], { quorum: 2 });
    expect(await rpc.getTransactionReceipt({ hash: hash('aa') })).toMatchObject({ status: 'success' });
    const missing = rpcQuorum([provider({ receipt: f.sourceReceipt }), provider()], { quorum: 2 });
    await expect(missing.getTransactionReceipt({ hash: hash('aa') })).rejects.toBeInstanceOf(RpcDisagreementError);
    const altered = { ...f.sourceReceipt, logs: f.sourceReceipt.logs.map((log, i) => (i === 0 ? { ...log, data: '0x00' } : log)) };
    const lying = rpcQuorum([provider({ receipt: f.sourceReceipt }), provider({ receipt: altered })], { quorum: 2 });
    await expect(lying.getTransactionReceipt({ hash: hash('aa') })).rejects.toBeInstanceOf(RpcDisagreementError);
  });
});

describe('finality across providers', () => {
  it('uses the highest height a quorum has finalized, compared only among providers vouching for it', async () => {
    const lagging = provider({ finalized: 100n, hashAt: () => hash('99') });
    const a = provider({ finalized: 110n }), b = provider({ finalized: 105n });
    const head = await rpcQuorum([lagging, a, b], { quorum: 2 }).getBlock({ blockTag: 'finalized' });
    expect(head).toMatchObject({ number: 105n });
    // The lagging provider has not finalized 105, so its view of 105 is not consulted.
    expect(lagging.getBlock).not.toHaveBeenCalledWith({ blockNumber: 105n });
  });

  it('quarantines when providers vouching for finality disagree on that block', async () => {
    const rpc = rpcQuorum([provider({ finalized: 110n }), provider({ finalized: 110n, hashAt: () => hash('cd') })], { quorum: 2 });
    await expect(rpc.getBlock({ blockTag: 'finalized' })).rejects.toBeInstanceOf(FinalityConflictError);
  });
});

describe('CCTP source verification through independent providers', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => { for (const fn of cleanups.reverse()) fn(); cleanups.length = 0; });
  function store() {
    const dir = mkdtempSync(join(tmpdir(), 'tripwire-rpc-quorum-'));
    const s = new OperatorStore(join(dir, 'operator.sqlite'), scope);
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }), () => s.close());
    return s;
  }
  /** Another operator's view of the same honest chain. */
  const mirror = (port: CctpRpc, receipt?: (args: { hash: Hex }) => Promise<unknown | null>): CctpRpc => ({
    getChainId: () => port.getChainId(), getBlock: (args) => port.getBlock(args),
    getTransactionReceipt: receipt ?? ((args) => port.getTransactionReceipt(args)),
  });

  it('verifies when independent providers agree on the authenticated burn and mint', async () => {
    const f = fixture();
    const source = rpcQuorum([f.source.port, mirror(f.source.port)], { quorum: 2 });
    const destination = rpcQuorum([f.destination.port, mirror(f.destination.port)], { quorum: 2 });
    const adapter = new CctpSourceAdapter(store(), vault, source, destination, async () => f.locator, 'legacy-post-mint');
    expect(await adapter.verify(f.release)).toEqual({ status: 'verified', amount: f.release.amount });
  });

  it('a single lying provider can fabricate backing alone, but only holds the release under a quorum', async () => {
    // The liar serves a burn and mint that never happened; the honest provider has no such transactions.
    const f = fixture();
    const honestSource = mirror(f.source.port, async () => null);
    const honestDestination = mirror(f.destination.port, async () => null);

    const trusting = new CctpSourceAdapter(store(), vault, f.source.port, f.destination.port, async () => f.locator, 'legacy-post-mint');
    expect((await trusting.verify(f.release)).status).toBe('verified');

    const independent = new CctpSourceAdapter(store(), vault,
      rpcQuorum([f.source.port, honestSource], { quorum: 2 }), rpcQuorum([f.destination.port, honestDestination], { quorum: 2 }),
      async () => f.locator, 'legacy-post-mint');
    const evidence = await independent.verify(f.release);
    expect(evidence.status).toBe('unavailable');
  });
});
