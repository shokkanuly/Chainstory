import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseGwei, parseTransaction, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { relayerPort } from '../testnet/operator.js';
import { assertSeparateRoles, loadConfig, rpcTransport, type Clients } from '../testnet/sepolia.js';

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
