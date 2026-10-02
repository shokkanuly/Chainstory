import { describe, expect, it, vi } from 'vitest';
import { keccak256, toHex } from 'viem';
import artifact from '../../../src/tripwire/guardian.artifact.js';
import { actors, GuardianVM, LOCAL_CHAIN_ID } from '../../../src/tripwire/guardianVM.js';
import { ResponseTier } from '../../../src/tripwire/onChain.js';
import { scoreTransfer } from '../../../src/tripwire/riskScorer.js';
import { Attestor, type GuardianPort } from '../attest.js';
import { readGuardianProtection } from '../testnet/guardianState.js';

const ROUTE = keccak256(toHex('refresh-route'));
const assessment = (score: number | null) => ({ ...scoreTransfer({
  transfer: { hash: ROUTE, route: 'refresh-route', chain: 'base', token: 'USDC', from: actors.owner.address,
    to: actors.bridge.address, amountUsd: 100, timestamp: 1000 }, baseline: null, recent: [], now: 1000,
  screening: { isFlagged: () => false, describe: () => undefined },
}), score });

async function setup() {
  const vm = await GuardianVM.deploy(artifact);
  await vm.send(actors.owner, 'configureRoute', [ROUTE, 1_000_000n, 3600n]);
  const signer = { ...actors.oracle }; const sign = vi.spyOn(signer, 'signTypedData');
  let nonce = 0n;
  const port: GuardianPort = { address: vm.address, chainId: LOCAL_CHAIN_ID,
    currentTier: (id) => vm.read<ResponseTier>('currentTier', [id]),
    protectionState: async (id) => {
      const r = await vm.read<{ tier: number; tierExpiresAt: bigint; windowSeconds: bigint }>('getRoute', [id]);
      return { tier: r.tier, expiresAt: r.tierExpiresAt, now: vm.now, configured: r.windowSeconds > 0n, oracle: await vm.read('oracle') };
    },
    submitAttestation: vi.fn((a, signature) => vm.send(actors.relayer, 'submitAttestation', [a.routeId, a.riskScore, a.validUntil, a.nonce, signature])),
  };
  const create = (now = () => Number(vm.now)) => new Attestor(signer, port, { now, nextNonce: () => ++nonce });
  return { vm, port, sign, create, attestor: create() };
}

