import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { observerFixture } from './fixtures/cctpObserver.js';
import { resolveSupervisionConfig, observerArguments, observerEnvironment, restartAllowed, superviseObserver, type ProcessEvent } from '../testnet/observerSupervision.js';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.reverse().forEach((f) => f()); cleanup.length = 0; });
function config(value: Record<string, unknown> = {}) {
  return resolveSupervisionConfig({ version: 1, manifest: 'manifest.json', journal: 'observer.sqlite', reports: 'public', incidents: 'incidents', ...value }, '/tmp/synthetic');
}
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'tripwire-supervised-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const c = resolveSupervisionConfig({ version: 1, manifest: 'manifest.json', journal: 'observer.sqlite', reports: 'public', incidents: 'incidents',
    discovery: '100:200', restartOnCrash: true }, directory);
  const f = observerFixture(), encode = (v: unknown) => JSON.stringify(v, (_k, value: unknown) => typeof value === 'bigint' ? { $bigint: String(value) } : value);
  if (!f.reader.readCode) throw new Error('Synthetic code reader is required.');
  writeFileSync(c.manifest, JSON.stringify(f.manifest, (_k, v: unknown) => typeof v === 'bigint' ? String(v) : v));
  writeFileSync(join(directory, 'rpc.json'), encode({ sourceReceipt: f.f.sourceReceipt, destinationReceipt: f.f.destinationReceipt,
    sourceBlocks: [f.source.block(99n), f.source.block(100n), f.source.block(101n)],
    destinationBlocks: [f.destination.block(199n), f.destination.block(200n), f.destination.block(201n)],
    sourceEvents: f.sourceEvents, destinationEvents: f.destinationEvents, facts: f.facts,
    guardianFacts: { owner: f.manifest.vault, oracle: f.manifest.operator, GUARDIAN_POLICY_VERSION: 4n, isProtected: true,
      currentTier: 0, getRoute: { windowSeconds: 3600n, cap: 10_000_000n, tierExpiresAt: 0n } },
    vault: f.manifest.vault, guardian: f.manifest.guardian, vaultCode: await f.reader.readCode(f.manifest.vault, 201n), guardianCode: await f.reader.readCode(f.manifest.guardian, 201n) }));
  const events: ProcessEvent[] = [], children: ReturnType<typeof spawn>[] = [], waits: number[] = [];
  cleanup.push(() => { children.forEach((child) => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }); });
  const run = (scenario: string, signal = new AbortController().signal, overrides: Partial<typeof c> = {}) => superviseObserver({ ...c, ...overrides }, signal, {
    record: (e) => events.push(e), check: () => {}, checkMs: 20, graceMs: 1000,
    wait: async (s, abort) => { waits.push(s); if (abort.aborted) return; },
    launch: () => {
      expect(children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true);
      const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/tripwire/__tests__/fixtures/observerChild.ts', directory, scenario, ...observerArguments(c)],
        { stdio: ['ignore', 'ignore', 'pipe'], env: observerEnvironment(process.env) });
      children.push(child); return child;
    },
  });
  const state = () => {
    const db = new DatabaseSync(c.journal, { readOnly: true });
    try { return { proofs: db.prepare('SELECT COUNT(*) AS count FROM source_proofs').get()?.count,
      discovery: String(db.prepare("SELECT value FROM state WHERE key='discovery'").get()?.value) }; }
    finally { db.close(); }
  };
  return { directory, c, f, events, children, waits, run, state };
}
describe('bounded observer supervision policy', () => {
  it.each([0, 1, 70, 74, 78, 99])('never restarts exit %s, even with crash policy', (code) => {
    expect(restartAllowed(code, null, true)).toBe(false);
  });
  it('only retries 75 or explicitly enabled fatal crash signals', () => {
    expect(restartAllowed(75, null, false)).toBe(true);
    for (const s of ['SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGBUS']) {
      expect(restartAllowed(null, s, true)).toBe(true); expect(restartAllowed(null, s, false)).toBe(false);
    }
    for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP', null]) expect(restartAllowed(null, s, true)).toBe(false);
  });
  it.each([{ maxRestarts: 11 }, { maxRestarts: -1 }, { backoffSeconds: 0 }, { backoffSeconds: 30, maxBackoffSeconds: 10 },
    { restartOnCrash: 'yes' }, { command: 'arbitrary' }, { discovery: '01:200' }, { discovery: `${1n << 256n}:200` },
    { reports: 'incidents/sub' }, { reports: '.' }, { journal: 'public/journal.sqlite' }, { manifest: 'incidents/manifest' }, { manifest: 'observer.sqlite' }])('refuses invalid or overlapping configuration %j', (v) => {
    expect(() => config(v)).toThrow();
  });
  it('resolves paths relative to configuration and strips inherited key/loader environment', () => {
    expect(config().journal).toBe('/tmp/synthetic/observer.sqlite');
    expect(observerEnvironment({ PATH: '/usr/bin', SEPOLIA_RPC_URL: 'https://rpc.invalid', ORACLE_PRIVATE_KEY: 'REDACTION_SENTINEL', NODE_OPTIONS: '--import evil', HOME: '/private' }))
      .toEqual({ PATH: '/usr/bin', SEPOLIA_RPC_URL: 'https://rpc.invalid' });
  });
});
describe('actual child process recovery with synthetic receipts and the same journal', () => {
  it.each(['rpc-outage', 'crash-before-publication', 'crash-after-publication'])('recovers %s without duplicate proofs or cursor reset', async (scenario) => {
    const s = await setup(); expect(await s.run(scenario)).toEqual({ exitCode: 0, attempts: 2 });
    expect(s.waits).toEqual([10]); expect(s.state().proofs).toBe(1);
    const discovery = JSON.parse(s.state().discovery);
    expect(discovery.source.through.number).toBe('101'); expect(discovery.destination.through.number).toBe('201');
    expect(discovery.burns).toHaveLength(1); expect(discovery.credits).toHaveLength(1);
    expect(s.children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true);
    expect(JSON.stringify(s.events)).not.toContain('REDACTION_SENTINEL');
    // A fresh process proves the exclusive journal lease was released.
    expect(await s.run('complete')).toEqual({ exitCode: 0, attempts: 1 }); expect(s.state().proofs).toBe(1);
  }, 15_000);
  it('does not restart a crash unless explicitly enabled', async () => {
    const s = await setup(); expect(await s.run('crash-after-publication', undefined, { restartOnCrash: false })).toEqual({ exitCode: 78, attempts: 1 });
    expect(s.waits).toEqual([]); expect(s.state().proofs).toBe(1);
  });
  it('keeps a post-commit journal error terminal and recovers only on a new manual run', async () => {
    const s = await setup(); expect(await s.run('journal-after-commit')).toEqual({ exitCode: 78, attempts: 1 });
    expect(s.events).toContainEqual(expect.objectContaining({ event: 'exited', reason: 'journal', exitCode: 78 }));
    const committed = s.state(); expect(committed.proofs).toBe(1);
    expect(await s.run('complete')).toEqual({ exitCode: 0, attempts: 1 }); expect(s.state()).toEqual(committed);
  });
  it('preserves quarantine and refuses it on every subsequent process without restarting or clearing state', async () => {
    const s = await setup();
    expect(await s.run('quarantine')).toEqual({ exitCode: 78, attempts: 1 });
    expect(await s.run('complete')).toEqual({ exitCode: 78, attempts: 1 });
    expect(s.waits).toEqual([]);
    expect(s.events.filter((e) => e.event === 'exited').every((e) => e.reason === 'quarantine')).toBe(true);
    expect(JSON.stringify(s.events)).not.toContain('REDACTION_SENTINEL');
  });
  it.each(['before', 'after'])('does not retry publication/archive failure %s publication; preserves the committed journal', async (when) => {
    const s = await setup();
    if (when === 'before') writeFileSync(s.c.reports, 'Synthetic path conflict');
    else {
      mkdirSync(s.c.reports);
      for (let i = 0; i < 11; i++) writeFileSync(join(s.c.reports, `observation-${i}-00000000-0000-0000-0000-000000000001.json`), '{}');
      writeFileSync(join(s.c.reports, 'archive'), 'Synthetic archive conflict');
      s.c.keepReports = 10;
    }
    expect(await s.run('complete')).toEqual({ exitCode: 74, attempts: 1 }); expect(s.waits).toEqual([]);
    const committed = s.state(); expect(committed.proofs).toBe(1);
    if (when === 'before') rmSync(s.c.reports); else {
      expect(readdirSync(s.c.reports).filter((f) => f.startsWith('observation-'))).toHaveLength(12);
      rmSync(join(s.c.reports, 'archive'));
    }
    expect(await s.run('complete')).toEqual({ exitCode: 0, attempts: 1 }); expect(s.state()).toEqual(committed);
  });
  it('forwards SIGTERM, waits for cleanup, stops cleanly and allows a fresh same-journal process', async () => {
    const s = await setup(), abort = new AbortController();
    const pending = s.run('wait-for-signal', abort.signal);
    for (let i = 0; i < 500 && !existsSync(join(s.directory, 'published.txt')); i++) await new Promise((r) => setTimeout(r, 10));
    expect(existsSync(join(s.directory, 'published.txt'))).toBe(true); abort.abort();
    expect(await pending).toEqual({ exitCode: 0, attempts: 1 }); expect(s.waits).toEqual([]);
    expect(await s.run('complete')).toEqual({ exitCode: 0, attempts: 1 }); expect(s.state().proofs).toBe(1);
  }, 15_000);
  it('exhausts a finite restart budget without resetting it on each child launch', async () => {
    const c = config({ maxRestarts: 3, backoffSeconds: 10, maxBackoffSeconds: 25 }), waits: number[] = [], events: ProcessEvent[] = [];
    expect(await superviseObserver(c, new AbortController().signal, { record: (e) => events.push(e), check: () => {},
      wait: async (s) => { waits.push(s); }, launch: () => spawn(process.execPath, ['-e', 'process.exitCode=75'], { stdio: ['ignore', 'ignore', 'pipe'] }),
    })).toEqual({ exitCode: 78, attempts: 4 });
    expect(waits).toEqual([10, 20, 25]); expect(events.at(-1)?.event).toBe('restart-exhausted');
  });
  it('uses a real backoff wait before restarting, and cancellation interrupts that wait', async () => {
    const abort = new AbortController(), waits: ProcessEvent[] = [];
    const start = Date.now();
    const result = await superviseObserver(config({ maxRestarts: 1, backoffSeconds: 1 }), abort.signal, {
      record: (e) => { waits.push(e); if (e.event === 'restart-scheduled') setTimeout(() => abort.abort(), 50); },
      check: () => {}, launch: () => spawn(process.execPath, ['-e', 'process.exitCode=75'], { stdio: ['ignore', 'ignore', 'pipe'] }),
    });
    expect(result).toEqual({ exitCode: 0, attempts: 1 });
    expect(Date.now() - start).toBeLessThan(1000); expect(waits.at(-1)).toMatchObject({ event: 'restart-scheduled', delaySeconds: 1 });
  });
  it('enforces the configured minimum delay between real child launches', async () => {
    let launches = 0; const start = Date.now();
    expect(await superviseObserver(config({ maxRestarts: 1, backoffSeconds: 1 }), new AbortController().signal, { record: () => {}, check: () => {},
      launch: () => spawn(process.execPath, ['-e', `process.exitCode=${++launches === 1 ? 75 : 0}`], { stdio: ['ignore', 'ignore', 'pipe'] }),
    })).toEqual({ exitCode: 0, attempts: 2 }); expect(Date.now() - start).toBeGreaterThanOrEqual(1000);
  });
  it('stops and waits for the child if local incident recording fails', async () => {
    let child: ReturnType<typeof spawn> | undefined;
    await expect(superviseObserver(config(), new AbortController().signal, { record: () => {},
      check: () => { throw new Error('Synthetic disk failure REDACTION_SENTINEL'); }, graceMs: 50,
      launch: () => { child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: ['ignore', 'ignore', 'pipe'] }); return child; },
    })).rejects.toThrow('Synthetic disk failure');
    expect(child?.signalCode).toBe('SIGTERM');
  });
  it('forces a non-responsive child to stop after grace and requires manual reconciliation', async () => {
    const abort = new AbortController(), events: ProcessEvent[] = [];
    const result = await superviseObserver(config({ restartOnCrash: true }), abort.signal, { record: (e) => events.push(e), check: () => {}, graceMs: 50,
      launch: () => {
        const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); console.error('ready'); setInterval(()=>{},1000)"], { stdio: ['ignore', 'ignore', 'pipe'] });
        child.stderr.on('data', () => abort.abort()); return child;
      },
    });
    expect(result).toEqual({ exitCode: 78, attempts: 1 }); expect(events.some((e) => e.event === 'stop-timeout')).toBe(true);
    expect(events.some((e) => e.event === 'restart-scheduled')).toBe(false);
  });
  it('treats spawn errors as terminal and does not export the executable path', async () => {
    const events: ProcessEvent[] = [];
    expect(await superviseObserver(config(), new AbortController().signal, { record: (e) => events.push(e), check: () => {},
      launch: () => spawn('/synthetic/REDACTION_SENTINEL/missing', [], { stdio: ['ignore', 'ignore', 'pipe'] }),
    })).toEqual({ exitCode: 70, attempts: 1 }); expect(JSON.stringify(events)).not.toContain('REDACTION_SENTINEL');
  });
  it('ignores raw oversized stderr and diagnostic objects that disagree with the actual exit', async () => {
    const events: ProcessEvent[] = [];
    const code = "console.error('REDACTION_SENTINEL'.repeat(1000)); console.error(JSON.stringify({version:1,mode:'observe',enforcement:false,phase:'startup',reason:'rpc-unavailable',restartable:true})); process.exitCode=78";
    expect(await superviseObserver(config(), new AbortController().signal, { record: (e) => events.push(e), check: () => {},
      launch: () => spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'ignore', 'pipe'] }),
    })).toEqual({ exitCode: 78, attempts: 1 }); expect(events.at(-1)?.reason).toBeUndefined(); expect(JSON.stringify(events)).not.toContain('REDACTION_SENTINEL');
  });
  it.each([0, 70, 74, 78])('propagates actual child exit %s without a restart', async (code) => {
    const events: ProcessEvent[] = [];
    expect(await superviseObserver(config(), new AbortController().signal, { record: (e) => events.push(e), check: () => {},
      launch: () => spawn(process.execPath, ['-e', `process.exitCode=${code}`], { stdio: ['ignore', 'ignore', 'pipe'] }) })).toEqual({ exitCode: code, attempts: 1 });
    expect(events.some((e) => e.event === 'restart-scheduled')).toBe(false);
  });
  it('actual supervisor CLI preserves terminal configuration code and redacts malformed input', async () => {
    const s = await setup(); const file = join(s.directory, 'supervisor.json'); writeFileSync(file, 'REDACTION_SENTINEL');
    const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/tripwire/testnet/superviseCctp.ts', file], { encoding: 'utf8' });
    expect(child.status).toBe(78); expect(child.stdout).toBe(''); expect(child.stderr).not.toContain('REDACTION_SENTINEL');
    expect(JSON.parse(child.stderr.split('\n').find((l) => l.startsWith('{')) ?? '{}')).toMatchObject({ reason: 'configuration' });
  });
  it('actual CLI records process incidents, preserves observer exit 78 and releases its supervisor lease', async () => {
    const s = await setup(), file = join(s.directory, 'supervisor.json');
    writeFileSync(s.c.manifest, 'REDACTION_SENTINEL'); writeFileSync(file, JSON.stringify(s.c));
    for (let i = 0; i < 2; i++) {
      const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/tripwire/testnet/superviseCctp.ts', file], { encoding: 'utf8' });
      expect(child.status).toBe(78); expect(child.stdout + child.stderr).not.toContain('REDACTION_SENTINEL');
      const events = child.stdout.trim().split('\n').map((line) => JSON.parse(line));
      expect(events.at(-1)).toMatchObject({ event: 'exited', exitCode: 78, reason: 'configuration' });
      expect(events.some((e) => e.event === 'restart-scheduled')).toBe(false);
    }
    const incidents = readdirSync(s.c.incidents).filter((name) => name.startsWith('incident-'));
    expect(incidents).toHaveLength(6); expect(incidents.every((name) => !readFileSync(join(s.c.incidents, name), 'utf8').includes('REDACTION_SENTINEL'))).toBe(true);
    expect(existsSync(s.c.journal)).toBe(false);
  });
  it('actual CLI refuses an already-owned supervisor lease before launching a child', async () => {
    const s = await setup(), file = join(s.directory, 'supervisor.json'); writeFileSync(file, JSON.stringify(s.c));
    mkdirSync(s.c.incidents); const lease = new DatabaseSync(join(s.c.incidents, 'supervisor.lease'));
    try {
      lease.exec('BEGIN EXCLUSIVE');
      const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/tripwire/testnet/superviseCctp.ts', file], { encoding: 'utf8' });
      expect(child.status).toBe(78); expect(child.stdout).toBe('');
      expect(child.stderr).toContain('"reason":"journal"'); expect(existsSync(s.c.journal)).toBe(false);
    } finally { lease.close(); }
  });
});
