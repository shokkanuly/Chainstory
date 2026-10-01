import { describe, expect, it, vi } from 'vitest';
import { toHex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { assertProtectionPolicy } from '../testnet/protectionPolicy.js';
import { readReleasePolicyState } from '../testnet/releaseState.js';
import { createRpcOperator } from '../testnet/operator.js';
import { runTestnetDemo, type Clients, type Deployment, type TestnetConfig } from '../testnet/sepolia.js';

describe('route protection deployment boundary', () => {
  const reader = () => ({ guardianVersion: async (): Promise<unknown> => 3n,
    releaseVersion: async (): Promise<unknown> => 3n, routePermission: async (): Promise<unknown> => true });
  it('accepts the current policy and route-scoped permission', async () => {
    await expect(assertProtectionPolicy(reader())).resolves.toBeUndefined();
  });
  it.each(['old guardian', 'old vault', 'single-key-only guardian', 'single-key-only vault', 'revoked route', 'unknown response', 'RPC error'])('refuses %s', async (kind) => {
    const r = reader();
    if (kind === 'old guardian') r.guardianVersion = async () => 1n;
    if (kind === 'old vault') r.releaseVersion = async () => 1n;
    if (kind === 'single-key-only guardian') r.guardianVersion = async () => 2n;
    if (kind === 'single-key-only vault') r.releaseVersion = async () => 2n;
    if (kind === 'revoked route') r.routePermission = async () => false;
    if (kind === 'unknown response') r.guardianVersion = async () => '3';
    if (kind === 'RPC error') r.routePermission = async () => { throw new Error('offline'); };
    await expect(assertProtectionPolicy(r)).rejects.toThrow();
  });
  it.each(['guardian', 'vault', 'permission', 'busy'])('refuses demo %s before reset or payout transactions', async (kind) => {
    const writeContract = vi.fn();
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'GUARDIAN_POLICY_VERSION') return kind === 'guardian' ? 2n : 3n;
      if (functionName === 'RELEASE_POLICY_VERSION') return kind === 'vault' ? 2n : 3n;
      if (functionName === 'isProtected') return kind !== 'permission';
      if (functionName === 'rollingUsage') return 1n;
      return 600n;
    });
    const clients = { pub: { readContract }, wallet: { writeContract } } as unknown as Clients;
    const contract = { address: actors.bridge.address };
    const d = { contracts: { TripwireGuardian: contract, ProtectedVault: contract, MockSourceBridge: contract, DrainProxy: contract } } as unknown as Deployment;
    await expect(runTestnetDemo({} as TestnetConfig, clients, d, { contractFacts: async () => null })).rejects.toThrow();
    expect(writeContract).not.toHaveBeenCalled();
  });
  it('refuses the durable operator policy before opening a journal or signing', async () => {
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => functionName === 'MAX_REVIEW_TTL' ? 600n : 1n);
    const writeContract = vi.fn(), signTransaction = vi.fn();
    const c = { chainId: 11155111, pub: { readContract }, wallet: { writeContract, signTransaction } } as unknown as Clients;
    const contract = { address: actors.bridge.address };
    const d = { chainId: 11155111, startBlock: '0', contracts: { ProtectedVault: contract, TripwireGuardian: contract,
      DemoUSDC: contract, MockSourceBridge: contract } } as unknown as Deployment;
    await expect(createRpcOperator({ account: actors.oracle } as TestnetConfig, c, d,
      '/path-that-does-not-exist/route-policy.sqlite', { baseline: null })).rejects.toThrow();
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'GUARDIAN_POLICY_VERSION' }));
    expect(writeContract).not.toHaveBeenCalled(); expect(signTransaction).not.toHaveBeenCalled();
  });
});

describe('request delay RPC boundary', () => {
  const hash = toHex(1, { size: 32 });
  const reader = () => ({ getBlock: vi.fn(async (_args: { blockTag: 'latest' } | { blockNumber: bigint }) => ({
    number: 100n, hash, parentHash: toHex(0, { size: 32 }), timestamp: 1000n })),
    readRelease: vi.fn(async (_block: bigint): Promise<unknown> => [actors.bridge.address, 10n, 1, 1100n, actors.oracle.address, 2n, 2]),
    readDelay: vi.fn(async (_block: bigint): Promise<unknown> => 2000n), minimumBlock: () => 0n });
  it('binds request, delay and clock to one checked block', async () => {
    const r = reader();
    expect(await readReleasePolicyState(r)).toMatchObject({ amount: 10n, state: 1, nonce: 2n, delay: { now: 1000n, until: 2000n } });
    expect(r.readRelease).toHaveBeenCalledWith(100n); expect(r.readDelay).toHaveBeenCalledWith(100n);
  });
  it.each(['hash', 'time', 'delay', 'release', 'lag', 'offline'])('refuses invalid %s without treating it as an elapsed delay', async (kind) => {
    const r = reader();
    if (kind === 'hash') r.getBlock.mockResolvedValueOnce({ number: 100n, hash: toHex(2, { size: 32 }), parentHash: hash, timestamp: 1000n });
    if (kind === 'time') r.getBlock.mockResolvedValueOnce({ number: 100n, hash, parentHash: hash, timestamp: -1n });
    if (kind === 'delay') r.readDelay.mockResolvedValueOnce(-1n);
    if (kind === 'release') r.readRelease.mockResolvedValueOnce([actors.bridge.address, 0n, 1, 0n, actors.oracle.address, 2n, 2]);
    if (kind === 'lag') r.minimumBlock = () => 101n;
    if (kind === 'offline') r.readDelay.mockRejectedValueOnce(new Error('offline'));
    await expect(readReleasePolicyState(r)).rejects.toThrow();
  });
});