describe('continuous protection refresh', () => {
  it.each([0.65, 0.85, 0.95])('refreshes score %s before expiry, survives restart and avoids duplicate refresh', async (score) => {
    const f = await setup(); expect((await f.attestor.handle(ROUTE, assessment(score))).action).toBe('submitted');
    const original = await f.vm.read<{ tierExpiresAt: bigint; delayUntil: bigint }>('getRoute', [ROUTE]);
    f.vm.warp(86400 - 3601);
    expect((await f.attestor.handle(ROUTE, assessment(score))).action).toBe('skipped');
    f.vm.warp(1);
    const refreshed = await f.create().handle(ROUTE, assessment(score));
    expect(refreshed).toMatchObject({ action: 'submitted', purpose: 'refresh' });
    const next = await f.vm.read<{ tierExpiresAt: bigint; delayUntil: bigint }>('getRoute', [ROUTE]);
    expect(next.tierExpiresAt).toBe(f.vm.now + 86400n); expect(next.delayUntil).toBe(original.delayUntil);
    expect((await f.create().handle(ROUTE, assessment(score))).action).toBe('skipped');
    f.vm.warp(3601); expect(await f.vm.read('currentTier', [ROUTE])).toBe(Math.floor(score * 100) >= 95 ? 3 : score >= 0.85 ? 2 : 1);
    expect(f.port.submitAttestation).toHaveBeenCalledTimes(2);
  });
  it('does not renew a higher active tier from a lower fresh score', async () => {
    const f = await setup(); await f.attestor.handle(ROUTE, assessment(0.95)); f.vm.warp(86400 - 300);
    expect((await f.attestor.handle(ROUTE, assessment(0.85))).action).toBe('skipped');
    expect(f.port.submitAttestation).toHaveBeenCalledTimes(1);
    f.vm.warp(301); expect(await f.vm.read('currentTier', [ROUTE])).toBe(0);
  });
  it.each([null, 0.1, Number.NaN, Number.POSITIVE_INFINITY])('does not refresh from a missing, clear or invalid score %s', async (score) => {
    const f = await setup(); await f.attestor.handle(ROUTE, assessment(0.95)); f.vm.warp(86400 - 100);
    await f.attestor.handle(ROUTE, assessment(score)); expect(f.port.submitAttestation).toHaveBeenCalledTimes(1);
  });
  it('serializes concurrent refreshes against reconciled on-chain state', async () => {
    const f = await setup(); await f.attestor.handle(ROUTE, assessment(0.85)); f.vm.warp(86400 - 1);
    const results = await Promise.all([f.attestor.handle(ROUTE, assessment(0.85)), f.attestor.handle(ROUTE, assessment(0.85))]);
    expect(results.map((r) => r.action).sort()).toEqual(['skipped', 'submitted']); expect(f.port.submitAttestation).toHaveBeenCalledTimes(2);
  });
  it('re-establishes expired protection from current risk after an offline gap', async () => {
    const f = await setup(); await f.attestor.handle(ROUTE, assessment(0.85)); f.vm.warp(86401);
    expect(await f.create().handle(ROUTE, assessment(0.85))).toMatchObject({ action: 'submitted', purpose: 'escalate' });
    expect(await f.vm.read('currentTier', [ROUTE])).toBe(2);
  });
  it('stops before signing when the oracle key has rotated', async () => {
    const f = await setup(); await f.attestor.handle(ROUTE, assessment(0.85)); f.sign.mockClear();
    await f.vm.send(actors.owner, 'setOracle', [actors.owner.address]); f.vm.warp(86400 - 1);
    expect((await f.attestor.handle(ROUTE, assessment(0.85))).action).toBe('unavailable'); expect(f.sign).not.toHaveBeenCalled();
  });
  it('uses the bound chain clock even when the caller clock is incorrect', async () => {
    const f = await setup(); const result = await f.create(() => 1).handle(ROUTE, assessment(0.85));
    expect(result).toMatchObject({ action: 'submitted', attestation: { validUntil: f.vm.now + 300n } });
  });
  it.each(['malformed', 'offline', 'unconfigured'])('holds protection work for %s state, without signing', async (kind) => {
    const f = await setup();
    f.port.protectionState = async () => {
      if (kind === 'offline') throw new Error('RPC unavailable');
      return kind === 'malformed' ? { tier: 99 } : { tier: 0, expiresAt: 0n, now: f.vm.now, oracle: actors.oracle.address, configured: false };
    };
    expect((await f.attestor.handle(ROUTE, assessment(0.85))).action).toBe('unavailable'); expect(f.sign).not.toHaveBeenCalled();
  });
  it('does not fall back to a legacy tier read when the protection snapshot fails', async () => {
    const f = await setup(); const current = vi.spyOn(f.port, 'currentTier'); f.port.protectionState = async () => { throw new Error('snapshot'); };
    await f.attestor.handle(ROUTE, assessment(0.85)); expect(current).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled();
  });
  it('validates refresh buffer and signature lifetime before creating a signer', async () => {
    const f = await setup();
    for (const opts of [{ ttlSeconds: 601 }, { ttlSeconds: 0 }, { refreshBeforeSeconds: -1 }, { refreshBeforeSeconds: 86400 }]) {
      expect(() => new Attestor(actors.oracle, f.port, { now: () => 1000, ...opts })).toThrow();
    }
  });
});

describe('guardian RPC protection snapshot', () => {
  const hash = toHex(1, { size: 32 });
  function reader() {
    return { getBlock: vi.fn(async (_args: { blockTag: 'latest' } | { blockNumber: bigint }) => ({ number: 100n, hash,
      parentHash: toHex(0, { size: 32 }), timestamp: 10_000n })),
      readRoute: vi.fn(async (_block: bigint) => ({ tier: 2, tierExpiresAt: 11_000n, windowSeconds: 3600n })),
      readOracle: vi.fn(async (_block: bigint) => actors.oracle.address), minimumBlock: () => 0n };
  }
  it('reads all state at one hash-checked block and uses its clock', async () => {
    const r = reader(); expect(await readGuardianProtection(r)).toMatchObject({ tier: 2, expiresAt: 11_000n, now: 10_000n, configured: true });
    expect(r.readRoute).toHaveBeenCalledWith(100n); expect(r.readOracle).toHaveBeenCalledWith(100n);
  });
  it.each(['hash', 'number', 'time', 'route', 'oracle', 'lag'])('refuses inconsistent or unavailable %s', async (kind) => {
    const r = reader();
    if (kind === 'hash') r.getBlock.mockResolvedValueOnce({ number: 100n, hash: toHex(2, { size: 32 }), parentHash: hash, timestamp: 10_000n });
    if (kind === 'number') r.getBlock.mockResolvedValueOnce({ number: 101n, hash, parentHash: hash, timestamp: 10_000n });
    if (kind === 'time') r.getBlock.mockResolvedValueOnce({ number: 100n, hash, parentHash: hash, timestamp: -1n });
    if (kind === 'route') r.readRoute.mockResolvedValueOnce({ tier: 99, tierExpiresAt: 11_000n, windowSeconds: 3600n });
    if (kind === 'oracle') r.readOracle.mockResolvedValueOnce('0x00');
    if (kind === 'lag') r.minimumBlock = () => 101n;
    await expect(readGuardianProtection(r)).rejects.toThrow();
  });
});
