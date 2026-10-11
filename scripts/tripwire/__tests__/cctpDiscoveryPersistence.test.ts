// Synthetic linked histories and temporary SQLite files; no public transactions.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { toHex } from 'viem';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { cctpVerifierScope } from '../cctp.js';
import { discoveryStateSchema, type DiscoveryState } from '../discoveryState.js';
import { FinalityConflictError } from '../finality.js';
import { OperatorStore } from '../store.js';
import { discoverCctpRequests } from '../testnet/cctpDiscovery.js';
import { parseObserveArgs } from '../testnet/observeCctp.js';
import { discoveryFixture } from './fixtures/cctpDiscovery.js';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.reverse().forEach((f) => f()); cleanup.length = 0; });
function setup() {
  const s = discoveryFixture(), dir = mkdtempSync(join(tmpdir(), 'tripwire-discovery-')), file = join(dir, 'observer.sqlite');
  cleanup.push(() => rmSync(dir, { force: true, recursive: true }));
  const scope = { route: route.id, sourceChainId: route.source.chainId, chainId: route.destination.chainId,
    source: route.source.transmitter, vault: s.manifest.vault, guardian: s.manifest.guardian, sender: s.manifest.operator,
    token: route.destination.usdc, decimals: 6, finalityMode: 'finalized' as const,
    sourceVerifier: cctpVerifierScope(s.manifest.vault, 'customer-payment', s.manifest.payment) };
  const open = () => { const store = new OperatorStore(file, scope); cleanup.push(() => store.close()); return store; };
  const discover = (resume: DiscoveryState | null = null, signal = new AbortController().signal) => discoverCctpRequests(s.manifest, s.clients, s.starts, signal, { resume });
  const save = async (store: OperatorStore) => {
    const r = await discover(store.loadDiscovery()); await r.assertCanonical();
    if (!r.state) throw new Error('Missing persistent state.'); store.saveDiscovery(r.state); return r;
  };
  return { ...s, file, scope, open, discover, save };
}
describe('durable keyless operation discovery', () => {
  it('reopens the same journal and scans only newly finalized blocks, retaining exact old locators', async () => {
    const s = setup(), store = s.open(), first = await s.save(store); store.close();
    s.source.setHead(170n); s.destination.setHead(270n); s.source.getContractEvents.mockClear(); s.destination.getContractEvents.mockClear();
    const reopened = s.open(), next = await s.save(reopened);
    expect(next.manifest.requests).toEqual(first.manifest.requests);
    expect(next.metadata).toMatchObject({ version: 2, mode: 'persistent-finalized-hints', incremental: { resumed: true, sourceFrom: 102n, destinationFrom: 202n } });
    expect(s.source.getContractEvents.mock.calls.map(([a]) => [a.fromBlock, a.toBlock])).toEqual([[102n, 165n], [166n, 170n]]);
    expect(reopened.loadDiscovery()?.source.through.number).toBe(170n);
    expect(reopened.sourceProofs()).toEqual([]); expect(reopened.transactions()).toEqual([]);
  });
  it('keeps source-only hints through a restart and matches a later destination credit', async () => {
    const s = setup(), credit = s.destinationEvents.pop(); if (!credit) throw new Error('Fixture missing.');
    const store = s.open(); expect((await s.save(store)).metadata.pendingSource).toHaveLength(1); store.close();
    s.destination.setHead(205n); s.destinationEvents.push({ ...credit, blockNumber: 203n, blockHash: s.destination.block(203n).hash });
    const next = await s.save(s.open()); expect(next.metadata.pendingSource).toEqual([]); expect(next.manifest.requests).toHaveLength(1);
    expect(next.manifest.requests[0].proof).toEqual(s.f.locator);
  });
  it('matches a previously unmatched destination hint when the source range later catches up', async () => {
    const s = setup(), burn = s.sourceEvents.pop(); if (!burn) throw new Error('Fixture missing.');
    const store = s.open(); expect((await s.save(store)).metadata.unmatchedDestination).toHaveLength(1);
    s.source.setHead(105n); s.sourceEvents.push({ ...burn, blockNumber: 103n, blockHash: s.source.block(103n).hash });
    const next = await s.save(store); expect(next.manifest.requests).toHaveLength(1); expect(next.metadata.unmatchedDestination).toEqual([]);
  });
  it('rechecks idle histories without querying old event ranges', async () => {
    const s = setup(), store = s.open(), first = await s.save(store);
    s.source.getContractEvents.mockClear(); s.destination.getContractEvents.mockClear();
    const second = await s.save(store); expect(second.state).toEqual(first.state);
    expect(second.metadata.incremental?.sourceFrom).toBe(102n);
    expect(s.source.getContractEvents).not.toHaveBeenCalled(); expect(s.destination.getContractEvents).not.toHaveBeenCalled();
  });
  it('does not commit either cursor when one RPC fails after the other has read new events', async () => {
    const s = setup(), store = s.open(); await s.save(store); const before = store.loadDiscovery();
    s.source.setHead(110n); s.destination.setHead(210n); s.destination.getContractEvents.mockRejectedValue(new Error('Offline'));
    await expect(s.save(store)).rejects.toThrow(); expect(store.loadDiscovery()).toEqual(before);
    s.destination.getContractEvents.mockImplementation(async () => []); await s.save(store);
    expect(s.source.getContractEvents).toHaveBeenLastCalledWith(expect.objectContaining({ fromBlock: 102n }));
  });
  it('replays an uncommitted scan after interruption and commits idempotently', async () => {
    const s = setup(), store = s.open(); await s.discover(); expect(store.loadDiscovery()).toBeNull(); store.close();
    const reopened = s.open(), r = await s.save(reopened);
    if (!r.state) throw new Error('Missing state.'); reopened.saveDiscovery(r.state);
    expect(reopened.loadDiscovery()?.burns).toHaveLength(1);
    expect(s.source.getContractEvents.mock.calls.map(([a]) => a.fromBlock)).toEqual([100n, 100n]);
  });
  it.each(['source', 'destination'] as const)('rejects changed saved %s hint blocks, including idle runs', async (side) => {
    const s = setup(), store = s.open(); await s.save(store);
    const original = s[side].getBlock.getMockImplementation(); if (!original) throw new Error('Fixture missing.');
    s[side].getBlock.mockImplementation(async (args) => ({ ...await original(args), ...(args.blockNumber === s.starts[side] ? { hash: toHex(999, { size: 32 }) } : {}) }));
    await expect(s.save(store)).rejects.toBeInstanceOf(FinalityConflictError);
    expect(store.loadDiscovery()?.source.through.number).toBe(101n);
  });
  it('rechecks saved hints again after receipt auditing, before commit/export', async () => {
    const s = setup(), store = s.open(); await s.save(store); const r = await s.discover(store.loadDiscovery());
    const original = s.source.getBlock.getMockImplementation(); if (!original) throw new Error('Fixture missing.');
    s.source.getBlock.mockImplementation(async (args) => ({ ...await original(args), ...(args.blockNumber === 100n ? { hash: toHex(999, { size: 32 }) } : {}) }));
    await expect(r.assertCanonical()).rejects.toBeInstanceOf(FinalityConflictError);
  });
  it('retains a new duplicate operation as a conflict across subsequent restarts', async () => {
    const s = setup(), store = s.open(); await s.save(store); s.source.setHead(104n);
    s.sourceEvents.push({ ...s.sourceEvents[0], blockNumber: 103n, blockHash: s.source.block(103n).hash, transactionHash: toHex(999, { size: 32 }) });
    const conflict = await s.save(store); expect(conflict.manifest.requests).toEqual([]); expect(conflict.metadata.conflicts).toEqual([s.f.intent.operationId]); store.close();
    const idle = await s.save(s.open()); expect(idle.metadata.conflicts).toEqual(conflict.metadata.conflicts); expect(idle.manifest.requests).toEqual([]);
  });
  it('allows cumulative coverage beyond 4096 while bounding each new increment', async () => {
    const s = setup(), store = s.open(); s.source.setHead(4100n); await s.save(store);
    s.source.setHead(4200n); const next = await s.save(store);
    expect(next.metadata.source.through.number - next.metadata.source.from).toBe(4100n);
    expect(next.metadata.incremental?.sourceFrom).toBe(4101n);
  });
  it('catches up a large backlog in bounded increments without skipping blocks', async () => {
    const s = setup(), store = s.open(); await s.save(store); s.source.setHead(4198n);
    const first = await s.save(store); expect(first.metadata.source.through.number).toBe(4197n);
    expect(first.metadata.incremental?.sourceHead.number).toBe(4198n);
    const next = await s.save(store); expect(next.metadata.incremental?.sourceFrom).toBe(4198n);
    expect(next.metadata.source.through.number).toBe(4198n);
    expect(s.source.getContractEvents).toHaveBeenLastCalledWith(expect.objectContaining({ fromBlock: 4198n, toBlock: 4198n }));
  });
  it('fails at retained hint capacity without silently pruning old operations', async () => {
    const s = setup(), store = s.open(); await s.save(store); const before = store.loadDiscovery(); s.destination.setHead(205n);
    for (let i = 0; i < 100; i++) s.destinationEvents.push({ ...s.destinationEvents[0], blockNumber: 203n, blockHash: s.destination.block(203n).hash, logIndex: i + 10 });
    await expect(s.save(store)).rejects.toThrow('capacity'); expect(store.loadDiscovery()).toEqual(before);
  });
  it.each(['bounds', 'manifest', 'cancel'] as const)('preserves the journal on %s mismatch/interruption', async (kind) => {
    const s = setup(), store = s.open(); await s.save(store); const before = store.loadDiscovery(), abort = new AbortController();
    if (kind === 'bounds') s.starts.source++;
    if (kind === 'manifest') s.manifest.operator = s.manifest.vault;
    if (kind === 'cancel') abort.abort();
    await expect(s.discover(store.loadDiscovery(), abort.signal)).rejects.toThrow(); expect(store.loadDiscovery()).toEqual(before);
  });
  it.each(['drop', 'replace', 'rewind', 'fingerprint', 'scope', 'late-hint'] as const)('refuses destructive journal update %s', async (kind) => {
    const s = setup(), store = s.open(); await s.save(store); const before = store.loadDiscovery(); if (!before) throw new Error('Missing state.');
    const changed = structuredClone(before);
    if (kind === 'drop') changed.burns = [];
    if (kind === 'replace') changed.burns[0].policyHash = toHex(999, { size: 32 });
    if (kind === 'rewind') changed.source.through.number--;
    if (kind === 'fingerprint') changed.fingerprint = toHex(999, { size: 32 });
    if (kind === 'scope') { const c = JSON.parse(changed.destination.checkpoint); c.address = s.manifest.guardian; changed.destination.checkpoint = JSON.stringify(c); }
    if (kind === 'late-hint') changed.burns.push({ ...changed.burns[0], origin: { ...changed.burns[0].origin, logIndex: 99 } });
    expect(() => store.saveDiscovery(changed)).toThrow(); expect(store.loadDiscovery()).toEqual(before);
  });
  it.each(['checkpoint', 'origin', 'header', 'unknown', 'version'] as const)('refuses corrupt persisted %s at startup', async (kind) => {
    const s = setup(), store = s.open(); await s.save(store); const state = store.loadDiscovery(); store.close();
    const encoded = JSON.parse(JSON.stringify(state, (_k, v: unknown) => typeof v === 'bigint' ? v.toString() : v));
    if (kind === 'checkpoint') encoded.source.checkpoint = '{broken';
    if (kind === 'origin') encoded.burns[0].origin.blockNumber = '999';
    if (kind === 'header') encoded.source.through.number = '0';
    if (kind === 'unknown') encoded.authenticated = true;
    if (kind === 'version') encoded.version = 2;
    const db = new DatabaseSync(s.file); db.prepare('UPDATE state SET value=? WHERE key=?').run(JSON.stringify(encoded), 'discovery'); db.close();
    expect(() => s.open()).toThrow();
  });
  it('uses the same exclusive process lease for discovery and proof journals', async () => {
    const s = setup(), store = s.open(); await s.save(store); expect(() => s.open()).toThrow('already running');
    store.close(); expect(s.open().loadDiscovery()?.burns).toHaveLength(1);
  });
  it('cannot advance a quarantined journal or reopen it to clear quarantine', async () => {
    const s = setup(), store = s.open(); await s.save(store); const before = store.loadDiscovery();
    store.quarantineSource('Finalized discovery changed.'); s.source.setHead(105n);
    await expect(s.save(store)).rejects.toThrow('quarantined'); expect(store.loadDiscovery()).toEqual(before); store.close();
    const reopened = s.open(); expect(reopened.sourceQuarantine()).toBe('Finalized discovery changed.'); await expect(s.save(reopened)).rejects.toThrow('quarantined');
  });
  it('validates encoded bigint state and rejects noncanonical or numeric positions', async () => {
    const s = setup(), r = await s.discover(), encoded = JSON.parse(JSON.stringify(r.state, (_k, v: unknown) => typeof v === 'bigint' ? v.toString() : v));
    expect(discoveryStateSchema.parse(encoded)).toEqual(r.state);
    for (const value of [100, '-1', '01', '1.5', (1n << 256n).toString()]) expect(() => discoveryStateSchema.parse({ ...encoded, source: { ...encoded.source, from: value } })).toThrow();
  });
  it.each(['block-hash', 'transaction-block'] as const)('rejects contradictory hint provenance %s', async (kind) => {
    const s = setup(), r = await s.discover(); if (!r.state) throw new Error('Missing state.');
    const state = structuredClone(r.state), origin = { ...state.burns[0].origin, logIndex: 99 };
    if (kind === 'block-hash') origin.blockHash = toHex(999, { size: 32 });
    if (kind === 'transaction-block') { origin.blockNumber = 101n; origin.blockHash = s.source.block(101n).hash; }
    state.burns.push({ ...state.burns[0], origin }); expect(() => discoveryStateSchema.parse(state)).toThrow();
  });
  it('requires an explicit resume flag and refuses combining discovery modes or nonpersistent watch', () => {
    expect(parseObserveArgs(['manifest.json', 'observer.sqlite', '--discover-resume=100:200'])).toMatchObject({ discoveryPersistent: true, discovery: { source: 100n, destination: 200n } });
    expect(parseObserveArgs(['manifest.json', '--discover=100:200']).discoveryPersistent).toBe(false);
    expect(parseObserveArgs(['manifest.json', '--discover-resume=100:200', '--watch']).watch).toBe(true);
    for (const args of [['--discover=100:200', '--watch'], ['--discover=100:200', '--discover-resume=100:200'], ['--discover-resume=1:2', '--discover-resume=1:2'], ['--discover-resume=01:2']]) expect(() => parseObserveArgs(['manifest.json', ...args])).toThrow();
  });
});
