import { describe, expect, it, vi } from 'vitest';
import { toHex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { cctpPreflight, stringifyPublic, type PreflightReader } from '../testnet/cctpPreflight.js';

const config = { version: 3, deployer: actors.bridge.address, owner: actors.owner.address, oracle: actors.oracle.address,
  deployerNonce: '71', capBaseUnits: '100000000', windowSeconds: '3600',
  payment: { authority: actors.owner.address, sourceSender: actors.owner.address, returnRecipient: actors.owner.address, recoveryDelay: '3600',
    policy: { maxPayment: '10000000', manualApprovalAbove: '5000000', delayAbove: '5000000', delaySeconds: '1800' }, recipients: [actors.bridge.address] } };
function fixture() {
  const make = (chain: number, number: bigint) => {
    const header = { number, hash: toHex(number, { size: 32 }), parentHash: toHex(number - 1n, { size: 32 }), timestamp: 1_780_000_000n };
    return { getChainId: vi.fn(async () => chain), getBlock: vi.fn(async () => header),
      getBalance: vi.fn(async () => 10n ** 18n), getCode: vi.fn(async (address) => [route.source.usdc, route.source.messenger, route.source.transmitter,
        route.destination.usdc, route.destination.messenger, route.destination.transmitter].includes(address as typeof route.source.usdc) ? '0x6000' : '0x'),
      tokenRead: vi.fn(async (_token, name): Promise<number | bigint> => name === 'decimals' ? 6 : 20_000_000n),
      getPendingNonce: vi.fn(async () => 71), getGasPrice: vi.fn(async () => 10n), estimateCreation: vi.fn(async () => 2_000_000n),
    } satisfies PreflightReader;
  };
  return { source: make(route.source.chainId, 100n), destination: make(route.destination.chainId, 200n) };
}
describe('keyless customer pilot preflight', () => {
  it('binds the package, chain snapshots and runtime hashes without authorizing deployment or payment', async () => {
    const f = fixture(), report = await cctpPreflight(config, f.source, f.destination);
    expect(report.fundingAndNonceChecks).toBe('passed'); expect(report.enforcement).toBe(false); expect(report.submittedTransactions).toBe(0);
    expect(report.accounts).toHaveLength(4);
    expect(report.accounts.find((a) => a.roles.includes('guardian-owner'))?.roles).toEqual(['guardian-owner', 'customer-policy', 'customer-return-request']);
    expect(report.firstDeploymentQuote?.estimatedCostWei).toBe(20_000_000n); expect(report.circleCodeObservations).toHaveLength(6);
    expect(report.expectedRuntimeHashes.payment).toMatch(/^0x[0-9a-f]{64}$/); expect(report.remainingGates.length).toBeGreaterThan(5);
    expect(JSON.parse(stringifyPublic(report)).accounts[0].ethWei).toBe('1000000000000000000');
  });
  it('reports exact empty gas and USDC balances as blockers, while still preparing an unsigned package', async () => {
    const f = fixture(); f.source.getBalance.mockResolvedValue(0n); f.destination.getBalance.mockResolvedValue(0n);
    f.source.tokenRead.mockImplementation(async (_token, name) => name === 'decimals' ? 6 : 0n);
    const report = await cctpPreflight(config, f.source, f.destination);
    expect(report.fundingAndNonceChecks).toBe('blocked'); expect(report.blockers.filter((b) => b.startsWith('NO_GAS'))).toHaveLength(4);
    expect(report.blockers).toContain('FIRST_DEPLOYMENT_GAS_SHORTFALL'); expect(report.sourceUsdcBaseUnits).toBe(0n);
  });
  it('refuses a changed nonce and does not estimate a package with invalid predictions', async () => {
    const f = fixture(); f.destination.getPendingNonce.mockResolvedValue(72);
    expect((await cctpPreflight(config, f.source, f.destination)).blockers[0]).toContain('NONCE_CHANGED');
    expect(f.destination.estimateCreation).not.toHaveBeenCalled();
  });
  it('reports occupied predicted addresses without treating them as accepted deployments', async () => {
    const f = fixture(); f.destination.getCode.mockResolvedValue('0x6000');
    const report = await cctpPreflight(config, f.source, f.destination);
    expect(report.blockers.filter((b) => b.startsWith('PREDICTED_ADDRESS_OCCUPIED'))).toHaveLength(2);
    expect(f.destination.estimateCreation).not.toHaveBeenCalled();
  });
  it('records an unavailable gas estimate without guessing a cost', async () => {
    const f = fixture(); f.destination.estimateCreation.mockRejectedValue(new Error('RPC offline'));
    const report = await cctpPreflight(config, f.source, f.destination);
    expect(report.firstDeploymentQuote).toBe(null); expect(report.blockers).toContain('FIRST_DEPLOYMENT_ESTIMATE_UNAVAILABLE');
  });
  it.each(['chain', 'decimals', 'code', 'balance', 'snapshot'] as const)('refuses invalid external %s evidence', async (bad) => {
    const f = fixture();
    if (bad === 'chain') f.source.getChainId.mockResolvedValue(1);
    if (bad === 'decimals') f.source.tokenRead.mockResolvedValue(18);
    if (bad === 'code') f.source.getCode.mockResolvedValue('0x');
    if (bad === 'balance') f.source.getBalance.mockResolvedValue(-1n);
    if (bad === 'snapshot') f.source.getBlock.mockResolvedValueOnce({ number: 100n, hash: toHex(99, { size: 32 }), parentHash: toHex(98, { size: 32 }), timestamp: 1_780_000_000n });
    await expect(cctpPreflight(config, f.source, f.destination)).rejects.toThrow();
  });
});
