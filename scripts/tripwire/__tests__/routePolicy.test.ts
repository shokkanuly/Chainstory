import { describe, expect, it, vi } from 'vitest';
import { ContractFunctionExecutionError, ContractFunctionRevertedError, toHex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { assertProtectionPolicy } from '../testnet/protectionPolicy.js';
import { readReleasePolicyState } from '../testnet/releaseState.js';
import { createRpcOperator } from '../testnet/operator.js';
import { runTestnetDemo, type Clients, type Deployment, type TestnetConfig } from '../testnet/sepolia.js';

describe('route protection deployment boundary', () => {
  const reader = () => ({ guardianVersion: async (): Promise<unknown> => 4n,
    releaseVersion: async (): Promise<unknown> => 4n, reviewFormat: async (): Promise<unknown> => 2n, routePermission: async (): Promise<unknown> => true });
  it('accepts the current policy and route-scoped permission', async () => {
    await expect(assertProtectionPolicy(reader())).resolves.toBeUndefined();
  });
  it('reads a v4 vault deployed before the review-format getter as format 2, never as format 3', async () => {
    const missing = () => { throw new ContractFunctionExecutionError(new ContractFunctionRevertedError({ abi: [], functionName: 'REVIEW_FORMAT_VERSION' }),
      { abi: [], functionName: 'REVIEW_FORMAT_VERSION' }); };
    const r = reader(); r.reviewFormat = async () => missing();
    await expect(assertProtectionPolicy(r)).resolves.toBeUndefined();
    await expect(assertProtectionPolicy(r, 3)).rejects.toThrow();
    const offline = reader(); offline.reviewFormat = async () => { throw new Error('offline'); };
    await expect(assertProtectionPolicy(offline)).rejects.toThrow('offline');
    const reverted = reader(); reverted.reviewFormat = async () => { throw new ContractFunctionExecutionError(new ContractFunctionRevertedError({
      abi: [], functionName: 'REVIEW_FORMAT_VERSION', message: 'paused' }), { abi: [], functionName: 'REVIEW_FORMAT_VERSION' }); };
    await expect(assertProtectionPolicy(reverted)).rejects.toThrow();
  });
  it('accepts the payment escrow review format only when asked for it', async () => {
    const r = reader(); r.reviewFormat = async () => 3n;
    await expect(assertProtectionPolicy(r, 3)).resolves.toBeUndefined();
    await expect(assertProtectionPolicy(reader(), 3)).rejects.toThrow();
  });
  it.each(['old guardian', 'old vault', 'single-key-only guardian', 'single-key-only vault', 'instant-rotation guardian',
    'terminal-reject vault', 'new payment format', 'revoked route', 'unknown response', 'RPC error'])('refuses %s', async (kind) => {
    const r = reader();
    if (kind === 'old guardian') r.guardianVersion = async () => 1n;
    if (kind === 'old vault') r.releaseVersion = async () => 1n;
    if (kind === 'single-key-only guardian') r.guardianVersion = async () => 2n;
    if (kind === 'single-key-only vault') r.releaseVersion = async () => 2n;
    if (kind === 'instant-rotation guardian') r.guardianVersion = async () => 3n;
    if (kind === 'terminal-reject vault') r.releaseVersion = async () => 3n;
    if (kind === 'new payment format') r.reviewFormat = async () => 3n;
    if (kind === 'revoked route') r.routePermission = async () => false;
    if (kind === 'unknown response') r.guardianVersion = async () => '4';
    if (kind === 'RPC error') r.routePermission = async () => { throw new Error('offline'); };
    await expect(assertProtectionPolicy(r)).rejects.toThrow();
  });
  it.each(['guardian', 'vault', 'permission', 'busy'])('refuses demo %s before reset or payout transactions', async (kind) => {
    const writeContract = vi.fn();
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'GUARDIAN_POLICY_VERSION') return kind === 'guardian' ? 3n : 4n;
      if (functionName === 'RELEASE_POLICY_VERSION') return kind === 'vault' ? 3n : 4n;
      if (functionName === 'REVIEW_FORMAT_VERSION') return 2n;
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
  it('refuses payment review format 3 before the legacy operator opens state or signs', async () => {
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'MAX_REVIEW_TTL') return 600n;
      if (functionName === 'REVIEW_FORMAT_VERSION') return 3n;
      if (functionName === 'isProtected') return true;
      return 4n; // Current guardian and vault policy: only the review format is wrong.
    });
    const signTransaction = vi.fn();
    const c = { chainId: 11155111, pub: { readContract }, wallet: { signTransaction } } as unknown as Clients;
    const contract = { address: actors.bridge.address };
    const d = { chainId: 11155111, startBlock: '0', contracts: { ProtectedVault: contract, TripwireGuardian: contract,
      DemoUSDC: contract, MockSourceBridge: contract } } as unknown as Deployment;
    await expect(createRpcOperator({ account: actors.oracle } as TestnetConfig, c, d,
      '/path-that-does-not-exist/payment-policy.sqlite', { baseline: null })).rejects.toThrow();
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'REVIEW_FORMAT_VERSION' }));
    expect(signTransaction).not.toHaveBeenCalled();
  });
});

