// Synthetic accepted deployment and local journals; no credentials or public transactions.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { BaseError, HttpRequestError, TimeoutError } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OBSERVER_NODE_FLAGS } from '../testnet/observerSupervision.js';
import { runObserveCommand } from '../testnet/observeCctp.js';
import { isTransientAuditRpcError } from '../testnet/cctpAuditFailure.js';
import { observerFixture } from './fixtures/cctpObserver.js';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.reverse().forEach((f) => f()); cleanups.length = 0; vi.unstubAllEnvs(); });
function setup() {
  const f = observerFixture(), dir = mkdtempSync(join(tmpdir(), 'tripwire-observer-exit-'));
  cleanups.push(() => rmSync(dir, { force: true, recursive: true }));
  const manifest = join(dir, 'manifest.json'), state = join(dir, 'observer.sqlite');
  writeFileSync(manifest, JSON.stringify(f.manifest, (_k, v: unknown) => typeof v === 'bigint' ? v.toString() : v));
  const reports: unknown[] = [], signal = new AbortController().signal;
  const run = (args: string[] = [manifest, state], output = (r: unknown) => { reports.push(r); }) => runObserveCommand(args, signal, {
    clients: () => ({ source: f.f.source.port, destination: f.reader, feeds: f.clients }), output,
  });
  return { ...f, dir, manifestPath: manifest, state, reports, run };
}
const privateUrl = 'https://rpc.invalid/?credential=REDACTION_SENTINEL';
const outage = (status?: number) => new HttpRequestError({ url: privateUrl, status, details: 'REDACTION_SENTINEL' });
describe('observer process exit contract', () => {
  it.each([[], ['--unknown'], ['missing.json'], ['missing.json', '--interval=4']].map((args) => ({ args })))('classifies invalid startup input as terminal configuration: $args', async ({ args }) => {
    const s = setup(), result = await s.run(args);
    expect(result).toMatchObject({ exitCode: 78, diagnostic: { reason: 'configuration', restartable: false, phase: 'startup' } });
    expect(s.reports).toEqual([]); expect(existsSync(s.state)).toBe(false);
  });
  it('rejects malformed JSON without exporting its content', async () => {
    const s = setup(); writeFileSync(s.manifestPath, 'REDACTION_SENTINEL');
    expect(await s.run()).toMatchObject({ exitCode: 78 }); expect(s.reports).toEqual([]);
  });
  it.each(['', 'not-a-url', 'file:///REDACTION_SENTINEL', 'wss://rpc.invalid/REDACTION_SENTINEL'])('refuses invalid HTTP RPC configuration without network or journal: %s', async (url) => {
    const s = setup(); vi.stubEnv('BASE_SEPOLIA_RPC_URL', url);
    const result = await runObserveCommand([s.manifestPath, s.state], new AbortController().signal);
    expect(result).toMatchObject({ exitCode: 78, diagnostic: { reason: 'configuration' } });
    expect(JSON.stringify(result)).not.toContain('REDACTION_SENTINEL'); expect(existsSync(s.state)).toBe(false);
  });
  it.each([undefined, 408, 429, 500, 503, 599])('allows supervisor retry only for recognized startup transport outage %s', async (status) => {
    const s = setup(); s.f.source.port.getChainId = async () => { throw outage(status); };
    const result = await s.run();
    expect(result).toMatchObject({ exitCode: 75, diagnostic: { reason: 'rpc-unavailable', restartable: true, phase: 'startup' } });
    expect(JSON.stringify(result)).not.toContain('REDACTION_SENTINEL');
    expect(existsSync(s.state)).toBe(false); expect(existsSync(`${s.state}.lease`)).toBe(false);
  });
  it('recognizes a timeout wrapped by viem without inspecting private messages', async () => {
    const s = setup(); s.reader.readCode = async () => { throw new BaseError('REDACTION_SENTINEL', { cause: new TimeoutError({ url: privateUrl, body: {} }) }); };
    expect(await s.run()).toMatchObject({ exitCode: 75 }); expect(existsSync(s.state)).toBe(false);
  });
  it.each([400, 401, 403, 404])('does not restart HTTP configuration/access failure %s', async (status) => {
    const s = setup(); s.reader.readCode = async () => { throw outage(status); };
    const result = await s.run(); expect(result).toMatchObject({ exitCode: 78, diagnostic: { reason: 'deployment', restartable: false } });
    expect(JSON.stringify(result)).not.toContain('REDACTION_SENTINEL'); expect(existsSync(s.state)).toBe(false);
  });
  it('refuses a wrong chain without creating journal or reports', async () => {
    const s = setup(); s.f.source.port.getChainId = async () => 1;
    expect(await s.run()).toMatchObject({ exitCode: 78, diagnostic: { reason: 'deployment' } });
    expect(existsSync(s.state)).toBe(false); expect(s.reports).toEqual([]);
  });
  it('refuses missing/mismatched runtime before opening a journal', async () => {
    const s = setup(); s.reader.readCode = async () => '0x6000';
    expect(await s.run()).toMatchObject({ exitCode: 78, diagnostic: { reason: 'deployment' } });
    expect(existsSync(s.state)).toBe(false); expect(s.reports).toEqual([]);
  });
  it('does not guess that a plain error mentioning RPC is restartable', async () => {
    const s = setup(); s.f.source.port.getChainId = async () => { throw new Error('RPC timeout: REDACTION_SENTINEL'); };
    const result = await s.run(); expect(result).toMatchObject({ exitCode: 70, diagnostic: { reason: 'internal', restartable: false } });
    expect(JSON.stringify(result)).not.toContain('REDACTION_SENTINEL');
  });
  it('treats journal corruption as terminal and leaves the original file intact', async () => {
    const s = setup(); writeFileSync(s.state, 'Synthetic invalid database');
    expect(await s.run()).toMatchObject({ exitCode: 78, diagnostic: { reason: 'journal' } });
    expect(readFileSync(s.state, 'utf8')).toBe('Synthetic invalid database'); expect(s.reports).toEqual([]);
  });
  it('completes, releases its lease and can restart with the same journal', async () => {
    const s = setup(); expect(await s.run()).toEqual({ exitCode: 0 }); expect(await s.run()).toEqual({ exitCode: 0 });
    expect(s.reports).toHaveLength(2);
  });
  it('releases the startup lease after a canonical RPC outage', async () => {
    const s = setup(), args = [s.manifestPath, s.state, `--discover-resume=${s.starts.source}:${s.starts.destination}`];
    expect(await s.run(args)).toEqual({ exitCode: 0 });
    const read = s.f.source.port.getBlock;
    s.f.source.port.getBlock = async () => { throw outage(503); };
    expect(await s.run(args)).toMatchObject({ exitCode: 75 });
    s.f.source.port.getBlock = read;
    expect(await s.run(args)).toEqual({ exitCode: 0 });
  });
  it('keeps persistent quarantine terminal across process-style restarts', async () => {
    const s = setup();
    const { createCctpAudit } = await import('../testnet/cctpAudit.js');
    const audit = await createCctpAudit(s.manifest, s.state, s.f.source.port, s.reader, true);
    audit.store.quarantineSource('Synthetic quarantine REDACTION_SENTINEL'); audit.close();
    for (let i = 0; i < 2; i++) {
      const result = await s.run(); expect(result).toMatchObject({ exitCode: 78, diagnostic: { reason: 'quarantine', restartable: false } });
      expect(JSON.stringify(result)).not.toContain('REDACTION_SENTINEL');
    }
  });
  it('stops on changed runtime during watch without publishing raw error causes', async () => {
    const s = setup();
    const result = await s.run([s.manifestPath, s.state, '--watch', '--interval=5'], (r) => {
      s.reports.push(r); s.reader.readCode = async () => '0x6000';
    });
    expect(result).toMatchObject({ exitCode: 78, diagnostic: { reason: 'deployment', phase: 'running' } });
    expect(s.reports).toHaveLength(2);
    expect(s.reports[1]).toMatchObject({ status: 'unavailable', worker: { state: 'stopped', nextPollSeconds: 0 } });
  }, 15_000);
  it('stops on publication failure after commit, then recovers with the same journal', async () => {
    const s = setup(), args = [s.manifestPath, s.state, `--discover-resume=${s.starts.source}:${s.starts.destination}`];
    expect(await s.run(args, () => { throw new Error('REDACTION_SENTINEL: disk full'); })).toMatchObject({
      exitCode: 74, diagnostic: { reason: 'publication', restartable: false, phase: 'running' },
    });
    expect(await s.run(args)).toEqual({ exitCode: 0 });
    expect(readdirSync(s.dir)).toContain('observer.sqlite');
  });
  it('gives an already aborted command a clean exit without opening state', async () => {
    const s = setup(), abort = new AbortController(); abort.abort();
    expect(await runObserveCommand([s.manifestPath, s.state], abort.signal)).toEqual({ exitCode: 0 });
    expect(existsSync(s.state)).toBe(false);
  });
  it('sets the actual CLI exit code and emits one fixed diagnostic on stderr', () => {
    const s = setup(); writeFileSync(s.manifestPath, 'REDACTION_SENTINEL');
    const child = spawnSync(process.execPath, [...OBSERVER_NODE_FLAGS, 'scripts/tripwire/testnet/observeCctp.ts', s.manifestPath, s.state], { encoding: 'utf8' });
    expect(child.status).toBe(78); expect(child.stdout).toBe('');
    expect(JSON.parse(child.stderr.trim())).toMatchObject({ phase: 'startup', reason: 'configuration', restartable: false });
    expect(child.stderr).not.toContain('REDACTION_SENTINEL'); expect(existsSync(s.state)).toBe(false);
  }, 30_000); // A real Node/tsx process boot.
});
describe('bounded typed RPC classification', () => {
  it('does not accept names or messages impersonating a transport exception', () => {
    const fake = new Error('HTTP timeout'); fake.name = 'TimeoutError'; expect(isTransientAuditRpcError(fake)).toBe(false);
  });
  it('refuses denied HTTP even if an inner cause is a timeout', () => {
    expect(isTransientAuditRpcError(new HttpRequestError({ url: privateUrl, status: 403, cause: new TimeoutError({ url: privateUrl, body: {} }) }))).toBe(false);
  });
  it('terminates on circular and excessive cause chains', () => {
    const cycle = new Error('cycle'); cycle.cause = cycle; expect(isTransientAuditRpcError(cycle)).toBe(false);
    let cause: Error = new TimeoutError({ url: privateUrl, body: {} });
    for (let i = 0; i < 20; i++) cause = new Error('wrapper', { cause });
    expect(isTransientAuditRpcError(cause)).toBe(false);
  });
  it.each([NaN, 500.5, Infinity])('refuses a malformed HTTP status %s', (status) => {
    expect(isTransientAuditRpcError(outage(status))).toBe(false);
  });
});
