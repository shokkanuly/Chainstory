// Stage 2: the scorer reuses Retold's contract checks. The "done when" is the
// first test: an unverified, day-old, upgradeable target reaches THROTTLE with
// no other anomaly. The rest pin what makes that safe to ship — contract facts
// alone never go past THROTTLE, unknown facts never read as clean, and the
// facts reach a Node process through the same explorer proxy the browser uses.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { inProcessExplorer } from '../../../server/explorerTransport';
import { explorerRequest, setExplorerTransport, type ExplorerTransport } from '../../services/apiClient';
import { fetchContractIntel, type ContractIntel } from '../../services/contractIntel';
import { summariseContract } from '../contractSummary';
import { getTierForScore, ResponseTier } from '../onChain';
import { DEFAULT_CONFIG, scoreTransfer, type ScreeningSource } from '../riskScorer';
import type { BridgeTransfer, ContractRiskSummary, RouteBaseline } from '../types';

const NOW = 1_780_000_000;
const ROUTE = 'eth:arb:USDC';
const TARGET = '0x9999999999999999999999999999999999999999';

const baseline: RouteBaseline = {
  route: ROUTE,
  windowHours: 24,
  sampleSize: 400,
  medianTransferUsd: 12_000,
  p95TransferUsd: 90_000,
  rollingTvlUsd: 40_000_000,
  computedAt: NOW - 600,
};

// An ordinary transfer: a quarter of the route's median-to-p95 range, one in the window.
const transfer: BridgeTransfer = {
  hash: '0xabc',
  chain: 'ethereum',
  route: ROUTE,
  token: 'USDC',
  amountUsd: 25_000,
  timestamp: NOW,
  from: '0xbridge',
  to: TARGET,
};

const cleanList: ScreeningSource = { isFlagged: () => false, describe: () => undefined };

const contract = (over: Partial<ContractRiskSummary> = {}): ContractRiskSummary => ({
  address: TARGET,
  isVerified: true,
  ageDays: 900,
  isUpgradeable: false,
  adminFunctions: [],
  ...over,
});

const DRAIN_PROFILE = contract({ isVerified: false, ageDays: 1, isUpgradeable: true });

const score = (targetContract?: ContractRiskSummary, over: Partial<BridgeTransfer> = {}) =>
  scoreTransfer({ transfer: { ...transfer, ...over }, baseline, recent: [], screening: cleanList, now: NOW, targetContract });

const tier = (s: number | null) => getTierForScore(s ?? 0);

describe('contract risk in the scorer', () => {
  it('an unverified, day-old, upgradeable target reaches THROTTLE with no other anomaly', () => {
    const without = score();
    expect(without.verdict).toBe('clear');
    expect(tier(without.score)).toBe(ResponseTier.NONE);

    const withTarget = score(DRAIN_PROFILE);
    expect(withTarget.verdict).toBe('trip');
    expect(tier(withTarget.score)).toBe(ResponseTier.THROTTLE);
    const signal = withTarget.signals.find((s) => s.id === 'contract_risk');
    expect(signal?.reason).toBe(
      "Target contract 0x9999…9999: its source is not verified, it was deployed 1 day(s) ago, its code can be replaced."
    );
    // Every other signal is calm: the throttle is the contract's doing alone.
    expect(withTarget.signals.filter((s) => s.id !== 'contract_risk').every((s) => s.score < 0.1)).toBe(true);
  });

  it('contract facts alone never go past THROTTLE, however bad', () => {
    const worst = score(contract({ isVerified: false, ageDays: 0, isUpgradeable: true, adminFunctions: ['pause', 'mint'] }));
    expect(worst.score).toBe(DEFAULT_CONFIG.tripThreshold);
    expect(tier(worst.score)).toBe(ResponseTier.THROTTLE);
  });

  it('a drain-profile contract plus anomalous volume is corroborated: DELAY, never FREEZE', () => {
    // 10.6x the route's p95: the size signal is severe on its own.
    const big = { amountUsd: 900_000 };
    expect(tier(score(undefined, big).score)).toBe(ResponseTier.NONE);
    expect(tier(score(DRAIN_PROFILE, big).score)).toBe(ResponseTier.DELAY);
    const worst = contract({ isVerified: false, ageDays: 0, isUpgradeable: true, adminFunctions: ['pause'] });
    expect(tier(score(worst, { amountUsd: 20_000_000 }).score)).toBe(ResponseTier.DELAY);
    // With a matching burn the calm proof signal holds the mean at ~0.57: the
    // corroboration floor alone lifts it, to exactly the DELAY line.
    const backed = { amountUsd: 20_000_000, provenBurnUsd: 20_000_000, claimedPayoutUsd: 20_000_000 };
    expect(score(worst, backed).score).toBe(DEFAULT_CONFIG.delayThreshold);
  });

  it('two of the three are not enough to act on', () => {
    for (const partial of [
      contract({ isVerified: false, ageDays: 1 }),
      contract({ isVerified: false, isUpgradeable: true }),
      contract({ ageDays: 1, isUpgradeable: true }),
    ]) {
      expect(tier(score(partial).score)).toBe(ResponseTier.NONE);
    }
  });

  it('a verified, established contract scores zero and changes nothing', () => {
    const res = score(contract());
    expect(res.signals.find((s) => s.id === 'contract_risk')?.score).toBe(0);
    expect(res.verdict).toBe('clear');
  });

  it('adds to other evidence rather than replacing it', () => {
    // A proven payout mismatch is proof: the contract profile must not cap it.
    const res = score(DRAIN_PROFILE, { claimedPayoutUsd: 25_000, provenBurnUsd: 0 });
    expect(res.score).toBe(1);
    expect(tier(res.score)).toBe(ResponseTier.FREEZE);
  });

  it('unknown facts add nothing, and are named', () => {
    const partlyKnown = score(contract({ isVerified: null, ageDays: 1, isUpgradeable: null }));
    const signal = partlyKnown.signals.find((s) => s.id === 'contract_risk');
    expect(signal?.score).toBeCloseTo(0.3);
    expect(signal?.reason).toContain('Could not determine its verification, upgradeability.');

    const nothingKnown = score(contract({ isVerified: null, ageDays: null, isUpgradeable: null }));
    expect(nothingKnown.signals.some((s) => s.id === 'contract_risk')).toBe(false);
  });
});

