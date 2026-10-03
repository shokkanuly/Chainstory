import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseGwei, parseTransaction, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import guardianArtifact from '../../../src/tripwire/guardian.artifact.js';
import { relayerPort } from '../testnet/operator.js';
import { assertDeployRoles, assertSeparateRoles, deploy, loadConfig, rpcTransport, runTestnetDemo, CAP, WINDOW_SECONDS,
  type Clients, type Deployment, type TestnetConfig } from '../testnet/sepolia.js';

const key = (byte: string) => `0x${byte.repeat(32)}` as Hex;
const relayer = privateKeyToAccount(key('22'));

function clients(fees: { base: bigint; tip: bigint }) {
  const pub = {
    getBlock: vi.fn(async () => ({ baseFeePerGas: fees.base })),
    estimateMaxPriorityFeePerGas: vi.fn(async () => fees.tip),
    estimateGas: vi.fn(async () => 100_000n),
  };
  const wallet = {
    prepareTransactionRequest: vi.fn(async (request: Record<string, unknown>) => ({ ...request, chainId: 11155111, nonce: 5 })),
    signTransaction: vi.fn(async ({ account, ...tx }: { account: typeof relayer } & Record<string, unknown>) =>
      account.signTransaction(tx as Parameters<typeof relayer.signTransaction>[0])),
  };
  return { c: { chainId: 11155111, pub, wallet } as unknown as Clients, pub, wallet };
}
const hooks = () => ({ beforeSign: vi.fn(async () => undefined), assertSafe: vi.fn(async () => undefined), onFinalityConflict: vi.fn(async () => undefined) });
const request = { to: `0x${'ab'.repeat(20)}`, data: '0x1234', value: '0' };

describe('relayer fee policy (HIGH-1)', () => {
  it('signs with headroom: twice the base fee plus the tip, and a fifth more gas than estimated', async () => {
    const f = clients({ base: parseGwei('10'), tip: parseGwei('1') }); const h = hooks();
    const tx = parseTransaction(await relayerPort(f.c, relayer, parseGwei('300'), h).prepare(request));
    expect(tx).toMatchObject({ maxFeePerGas: parseGwei('21'), maxPriorityFeePerGas: parseGwei('1'), gas: 120_000n, nonce: 5, data: '0x1234' });
    expect(h.beforeSign).toHaveBeenCalledTimes(1);
  });
  it('caps the fee at the ceiling, and signs nothing when the network already costs more', async () => {
    const f = clients({ base: parseGwei('10'), tip: parseGwei('1') });
    expect(parseTransaction(await relayerPort(f.c, relayer, parseGwei('15'), hooks()).prepare(request)).maxFeePerGas).toBe(parseGwei('15'));
    await expect(relayerPort(f.c, relayer, parseGwei('10.5'), hooks()).prepare(request)).rejects.toThrow('nothing was signed');
    expect(f.wallet.signTransaction).toHaveBeenCalledTimes(1);
  });
  it('re-signs the same nonce, gas and call 12.5% higher, or at the current network price if that is higher', async () => {
    const f = clients({ base: parseGwei('10'), tip: parseGwei('1') }); const port = relayerPort(f.c, relayer, parseGwei('300'), hooks());
    const original = await port.prepare(request);
    if (!port.replace) throw new Error('relayer ports replace');
    const calm = parseTransaction(await port.replace(original));
    expect(calm).toMatchObject({ nonce: 5, gas: 120_000n, data: '0x1234', maxFeePerGas: parseGwei('23.625'), maxPriorityFeePerGas: parseGwei('1.125') });
    f.pub.getBlock.mockResolvedValue({ baseFeePerGas: parseGwei('100') });
    expect(parseTransaction(await port.replace(original)).maxFeePerGas).toBe(parseGwei('201'));
  });
  it('leaves a transaction pending rather than bump it past the ceiling', async () => {
    const f = clients({ base: parseGwei('10'), tip: parseGwei('1') }); const port = relayerPort(f.c, relayer, parseGwei('22'), hooks());
    const original = await port.prepare(request);
    await expect(port.replace?.(original)).rejects.toThrow('stays pending');
  });
});

