// Real observer/audit/store wiring on synthetic fixtures; no live writes or wallets.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toHex, HttpRequestError } from 'viem';
import { createCctpAudit } from '../testnet/cctpAudit.js';
import { runCctpObserver, waitForObservation, type ObserverReport } from '../testnet/cctpObserver.js';
import { parseObserveArgs, saveObservation, saveWatchObservation } from '../testnet/observeCctp.js';
import { FinalityConflictError } from '../finality.js';
import { readOperationsText } from '../../../src/chains/evm/operations.js';
import { stringifyPublic } from '../testnet/cctpPreflight.js';
import { observerFixture } from './fixtures/cctpObserver.js';

const cleanups: (() => void)[] = [];
const rpcOutage = () => new HttpRequestError({ url: 'https://rpc.invalid/?secret=PRIVATE', status: 503 });
afterEach(() => { cleanups.reverse().forEach((f) => f()); cleanups.length = 0; });
async function setup(before?: (f: ReturnType<typeof observerFixture>) => void) {
  const f = observerFixture(); before?.(f);
  const dir = mkdtempSync(join(tmpdir(), 'tripwire-observer-')), path = join(dir, 'observer.sqlite');
  cleanups.push(() => rmSync(dir, { force: true, recursive: true }));
  const open = async () => { const audit = await createCctpAudit(f.manifest, path, f.f.source.port, f.reader, true); cleanups.push(() => audit.close()); return audit; };
  const audit = await open(), abort = new AbortController(), reports: ObserverReport[] = [], delays: number[] = [];
  const run = (extra: Partial<Parameters<typeof runCctpObserver>[0]> = {}) => runCctpObserver({
    audit, feeds: f.clients, initialManifest: f.manifest, readManifest: () => f.manifest,
    options: { watch: true, intervalSeconds: 10, discovery: f.starts, discoveryPersistent: true }, signal: abort.signal,
    emit: (report) => { reports.push(report); if (reports.length === 2) abort.abort(); },
    wait: async (seconds) => { delays.push(seconds); }, now: () => new Date('2026-10-06T12:00:00.000Z'), ...extra,
  });
  return { ...f, dir, path, audit, open, abort, reports, delays, run };
}
describe('continuous keyless CCTP observer', () => {
  it('exports explicit behavioral unavailability with real keyless audit wiring and no signing work', async () => {
    const s = await setup(); await s.run();
    const report = s.reports[0]; if (report.status !== 'ok') throw new Error('Missing synthetic audit.');
    expect(report.results[0].behavioral).toEqual({ version: 1, status: 'unavailable', reason: 'assessment-not-produced' });
    expect(report.results[0].recommendation).toBe('HOLD'); expect(s.audit.store.transactions()).toEqual([]);
    const path = join(s.dir, 'public-behavioral.json'); saveObservation(path, report);
    expect(readOperationsText(readFileSync(path, 'utf8')).payments[0].behavioral).toEqual(report.results[0].behavioral);
    expect(JSON.stringify(report.results[0].behavioral)).not.toMatch(/score|ALLOW|baseline|private/i);
  });
  it('keeps behavioral unavailability on a per-payment state outage instead of copying old data', async () => {
    const s = await setup(), original = s.reader.readVault;
    s.reader.readVault = async (name, ...args) => { if (name === 'releases') throw new Error('Synthetic unavailable state'); return original(name, ...args); };
    await s.run(); const report = s.reports[0]; if (report.status !== 'ok') throw new Error('Missing synthetic audit.');
    const row = readOperationsText(stringifyPublic(report)).payments[0];
    expect(row.evidence).toBe('unavailable'); expect(row.behavioral).toEqual({ version: 1, status: 'unavailable', reason: 'assessment-not-produced' });
    expect(row.amount).toBeUndefined(); expect(row.transactions).toEqual([]); expect(s.audit.store.transactions()).toEqual([]);
  });
  it('audits every sequential idle tick without replaying event ranges', async () => {
    const s = await setup(); expect(await s.run()).toBe('stopped');
    expect(s.reports.map((r) => r.status)).toEqual(['ok', 'ok']); expect(s.reports.map((r) => r.worker?.attempt)).toEqual([1, 2]);
    expect(s.delays).toEqual([10]); expect(s.source.getContractEvents).toHaveBeenCalledTimes(1);
    expect(s.destination.getContractEvents).toHaveBeenCalledTimes(1);
    expect(s.audit.store.sourceProofs()).toHaveLength(1); expect(s.audit.store.transactions()).toEqual([]);
  });
  it('automatically pairs a saved burn when the destination finalizes its later mint', async () => {
    const s = await setup((f) => { f.starts.destination = 198n; f.destination.setHead(199n); });
    await s.run({ wait: async () => { s.destination.setHead(201n); } });
    const [first, second] = s.reports;
    if (first.status !== 'ok' || second.status !== 'ok') throw new Error('Missing successful reports.');
    expect(first.discovery?.pendingSource).toHaveLength(1); expect(first.results).toEqual([]);
    expect(second.results[0].evidence.status).toBe('verified'); expect(second.discovery?.pendingSource).toEqual([]);
    expect(second.discovery?.incremental?.destinationFrom).toBe(200n);
  });
  it('preserves cursors during RPC outage, redacts provider errors, and resumes normally', async () => {
    const s = await setup(); s.destination.getContractEvents.mockRejectedValueOnce(rpcOutage());
    await s.run({ wait: async (seconds) => { s.delays.push(seconds); expect(s.audit.store.loadDiscovery()).toBeNull(); } });
    expect(s.reports[0]).toMatchObject({ status: 'unavailable', worker: { state: 'retrying', consecutiveFailures: 1, nextPollSeconds: 10 } });
    expect(stringifyPublic(s.reports[0])).not.toContain('PRIVATE');
    expect(s.reports[1]).toMatchObject({ status: 'ok', worker: { state: 'scheduled', consecutiveFailures: 0 } });
    expect(s.audit.store.loadDiscovery()?.destination.through.number).toBe(201n);
  });
  it('increases retry delays up to five minutes, resets after recovery and then returns to normal polling', async () => {
    const s = await setup(); let n = 0; const original = s.source.getBlock.getMockImplementation(); if (!original) throw new Error('Fixture missing.');
    s.source.getBlock.mockImplementation(async (args) => { if (args.blockTag === 'finalized' && n++ < 8) throw rpcOutage(); return original(args); });
    await s.run({ emit: (r) => { s.reports.push(r); if (s.reports.length === 10) s.abort.abort(); } });
    expect(s.delays).toEqual([10, 20, 40, 80, 160, 300, 300, 300, 10]);
    expect(s.reports[8].worker).toMatchObject({ state: 'scheduled', consecutiveFailures: 0, nextPollSeconds: 10 });
  });
  it('catches up a large history in subsequent scheduled ticks without cursor jumps', async () => {
    const s = await setup(); s.source.setHead(4200n); await s.run();
    const [first, second] = s.reports; if (first.status !== 'ok' || second.status !== 'ok') throw new Error('Missing reports.');
    expect(first.discovery?.source.through.number).toBe(4195n); expect(first.blockers.join(' ')).toContain('catching up');
    expect(second.discovery?.incremental?.sourceFrom).toBe(4196n); expect(second.discovery?.source.through.number).toBe(4200n);
  });
  it('recovers from a lagging finalized RPC without resetting a saved cursor', async () => {
    const s = await setup(); let waits = 0;
    await s.run({ emit: (r) => { s.reports.push(r); if (s.reports.length === 3) s.abort.abort(); }, wait: async () => { s.source.setHead(++waits === 1 ? 99n : 103n); } });
    expect(s.reports.map((r) => r.status)).toEqual(['ok', 'unavailable', 'ok']); expect(s.audit.store.loadDiscovery()?.source.through.number).toBe(103n);
  });
  it('rechecks receipt evidence rather than reporting cached backing after a per-payment outage', async () => {
    const s = await setup(); await s.run({ wait: async () => { s.f.source.port.getTransactionReceipt = async () => { throw new Error('Offline'); }; } });
    const second = s.reports[1]; if (second.status !== 'ok') throw new Error('Missing report.');
    expect(second.results[0].evidence.status).toBe('unavailable'); expect(second.results[0].proof).toBeUndefined();
    expect(readOperationsText(stringifyPublic(second)).payments[0].transactions).toEqual([]);
  });
  it('refreshes mutable customer policy on every tick', async () => {
    const s = await setup(); await s.run({ wait: async () => { s.facts.paymentsPaused = true; } });
    const second = s.reports[1]; if (second.status !== 'ok') throw new Error('Missing report.');
    expect(second.results[0].payment?.blockers).toContain('paused');
  });
  it.each(['changed-scope', 'manual-requests', 'invalid', 'missing'] as const)('stops on manifest %s without retrying or discarding state', async (kind) => {
    const s = await setup(); let input: unknown = s.manifest;
    await s.run({ readManifest: () => { if (kind === 'missing' && s.reports.length) throw new Error('Missing'); return input; }, wait: async () => {
      input = kind === 'changed-scope' ? { ...s.manifest, operator: s.manifest.vault } : kind === 'manual-requests'
        ? { ...s.manifest, requests: [{ messageId: s.f.release.messageId, proof: s.f.locator }] } : kind === 'invalid' ? {} : s.manifest;
    } });
    expect(s.reports[1]).toMatchObject({ status: 'unavailable', worker: { state: 'stopped', nextPollSeconds: 0 } });
    expect(s.audit.store.loadDiscovery()?.burns).toHaveLength(1); expect(s.source.getContractEvents).toHaveBeenCalledTimes(1);
  });
  it('stops at retained capacity with both old cursors intact', async () => {
    const s = await setup(); await s.run({ wait: async () => {
      s.destination.setHead(203n);
      for (let i = 0; i < 100; i++) s.destinationEvents.push({ ...s.destinationEvents[0], blockNumber: 202n, blockHash: s.destination.block(202n).hash, logIndex: i + 10 });
    } });
    expect(s.reports[1]).toMatchObject({ status: 'unavailable', worker: { state: 'stopped', nextPollSeconds: 0 } });
    expect(s.audit.store.loadDiscovery()?.destination.through.number).toBe(201n);
  });
  it.each(['read', 'write'] as const)('stops on discovery journal %s failure instead of retrying it as an RPC outage', async (kind) => {
    const s = await setup();
    const failure = kind === 'read' ? vi.spyOn(s.audit.store, 'loadDiscovery') : vi.spyOn(s.audit.store, 'saveDiscovery');
    failure.mockImplementation(() => { throw new Error('Disk failure: private local details'); });
    expect(await s.run()).toBe('failed'); expect(s.reports).toHaveLength(1); expect(s.delays).toEqual([]);
    expect(s.reports[0]).toMatchObject({ status: 'unavailable', worker: { state: 'stopped', nextPollSeconds: 0 } });
    expect(stringifyPublic(s.reports[0])).not.toContain('private local details'); failure.mockRestore();
    expect(s.audit.store.loadDiscovery()).toBeNull(); expect(s.audit.store.transactions()).toEqual([]);
  });
  it('preserves the original capacity failure even when the sibling source scan cancels', async () => {
    const s = await setup(); s.source.setHead(250n);
    for (let i = 0; i < 100; i++) s.destinationEvents.push({ ...s.destinationEvents[0], logIndex: i + 10 });
    expect(await s.run()).toBe('failed'); expect(s.reports).toHaveLength(1);
    expect(s.reports[0]).toMatchObject({ worker: { state: 'stopped' } }); expect(s.audit.store.loadDiscovery()).toBeNull();
  });
  it('quarantines a changed saved source block, stops polling and refuses a restarted audit', async () => {
    const s = await setup(); const original = s.source.getBlock.getMockImplementation(); if (!original) throw new Error('Fixture missing.');
    await s.run({ wait: async () => { s.source.getBlock.mockImplementation(async (args) => ({ ...await original(args), ...(args.blockNumber === 100n ? { hash: toHex(999, { size: 32 }) } : {}) })); } });
    expect(s.reports[1]).toMatchObject({ status: 'quarantined', worker: { state: 'stopped', nextPollSeconds: 0 } });
    s.audit.close(); await expect(s.open()).rejects.toThrow('quarantined');
  });
  it('persists quarantine for a finalized conflict raised by the receipt audit', async () => {
    const s = await setup(); vi.spyOn(s.audit, 'tick').mockRejectedValue(new FinalityConflictError('Changed audit block'));
    expect(await s.run()).toBe('failed'); expect(s.audit.store.sourceQuarantine()).toBeTruthy(); expect(s.delays).toEqual([]);
  });
  it('does not overlap another tick while the previous report is being published', async () => {
    const s = await setup(); let release: (() => void) | undefined;
    const barrier = new Promise<void>((done) => { release = done; }), tick = vi.spyOn(s.audit, 'tick');
    const running = s.run({ emit: async (r) => { s.reports.push(r); await barrier; s.abort.abort(); } });
    await vi.waitFor(() => expect(s.reports).toHaveLength(1)); expect(tick).toHaveBeenCalledTimes(1); expect(s.delays).toEqual([]);
    if (!release) throw new Error('Barrier missing.'); release(); await running;
    expect(tick).toHaveBeenCalledTimes(1);
  });
  it.each(['before', 'scan', 'audit', 'wait'] as const)('honors cancellation during %s without another tick/export', async (stage) => {
    const s = await setup(), original = s.audit.tick.bind(s.audit), tick = vi.spyOn(s.audit, 'tick');
    if (stage === 'before') s.abort.abort();
    if (stage === 'scan') s.source.getContractEvents.mockImplementation(async () => { s.abort.abort(); return []; });
    if (stage === 'audit') { tick.mockImplementation(async (m) => { const report = await original(m); s.abort.abort(); return report; }); }
    await s.run({ wait: async () => { s.abort.abort(); } });
    expect(s.reports).toHaveLength(stage === 'wait' ? 1 : 0); expect(tick).toHaveBeenCalledTimes(stage === 'audit' || stage === 'wait' ? 1 : 0);
    if (stage !== 'wait') expect(s.audit.store.loadDiscovery()).toBeNull();
  });
  it('cancels a scheduled wait promptly', async () => {
    const abort = new AbortController(), waiting = waitForObservation(300, abort.signal); abort.abort(); await waiting;
    await waitForObservation(300, abort.signal);
  });
  it('stops on an export failure and resumes the already committed index on a fresh run', async () => {
    const s = await setup(); await expect(s.run({ emit: () => { throw new Error('Disk full'); } })).rejects.toThrow('Disk full');
    expect(s.delays).toEqual([]); expect(s.audit.store.loadDiscovery()?.source.through.number).toBe(101n);
    s.audit.close(); const restarted = await s.open();
    expect(await s.run({ audit: restarted, options: { watch: false, intervalSeconds: 10, discovery: s.starts, discoveryPersistent: true } })).toBe('complete');
    expect(restarted.store.sourceProofs()).toHaveLength(1);
  });
  it('exports success, outage and recovery as distinct complete public snapshots', async () => {
    const s = await setup(), directory = join(s.dir, 'reports'), published: string[] = []; let waits = 0;
    await s.run({ emit: (r) => { s.reports.push(r); published.push(saveWatchObservation(directory, r)); if (s.reports.length === 3) s.abort.abort(); }, wait: async () => {
      if (++waits === 1) s.destination.getContractEvents.mockRejectedValueOnce(rpcOutage());
      s.destination.setHead(201n + BigInt(waits));
    } });
    const files = readdirSync(directory); expect(files).toHaveLength(3); expect(new Set(files).size).toBe(3);
    const views = published.map((path) => readOperationsText(readFileSync(path, 'utf8')));
    expect(views.map((v) => v.kind)).toEqual(['payments', 'unavailable', 'payments']); expect(views[1].payments).toEqual([]);
    for (const file of files) expect(statSync(join(directory, file)).mode & 0o777).toBe(0o600);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
  });
  it('supports manual observation without requiring event discovery', async () => {
    const s = await setup(), manual = { ...s.manifest, requests: [{ messageId: s.f.release.messageId, proof: s.f.locator }] };
    await s.run({ initialManifest: manual, readManifest: () => manual, options: { watch: false, intervalSeconds: 10, discoveryPersistent: false } });
    expect(s.reports[0].status).toBe('ok'); expect(s.audit.store.loadDiscovery()).toBeNull(); expect(s.source.getContractEvents).not.toHaveBeenCalled();
  });
  it('archives older success/outage exports without pruning discovery hints or source claims', async () => {
    const s = await setup(), directory = join(s.dir, 'public-reports'), published: string[] = []; let waits = 0;
    await s.run({ emit: (r) => { s.reports.push(r); published.push(saveWatchObservation(directory, r, 1)); if (s.reports.length === 3) s.abort.abort(); }, wait: async () => {
      if (++waits === 1) s.destination.getContractEvents.mockRejectedValueOnce(rpcOutage());
      s.destination.setHead(201n + BigInt(waits));
    } });
    const archive = join(directory, 'archive'), older = readdirSync(archive);
    expect(older).toHaveLength(2); expect(readdirSync(directory)).toHaveLength(2);
    const views = published.map((p) => readOperationsText(readFileSync(existsSync(p) ? p : join(archive, basename(p)), 'utf8')));
    expect(views.map((v) => v.kind)).toEqual(['payments', 'unavailable', 'payments']);
    expect(s.audit.store.sourceProofs()).toHaveLength(1); expect(s.audit.store.loadDiscovery()?.burns).toHaveLength(1);
    expect(s.audit.store.transactions()).toEqual([]);
  });
  it('stops on archival failure after publication without treating it as an RPC retry', async () => {
    const s = await setup(), directory = join(s.dir, 'public-reports'); mkdirSync(directory);
    writeFileSync(join(directory, 'archive'), 'Synthetic occupied archive path');
    writeFileSync(join(directory, 'observation-1-00000000-0000-0000-0000-000000000001.json'), 'Synthetic old report');
    await expect(s.run({ emit: (r) => { saveWatchObservation(directory, r, 1); } })).rejects.toThrow();
    expect(s.delays).toEqual([]); expect(s.audit.store.loadDiscovery()?.source.through.number).toBe(101n);
    const latest = readdirSync(directory).find((n) => n.startsWith('observation-') && !n.startsWith('observation-1-'));
    expect(latest).toBeDefined(); expect(readOperationsText(readFileSync(join(directory, latest ?? ''), 'utf8')).kind).toBe('payments');
    s.audit.close(); const restarted = await s.open();
    expect(await s.run({ audit: restarted, options: { watch: false, intervalSeconds: 10, discovery: s.starts, discoveryPersistent: true }, emit: () => {} })).toBe('complete');
    expect(restarted.store.sourceProofs()).toHaveLength(1);
  });
  it('refuses unjournaled watch discovery at the runner boundary', async () => {
    const s = await setup(); await expect(s.run({ options: { watch: true, intervalSeconds: 10, discovery: s.starts, discoveryPersistent: false } })).rejects.toThrow();
    expect(s.reports).toEqual([]);
  });
});