describe('request delay RPC boundary', () => {
  const hash = toHex(1, { size: 32 });
  const reader = () => ({ getBlock: vi.fn(async (_args: { blockTag: 'latest' } | { blockNumber: bigint }) => ({
    number: 100n, hash, parentHash: toHex(0, { size: 32 }), timestamp: 1000n })),
    readRelease: vi.fn(async (_block: bigint): Promise<unknown> => [actors.bridge.address, 10n, 1, 1100n, actors.oracle.address, 2n, 2]),
    readDelay: vi.fn(async (_block: bigint): Promise<unknown> => 2000n),
    readRejectedAt: vi.fn(async (_block: bigint): Promise<unknown> => 0n), rejectionCooldown: 604_800n, minimumBlock: () => 0n });
  it('binds request, delay and clock to one checked block', async () => {
    const r = reader();
    const state = await readReleasePolicyState(r);
    expect(state).toMatchObject({ amount: 10n, state: 1, nonce: 2n, delay: { now: 1000n, until: 2000n } }); expect(state.rejection).toBeUndefined();
    expect(r.readRelease).toHaveBeenCalledWith(100n); expect(r.readDelay).toHaveBeenCalledWith(100n); expect(r.readRejectedAt).toHaveBeenCalledWith(100n);
  });
  it('reports when a rejected request becomes reviewable again, on the same clock', async () => {
    const r = reader();
    r.readRelease.mockResolvedValueOnce([actors.bridge.address, 10n, 3, 0n, actors.oracle.address, 1n, 3]); r.readRejectedAt.mockResolvedValueOnce(900n);
    expect(await readReleasePolicyState(r)).toMatchObject({ state: 3, rejection: { now: 1000n, until: 900n + 604_800n } });
  });
  it.each(['hash', 'time', 'delay', 'release', 'lag', 'offline', 'rejection'])('refuses invalid %s without treating it as an elapsed delay', async (kind) => {
    const r = reader();
    if (kind === 'hash') r.getBlock.mockResolvedValueOnce({ number: 100n, hash: toHex(2, { size: 32 }), parentHash: hash, timestamp: 1000n });
    if (kind === 'time') r.getBlock.mockResolvedValueOnce({ number: 100n, hash, parentHash: hash, timestamp: -1n });
    if (kind === 'delay') r.readDelay.mockResolvedValueOnce(-1n);
    if (kind === 'release') r.readRelease.mockResolvedValueOnce([actors.bridge.address, 0n, 1, 0n, actors.oracle.address, 2n, 2]);
    if (kind === 'lag') r.minimumBlock = () => 101n;
    if (kind === 'offline') r.readDelay.mockRejectedValueOnce(new Error('offline'));
    if (kind === 'rejection') r.readRejectedAt.mockResolvedValueOnce(-1n);
    await expect(readReleasePolicyState(r)).rejects.toThrow();
  });
});