describe('key roles (ADR-026)', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
  const load = (lines: string[], env: Record<string, string> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'tripwire-roles-')); dirs.push(dir);
    const file = join(dir, '.env.tripwire'); writeFileSync(file, lines.join('\n'));
    return loadConfig({ TRIPWIRE_ENV_FILE: file, ...env });
  };
  const roles = ['TRIPWIRE_ORACLE_KEY=' + key('11'), 'TRIPWIRE_RELAYER_KEY=' + key('22'), 'TRIPWIRE_ATTESTATION_RELAYER_KEY=' + key('33')];
  const safe = `0x${'5a'.repeat(20)}`;

  it('loads one named key per role, an owner Safe, ranked RPCs and a fee ceiling', () => {
    const cfg = load([...roles, `TRIPWIRE_OWNER_SAFE=${safe}`, 'SEPOLIA_RPC_URL=https://a.example, https://b.example', 'TRIPWIRE_MAX_FEE_GWEI=50']);
    expect(cfg.singleKey).toBe(false);
    expect([cfg.oracle, cfg.relayer, cfg.attestationRelayer].map((a) => a.address)).toEqual([key('11'), key('22'), key('33')].map((k) => privateKeyToAccount(k).address));
    expect(cfg.account.address).toBe(cfg.relayer.address); expect(cfg.owner?.toLowerCase()).toBe(safe);
    expect(cfg.rpcUrls).toEqual(['https://a.example', 'https://b.example']); expect(cfg.maxFeePerGas).toBe(parseGwei('50'));
    expect(() => assertSeparateRoles(cfg)).not.toThrow();
    expect(rpcTransport(cfg.rpcUrls)({ chain: sepolia }).config.type).toBe('fallback');
  });
  it('keeps the legacy one-key file for the scripted demo, and the operator refuses it', () => {
    const cfg = load([`DEPLOYER_PRIVATE_KEY=${key('44')}`]);
    expect(cfg.singleKey).toBe(true); expect(cfg.oracle.address).toBe(cfg.relayer.address);
    expect(rpcTransport(cfg.rpcUrls)({ chain: sepolia }).config.type).toBe('http');
    expect(() => assertSeparateRoles(cfg)).toThrow('One key cannot be oracle and relayer');
  });
  it.each([
    ['a stray unnamed key', [...roles, `DEPLOYER_PRIVATE_KEY=${key('44')}`], 'outside the roles'],
    ['a missing role', roles.slice(0, 2), 'missing TRIPWIRE_ATTESTATION_RELAYER_KEY'],
    ['one key in two roles', [roles[0], roles[1], `TRIPWIRE_ATTESTATION_RELAYER_KEY=${key('11')}`], 'different accounts'],
    ['an owner that is also a role', [...roles, `TRIPWIRE_OWNER_SAFE=${privateKeyToAccount(key('11')).address}`], 'different accounts'],
    ['a malformed owner', [...roles, 'TRIPWIRE_OWNER_SAFE=0x1234'], 'not an address'],
    ['two unnamed keys', [`A=${key('44')}`, `B=${key('55')}`], 'Name each one'],
    ['a zero fee ceiling', [...roles, 'TRIPWIRE_MAX_FEE_GWEI=0'], 'positive number'],
  ])('refuses %s', (_name, lines, message) => {
    expect(() => load(lines)).toThrow(message);
  });
});