describe('watch CLI and atomic public exports', () => {
  it('accepts durable watch discovery, bounded interval and an export directory', () => {
    expect(parseObserveArgs(['manifest.json', 'observer.sqlite', '--discover-resume=100:200', '--watch', '--interval=30', '--reports=reports'])).toMatchObject({ watch: true, intervalSeconds: 30, discoveryPersistent: true, reportsDir: expect.stringContaining('reports') });
  });
  it.each([['--watch', '--report=one.json'], ['--reports=reports'], ['--watch', '--reports=a', '--reports=b'], ['--watch', '--watch'], ['--watch', '--discover=1:2'], ['--watch', '--reports='], ['--watch', '--reports=a', '--report=x.json'], ['--interval=4'], ['--interval=301']])('rejects incompatible flags %j', (...args) => {
    expect(() => parseObserveArgs(['manifest.json', ...args])).toThrow();
  });
  it('publishes without replacing an existing file and removes its own temporary file on failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tripwire-report-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'public.json'); writeFileSync(path, 'Original'); expect(() => saveObservation(path, { amount: 1n })).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('Original'); expect(readdirSync(dir)).toEqual(['public.json']);
    const circular: { self?: unknown } = {}; circular.self = circular;
    expect(() => saveObservation(join(dir, 'bad.json'), circular)).toThrow(); expect(existsSync(join(dir, 'bad.json'))).toBe(false);
    expect(readdirSync(dir)).toEqual(['public.json']);
  });
});
