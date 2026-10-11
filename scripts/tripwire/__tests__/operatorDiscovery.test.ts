// Discovery handed to the signing operator (H3 gap). Synthetic linked histories and
// temporary SQLite journals; the operator's work is a stand-in that reads locators.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { toHex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { cctpVerifierScope } from '../cctp.js';
import { FinalityConflictError } from '../finality.js';
import { OperatorStore } from '../store.js';
import { operatorDiscovery } from '../testnet/operatorDiscovery.js';
import { parseCctpOperatorArgs } from '../testnet/runCctpOperator.js';
import { discoveryFixture } from './fixtures/cctpDiscovery.js';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.reverse().forEach((f) => f()); cleanup.length = 0; });
function setup(version: 1 | 2 = 1) {
  const s = discoveryFixture(version), dir = mkdtempSync(join(tmpdir(), 'tripwire-operator-discovery-'));
  cleanup.push(() => rmSync(dir, { force: true, recursive: true }));
  // The signing operator's own journal: relayer sender, the escrow's source-verifier profile.
  const scope = { route: route.id, sourceChainId: route.source.chainId, chainId: route.destination.chainId,
    source: route.source.transmitter, vault: s.manifest.vault, guardian: s.manifest.guardian, sender: actors.relayer.address,
    token: route.destination.usdc, decimals: 6, finalityMode: 'finalized' as const,
    sourceVerifier: cctpVerifierScope(s.manifest.vault, version === 2 ? 'screened-payment' : 'customer-payment', s.manifest.payment) };
  const store = new OperatorStore(join(dir, 'operator.sqlite'), scope); cleanup.push(() => store.close());
  const discovery = operatorDiscovery({ manifest: s.manifest, feeds: s.clients, starts: s.starts, signal: new AbortController().signal });
  return { s, store, discovery };
}

describe('discovery handed to the signing operator', () => {
  it.each([1, 2] as const)('gives the operator the discovered locator during its work, then commits the cursor (hook v%i)', async (version) => {
    const { s, store, discovery } = setup(version);
    expect(await discovery.locate(s.f.release.messageId)).toBeNull();
    const seen: unknown[] = [];
    const round = await discovery.round(store, async () => {
      seen.push(await discovery.locate(s.f.release.messageId));
      expect(store.loadDiscovery()).toBeNull(); // nothing is committed before the operator's work completes
      return 'ticked';
    });
    expect(round.result).toBe('ticked'); expect(round.coverage.counts.paired).toBe(1);
    expect(seen).toEqual([s.f.locator]);
    expect(store.loadDiscovery()?.credits).toHaveLength(1);
    // The next round resumes from the journal and still knows the locator.
    const next = await discovery.round(store, async () => discovery.locate(s.f.release.messageId));
    expect(next.coverage.incremental?.resumed).toBe(true); expect(next.result).toEqual(s.f.locator);
  });

  it('does not commit the cursor when the operator work fails, so the next round re-finds the hint', async () => {
    const { s, store, discovery } = setup();
    await expect(discovery.round(store, async () => { throw new Error('tick failed'); })).rejects.toThrow('tick failed');
    expect(store.loadDiscovery()).toBeNull();
    const retry = await discovery.round(store, async () => discovery.locate(s.f.release.messageId));
    expect(retry.result).toEqual(s.f.locator); expect(retry.coverage.incremental?.resumed).toBe(false);
  });

  it('does not commit the cursor when the scanned history changes before commit', async () => {
    const { s, store, discovery } = setup();
    const original = s.source.getBlock.getMockImplementation();
    await expect(discovery.round(store, async () => {
      s.source.getBlock.mockImplementation(async (args) => ({ ...await original!(args), hash: toHex(999, { size: 32 }) }));
    })).rejects.toBeInstanceOf(FinalityConflictError);
    expect(store.loadDiscovery()).toBeNull();
  });

  it('refuses a manual-request or non-customer manifest', () => {
    const s = discoveryFixture();
    const args = { feeds: s.clients, starts: s.starts, signal: new AbortController().signal };
    expect(() => operatorDiscovery({ ...args, manifest: { ...s.manifest, requests: [{ messageId: s.f.release.messageId, proof: s.f.locator }] } })).toThrow('empty');
    expect(() => operatorDiscovery({ ...args, manifest: { version: 2, vault: s.manifest.vault, guardian: s.manifest.guardian, operator: s.manifest.operator, requests: [] } })).toThrow('empty');
  });

  it('parses the operator flag strictly', () => {
    expect(parseCctpOperatorArgs(['m.json', 's.sqlite', '1', '2', '--discover-resume=100:200']).discover).toEqual({ source: 100n, destination: 200n });
    expect(parseCctpOperatorArgs(['m.json', 's.sqlite', '1', '2']).discover).toBeUndefined();
    for (const bad of ['--discover-resume=100', '--discover-resume=-1:2', '--discover-resume=01:2', '--discover=1:2']) {
      expect(() => parseCctpOperatorArgs(['m.json', 's.sqlite', '1', '2', bad])).toThrow();
    }
    expect(() => parseCctpOperatorArgs(['m.json', 's.sqlite', '1', '2', '--discover-resume=1:2', '--discover-resume=3:4'])).toThrow();
  });
});