describe('deployment roles (ADR-026, CRIT-1)', () => {
  const [oracle, attester] = [privateKeyToAccount(key('11')), privateKeyToAccount(key('33'))];
  const safe = `0x${'5a'.repeat(20)}` as Hex;
  const roles = (patch: Partial<TestnetConfig> = {}) => ({ account: relayer, oracle, relayer, attestationRelayer: attester, owner: safe,
    singleKey: false, rpcUrls: ['https://rpc.example'], maxFeePerGas: parseGwei('300'), etherscanKey: null,
    deploymentFile: join(mkdtempSync(join(tmpdir(), 'tripwire-deploy-')), 'deployment.json'), ...patch }) as TestnetConfig;
  const safeCode = '0x6080' as Hex;

  it.each([
    ['one key for every role', { singleKey: true, oracle: relayer, attestationRelayer: relayer }, safeCode, 'One key cannot be oracle and relayer'],
    ['no owner Safe', { owner: null }, safeCode, 'TRIPWIRE_OWNER_SAFE'],
    ['an EOA owner', {}, '0x' as Hex, 'no contract code'],
  ])('refuses %s', (_name, patch, code, message) => {
    expect(() => assertDeployRoles(roles(patch as Partial<TestnetConfig>), code)).toThrow(message);
  });

  function chain(code: Hex) {
    let n = 0;
    const address = () => `0x${(++n).toString(16).padStart(40, '0')}` as Hex;
    const pub = {
      getCode: vi.fn(async () => code), getBlockNumber: vi.fn(async () => 100n),
      waitForTransactionReceipt: vi.fn(async () => ({ status: 'success', contractAddress: address(), gasUsed: 1n, blockNumber: 1n })),
      getTransaction: vi.fn(async () => ({ input: '0x00' })),
      readContract: vi.fn(async () => 4n),
    };
    const wallet = { deployContract: vi.fn(async (_request: unknown) => `0x${'d'.repeat(64)}`), writeContract: vi.fn(async (_request: unknown) => `0x${'e'.repeat(64)}`) };
    return { c: { chainId: 11155111, pub, wallet } as unknown as Clients, pub, wallet };
  }
  it('deploys the guardian with the oracle key as oracle, then offers ownership to the Safe', async () => {
    const f = chain(safeCode); const cfg = roles();
    const d = await deploy(cfg, f.c, () => undefined);
    const guardianDeploy = f.wallet.deployContract.mock.calls.map((call) => call[0] as unknown as { bytecode: Hex; args: unknown[] })
      .find((call) => call.bytecode === guardianArtifact.bytecode);
    expect(guardianDeploy?.args).toEqual([relayer.address, oracle.address]);
    const writes = f.wallet.writeContract.mock.calls.map((call) => call[0] as unknown as { functionName: string; args: unknown[] });
    expect(writes.at(-1)).toMatchObject({ functionName: 'transferOwnership', args: [safe] });
    expect(d).toMatchObject({ deployer: relayer.address, oracle: oracle.address, owner: safe,
      relayers: { release: relayer.address, attestation: attester.address }, policy: { guardian: 4, release: 4 } });
  });
  it('sends nothing when the owner is not a contract', async () => {
    const f = chain('0x');
    await expect(deploy(roles(), f.c, () => undefined)).rejects.toThrow('no contract code');
    expect(f.wallet.deployContract).not.toHaveBeenCalled(); expect(f.wallet.writeContract).not.toHaveBeenCalled();
  });

  function demoChain(owner: Hex, tier: number) {
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => ({
      GUARDIAN_POLICY_VERSION: 4n, RELEASE_POLICY_VERSION: 4n, isProtected: true, MAX_REVIEW_TTL: 600n, rollingUsage: 0n,
      getRoute: { cap: CAP, windowSeconds: WINDOW_SECONDS }, currentTier: tier, isPaused: tier === 3, owner,
    } as Record<string, unknown>)[functionName]);
    const writeContract = vi.fn(async () => { throw new Error('stop after the reset decision'); });
    const contract = { address: `0x${'c'.repeat(40)}` as Hex };
    const d = { contracts: { TripwireGuardian: contract, ProtectedVault: contract, MockSourceBridge: contract, DrainProxy: contract } } as unknown as Deployment;
    return { c: { chainId: 11155111, pub: { readContract }, wallet: { writeContract } } as unknown as Clients, d, writeContract };
  }
  it('asks the owner Safe to resume a protected demo route instead of resetting it', async () => {
    const f = demoChain(safe, 3);
    await expect(runTestnetDemo(roles(), f.c, f.d, { contractFacts: async () => null })).rejects.toThrow(`owner Safe ${safe} must call resume`);
    expect(f.writeContract).not.toHaveBeenCalled();
  });
  it('lets the deployer reset its own route until the Safe accepts ownership', async () => {
    const f = demoChain(relayer.address, 2);
    await expect(runTestnetDemo(roles(), f.c, f.d, { contractFacts: async () => null })).rejects.toThrow('stop after the reset decision');
    expect(f.writeContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'resume' }));
  });
});
