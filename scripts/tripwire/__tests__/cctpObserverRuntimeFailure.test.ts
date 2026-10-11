// Synthetic canonical chains and real local SQLite: faults must not become RPC retries.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpRequestError, toHex } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCctpAudit } from '../testnet/cctpAudit.js';
import { runCctpObserver, type ObserverReport } from '../testnet/cctpObserver.js';
import { runObserveCommand } from '../testnet/observeCctp.js';
import { OperatorStore } from '../store.js';
import { FinalityConflictError } from '../finality.js';
import { observerFixture } from './fixtures/cctpObserver.js';

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); cleanups.reverse().forEach((f) => f()); cleanups.length = 0; });
const outage = () => new HttpRequestError({ url: 'https://rpc.invalid/?token=PRIVATE_SENTINEL', status: 503 });
async function setup() {
  const f = observerFixture(), dir = mkdtempSync(join(tmpdir(), 'tripwire-runtime-failure-')), path = join(dir, 'observer.sqlite');
  cleanups.push(() => rmSync(dir, { force: true, recursive: true }));
  const open = async () => {
    const audit = await createCctpAudit(f.manifest, path, f.f.source.port, f.reader, true);
    cleanups.push(() => audit.close()); return audit;
  };
  const audit = await open(), abort = new AbortController(), reports: ObserverReport[] = [], reasons: string[] = [], waits: number[] = [];
  const run = (extra: Partial<Parameters<typeof runCctpObserver>[0]> = {}) => runCctpObserver({
    audit, feeds: f.clients, initialManifest: f.manifest, readManifest: () => f.manifest,
    options: { watch: true, intervalSeconds: 10, discovery: f.starts, discoveryPersistent: true }, signal: abort.signal,
    emit: (r) => { reports.push(r); if (reports.length >= 2) abort.abort(); },
    onFailure: (reason) => { reasons.push(reason); }, wait: async (seconds) => { waits.push(seconds); }, ...extra,
  });
  return { ...f, dir, path, audit, open, abort, reports, reasons, waits, run };
}
describe('keyless observer running failure taxonomy', () => {
  it.each(['saveSourceProof', 'sourceProofs', 'sourceQuarantine', 'loadWatcher', 'loadDiscovery', 'saveDiscovery'] as const)(
    'stops on journal %s errors even when the thrown cause resembles a network error', async (method) => {
      const s = await setup(), spy = vi.spyOn(s.audit.store, method).mockImplementation(() => { throw outage(); });
      expect(await s.run()).toBe('failed'); expect(s.reasons).toEqual(['journal']); expect(s.waits).toEqual([]);
      expect(s.reports).toHaveLength(1); expect(s.reports[0]).toMatchObject({ status: 'unavailable', worker: { state: 'stopped', nextPollSeconds: 0 } });
      expect(JSON.stringify(s.reports)).not.toContain('PRIVATE_SENTINEL'); spy.mockRestore();
      expect(s.audit.store.transactions()).toEqual([]);
    },
  );
  it('preserves a proof committed just before a reported disk failure, then restarts without duplicate claims', async () => {
    const s = await setup(), save = s.audit.store.saveSourceProof.bind(s.audit.store);
    const spy = vi.spyOn(s.audit.store, 'saveSourceProof').mockImplementation((proof) => { save(proof); throw new Error('PRIVATE_SENTINEL disk failure after commit'); });
    expect(await s.run()).toBe('failed'); expect(s.reasons).toEqual(['journal']); expect(s.waits).toEqual([]);
    spy.mockRestore(); expect(s.audit.store.sourceProofs()).toHaveLength(1); expect(s.audit.store.loadDiscovery()).toBeNull();
    s.audit.close(); const restarted = await s.open();
    expect(await s.run({ audit: restarted, options: { watch: false, intervalSeconds: 10, discovery: s.starts, discoveryPersistent: true }, emit: () => {} })).toBe('complete');
    expect(restarted.store.sourceProofs()).toHaveLength(1); expect(restarted.store.loadDiscovery()?.burns).toHaveLength(1);
  });
  it('stops and exports empty evidence when writing quarantine fails', async () => {
    const s = await setup(); vi.spyOn(s.audit, 'tick').mockRejectedValue(new FinalityConflictError('Synthetic conflict'));
    vi.spyOn(s.audit.store, 'quarantineSource').mockImplementation(() => { throw outage(); });
    expect(await s.run()).toBe('failed'); expect(s.reasons).toEqual(['journal']); expect(s.waits).toEqual([]);
    expect(s.reports[0]).toMatchObject({ status: 'unavailable', worker: { state: 'stopped' } });
    expect(s.reports[0]).not.toHaveProperty('results'); expect(s.audit.store.loadDiscovery()).toBeNull();
  });
  it('preserves a discovery row committed before a reported failure and resumes its cursor', async () => {
    const s = await setup(), save = s.audit.store.saveDiscovery.bind(s.audit.store);
    const spy = vi.spyOn(s.audit.store, 'saveDiscovery').mockImplementation((state) => { save(state); throw outage(); });
    expect(await s.run()).toBe('failed'); expect(s.reasons).toEqual(['journal']); expect(s.waits).toEqual([]);
    spy.mockRestore(); expect(s.audit.store.loadDiscovery()?.source.through.number).toBe(101n);
    s.audit.close(); const restarted = await s.open();
    expect(await s.run({ audit: restarted, options: { watch: false, intervalSeconds: 10, discovery: s.starts, discoveryPersistent: true }, emit: () => {} })).toBe('complete');
    expect(restarted.store.sourceProofs()).toHaveLength(1); expect(restarted.store.loadDiscovery()?.credits).toHaveLength(1);
  });
  it('keeps a quarantine committed before a reported write failure terminal on restart', async () => {
    const s = await setup(), quarantine = s.audit.store.quarantineSource.bind(s.audit.store);
    vi.spyOn(s.audit, 'tick').mockRejectedValue(new FinalityConflictError('Synthetic conflict'));
    const spy = vi.spyOn(s.audit.store, 'quarantineSource').mockImplementation((reason) => { quarantine(reason); throw outage(); });
    expect(await s.run()).toBe('failed'); expect(s.reasons).toEqual(['journal']); expect(s.waits).toEqual([]);
    spy.mockRestore(); expect(s.audit.store.sourceQuarantine()).toBeTruthy(); s.audit.close();
    await expect(s.open()).rejects.toMatchObject({ reason: 'quarantine' });
  });
  it('stops if proof projection cannot read a claim that just committed', async () => {
    const s = await setup(), save = s.audit.store.saveSourceProof.bind(s.audit.store), proofs = s.audit.store.sourceProofs.bind(s.audit.store); let committed = false;
    vi.spyOn(s.audit.store, 'saveSourceProof').mockImplementation((proof) => { const result = save(proof); committed = true; return result; });
    const spy = vi.spyOn(s.audit.store, 'sourceProofs').mockImplementation(() => { if (committed) throw outage(); return proofs(); });
    expect(await s.run()).toBe('failed'); expect(s.reasons).toEqual(['journal']); expect(s.reports[0]).not.toHaveProperty('results');
    spy.mockRestore(); expect(s.audit.store.sourceProofs()).toHaveLength(1); expect(s.audit.store.loadDiscovery()).toBeNull();
  });
  it('does not mask source-adapter quarantine write failure as per-payment unavailable', async () => {
    const s = await setup(); await s.run({ options: { watch: false, intervalSeconds: 10, discovery: s.starts, discoveryPersistent: true } });
    s.reports.length = 0;
    const read = s.f.source.port.getBlock;
    s.f.source.port.getBlock = async (args) => ({ ...await read(args) as Record<string, unknown>, ...('blockNumber' in args ? { hash: toHex(12345, { size: 32 }) } : {}) });
    vi.spyOn(s.audit.store, 'quarantineSource').mockImplementation(() => { throw new Error('PRIVATE_SENTINEL disk full'); });
    expect(await s.run({ options: { watch: true, intervalSeconds: 10, discoveryPersistent: false } })).toBe('failed');
    expect(s.reasons).toEqual(['journal']); expect(s.reports[0]).toMatchObject({ status: 'unavailable', worker: { state: 'stopped' } });
  });
  it.each(['plain', 'malformed-head', 'malformed-event', 'wrong-endpoint', 'wrong-chain'] as const)('does not retry global %s failure', async (kind) => {
    const s = await setup();
    if (kind === 'plain') vi.spyOn(s.audit, 'tick').mockRejectedValue(new Error('PRIVATE_SENTINEL timeout'));
    if (kind === 'malformed-head') s.source.getBlock.mockResolvedValue({} as never);
    if (kind === 'malformed-event') s.destinationEvents[0].args = {};
    if (kind === 'wrong-chain') s.clients.source.pub.getChainId.mockResolvedValue(1);
    if (kind === 'wrong-endpoint') {
      s.source.setHead(4200n); const read = s.source.getBlock.getMockImplementation(); if (!read) throw new Error('Fixture unavailable.');
      s.source.getBlock.mockImplementation(async (args) => ({ ...await read(args), ...(args.blockNumber === 4195n ? { number: 4194n } : {}) }));
    }
    expect(await s.run()).toBe('failed'); expect(s.waits).toEqual([]);
    expect(s.reports[0]).toMatchObject({ worker: { state: 'stopped', nextPollSeconds: 0 } });
    expect(s.audit.store.loadDiscovery()).toBeNull(); expect(JSON.stringify(s.reports)).not.toContain('PRIVATE_SENTINEL');
  });
  it('backs off on a typed discovery outage and then recovers with no cursor reset', async () => {
    const s = await setup(); s.destination.getContractEvents.mockRejectedValueOnce(outage()); await s.run();
    expect(s.reasons).toEqual(['rpc-unavailable']); expect(s.waits).toEqual([10]);
    expect(s.reports.map((r) => r.status)).toEqual(['unavailable', 'ok']);
    expect(s.audit.store.sourceProofs()).toHaveLength(1); expect(s.audit.store.loadDiscovery()?.destination.through.number).toBe(201n);
  });
  it('keeps recognized behind-head retry separate from malformed evidence', async () => {
    const s = await setup(); let n = 0;
    await s.run({ emit: (r) => { s.reports.push(r); if (s.reports.length === 3) s.abort.abort(); }, wait: async () => { s.source.setHead(++n === 1 ? 99n : 103n); } });
    expect(s.reasons).toEqual(['rpc-behind']); expect(s.reports.map((r) => r.status)).toEqual(['ok', 'unavailable', 'ok']);
    expect(s.audit.store.loadDiscovery()?.source.through.number).toBe(103n);
  });
  it.each(['receipt-outage', 'receipt-malformed', 'release-outage', 'release-malformed'] as const)('keeps per-payment %s as HOLD/unavailable, without permission', async (kind) => {
    const s = await setup();
    if (kind.startsWith('receipt')) s.f.source.port.getTransactionReceipt = async () => { if (kind.endsWith('outage')) throw outage(); return {}; };
    else {
      const read = s.reader.readVault;
      s.reader.readVault = async (name, ...args) => { if (name === 'releases') { if (kind.endsWith('outage')) throw outage(); return {}; } return read(name, ...args); };
    }
    expect(await s.run({ options: { watch: false, intervalSeconds: 10, discovery: s.starts, discoveryPersistent: true } })).toBe('complete');
    const report = s.reports[0]; if (report.status !== 'ok') throw new Error('Missing successful report.');
    expect(report.enforcement).toBe(false); expect(report.results[0].evidence.status).toBe('unavailable');
    expect(report.results[0].recommendation).toBe('HOLD'); expect(report.results[0].proof).toBeUndefined(); expect(s.reasons).toEqual([]);
  });
  it('rejects contradictory finalized payment state without RPC retry', async () => {
    const s = await setup(); s.facts.approvedPolicyVersion = 2n;
    expect(await s.run()).toBe('failed'); expect(s.reasons).toEqual(['evidence']); expect(s.waits).toEqual([]);
    expect(s.reports[0]).not.toHaveProperty('results'); expect(s.audit.store.loadDiscovery()).toBeNull();
  });
  it('persists quarantine for a changed finalized policy snapshot', async () => {
    const s = await setup(), read = s.reader.readVault, block = s.reader.getBlock; let switched = false;
    s.reader.readVault = async (name, ...args) => { const value = await read(name, ...args); if (name === 'paymentPolicy') switched = true; return value; };
    s.reader.getBlock = async (args) => ({ ...await block(args) as Record<string, unknown>, ...(switched ? { hash: toHex(777, { size: 32 }) } : {}) });
    expect(await s.run()).toBe('failed'); expect(s.reasons).toEqual(['quarantine']); expect(s.waits).toEqual([]);
    expect(s.reports[0]).toMatchObject({ status: 'quarantined', worker: { state: 'stopped' } });
    expect(s.audit.store.sourceQuarantine()).toBeTruthy(); expect(s.audit.store.loadDiscovery()).toBeNull();
  });
  it('does not suppress a journal failure when cancellation arrives in the same operation', async () => {
    const s = await setup(); vi.spyOn(s.audit.store, 'saveSourceProof').mockImplementation(() => { s.abort.abort(); throw outage(); });
    await expect(s.run()).rejects.toMatchObject({ reason: 'journal' }); expect(s.reports).toEqual([]); expect(s.waits).toEqual([]);
    expect(s.audit.store.loadDiscovery()).toBeNull(); expect(s.audit.store.sourceProofs()).toEqual([]);
  });
  it.each(['rpc', 'evidence', 'journal'] as const)('preserves the precise running %s reason and exit code in one-shot CLI', async (kind) => {
    const s = await setup(); s.audit.close();
    const manifest = join(s.dir, 'manifest.json'); writeFileSync(manifest, JSON.stringify(s.manifest, (_k, v: unknown) => typeof v === 'bigint' ? v.toString() : v));
    if (kind === 'rpc') s.destination.getContractEvents.mockRejectedValueOnce(outage());
    if (kind === 'evidence') s.destinationEvents[0].args = {};
    if (kind === 'journal') vi.spyOn(OperatorStore.prototype, 'saveSourceProof').mockImplementationOnce(() => { throw outage(); });
    const reports: unknown[] = [], clients = () => ({ source: s.f.source.port, destination: s.reader, feeds: s.clients });
    const result = await runObserveCommand([manifest, s.path, `--discover-resume=${s.starts.source}:${s.starts.destination}`], new AbortController().signal,
      { clients, output: (r) => { reports.push(r); } });
    expect(result).toMatchObject({ exitCode: kind === 'rpc' ? 75 : 78, diagnostic: { phase: 'running', reason: kind === 'rpc' ? 'rpc-unavailable' : kind, restartable: kind === 'rpc' } });
    expect(reports).toHaveLength(1); expect(reports[0]).toMatchObject({ status: 'unavailable', enforcement: false });
    expect(reports[0]).not.toHaveProperty('results'); expect(JSON.stringify({ result, reports })).not.toContain('PRIVATE_SENTINEL');
  });
  it('reports CLI cleanup failure as terminal journal even after the lease was released', async () => {
    const s = await setup(); s.audit.close();
    const manifest = join(s.dir, 'manifest.json'); writeFileSync(manifest, JSON.stringify(s.manifest, (_k, v: unknown) => typeof v === 'bigint' ? v.toString() : v));
    const close = OperatorStore.prototype.close;
    vi.spyOn(OperatorStore.prototype, 'close').mockImplementationOnce(function (this: OperatorStore) { close.call(this); throw new Error('PRIVATE_SENTINEL close failed'); });
    const clients = () => ({ source: s.f.source.port, destination: s.reader, feeds: s.clients });
    const result = await runObserveCommand([manifest, s.path], new AbortController().signal, { clients, output: () => {} });
    expect(result).toMatchObject({ exitCode: 78, diagnostic: { reason: 'journal', phase: 'cleanup', restartable: false } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
    expect(await runObserveCommand([manifest, s.path], new AbortController().signal, { clients, output: () => {} })).toEqual({ exitCode: 0 });
  });
});