describe('summariseContract', () => {
  const intel = (over: Partial<ContractIntel>): ContractIntel => ({
    address: TARGET,
    status: 'ok',
    isContract: true,
    isVerified: true,
    contractName: null,
    isProxy: false,
    implementationAddress: null,
    createdAt: null,
    ageDays: 100,
    adminCapabilities: { canUpgrade: false, canPause: false, canMint: false, hasOwner: true, evidence: ['owner'] },
    ...over,
  });

  it('a wallet has no contract to judge', () => {
    expect(summariseContract(intel({ isContract: false }))).toBeNull();
  });

  it('is upgradeable if the explorer says proxy or the ABI can upgrade', () => {
    expect(summariseContract(intel({ isProxy: true }))?.isUpgradeable).toBe(true);
    const caps = { canUpgrade: true, canPause: false, canMint: false, hasOwner: true, evidence: ['upgradeTo'] };
    expect(summariseContract(intel({ adminCapabilities: caps }))?.isUpgradeable).toBe(true);
  });

  it('says "not upgradeable" only when both were checked', () => {
    expect(summariseContract(intel({}))?.isUpgradeable).toBe(false);
    // Unverified: no ABI to read, so an upgrade function cannot be ruled out.
    expect(summariseContract(intel({ isVerified: false, adminCapabilities: null }))?.isUpgradeable).toBeNull();
  });

  it('lists admin functions only when they can pause or mint', () => {
    expect(summariseContract(intel({}))?.adminFunctions).toEqual([]);
    const caps = { canUpgrade: false, canPause: true, canMint: false, hasOwner: true, evidence: ['pause', 'owner'] };
    expect(summariseContract(intel({ adminCapabilities: caps }))?.adminFunctions).toEqual(['pause', 'owner']);
  });
});

describe('the explorer transport', () => {
  afterEach(() => {
    setExplorerTransport(null);
    vi.unstubAllGlobals();
  });

  it('in Node, the facts come through the real proxy handler and reach THROTTLE', async () => {
    const createdAt = Math.floor(Date.now() / 1000) - 86_400 - 60;
    // Etherscan V2 response shapes, as contractIntel.ts reads them.
    const upstream = vi.fn(async (url: string) => {
      const action = new URL(url).searchParams.get('action');
      const result =
        action === 'eth_getCode'
          ? '0x6080604052'
          : action === 'getsourcecode'
            ? [{ SourceCode: '', ABI: 'Contract source code not verified', ContractName: '', Proxy: '1', Implementation: '' }]
            : action === 'getcontractcreation'
              ? [{ contractAddress: TARGET, txHash: `0x${'1'.repeat(64)}`, timestamp: String(createdAt) }]
              : null;
      return { ok: true, status: 200, json: async () => ({ status: '1', message: 'OK', result }) } as unknown as Response;
    });

    const transport: ExplorerTransport = inProcessExplorer({ ETHERSCAN_API_KEY: 'test-key' }, upstream as unknown as typeof fetch);
    setExplorerTransport(transport);

    const summary = summariseContract(await fetchContractIntel(TARGET, 'ethereum'));
    expect(summary).toEqual({ address: TARGET, isVerified: false, ageDays: 1, isUpgradeable: true, adminFunctions: [] });
    expect(tier(score(summary ?? undefined).score)).toBe(ResponseTier.THROTTLE);

    // The key went upstream from the handler, as it does behind /api/explorer.
    expect(upstream.mock.calls.every(([url]) => String(url).includes('apikey=test-key'))).toBe(true);
  });

  it('in Node with no key, the contract reads as unchecked, not clean', async () => {
    setExplorerTransport(inProcessExplorer({}, vi.fn() as unknown as typeof fetch));
    const intel = await fetchContractIntel(TARGET, 'ethereum');
    expect(intel.status).toBe('unavailable');
    const summary = summariseContract(intel);
    expect(score(summary ?? undefined).signals.some((s) => s.id === 'contract_risk')).toBe(false);
  });

  it('in the browser, the default still calls /api/explorer on our own origin', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: '1', result: [] }) }));
    vi.stubGlobal('window', { location: { origin: 'https://retold.example' } });
    vi.stubGlobal('fetch', fetchSpy);

    await explorerRequest('base', { module: 'contract', action: 'getsourcecode', address: TARGET, page: undefined });
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://retold.example/api/explorer?chain=base&module=contract&action=getsourcecode&address=${TARGET}`
    );
  });
});
