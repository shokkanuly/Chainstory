// Standalone keyless process control; no shell, sender, key loader or backend.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, lstatSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { waitForObservation } from './cctpObserver.js';
import { parseObserveArgs } from './observeCctp.js';

const path = z.string().min(1).max(4096);
const seconds = z.number().int().min(1).max(300);
export const supervisionConfigSchema = z.object({
  version: z.literal(1), manifest: path, journal: path, reports: path, incidents: path,
  intervalSeconds: z.number().int().min(5).max(300).default(10),
  keepReports: z.number().int().min(10).max(1000).default(500),
  discovery: z.string().regex(/^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/).optional(),
  maxRestarts: z.number().int().min(0).max(10).default(3),
  restartOnCrash: z.boolean().default(false),
  backoffSeconds: seconds.default(10), maxBackoffSeconds: seconds.default(300),
  stopGraceSeconds: seconds.default(30),
  checkSeconds: z.number().int().min(1).max(60).default(5),
  staleSeconds: z.number().int().min(30).max(3600).default(300),
}).strict().refine((c) => c.backoffSeconds <= c.maxBackoffSeconds);
export type SupervisionConfig = z.output<typeof supervisionConfigSchema>;

function within(parent: string, child: string) {
  const r = relative(parent, child); return !r || (r !== '..' && !r.startsWith('../') && !isAbsolute(r));
}
export function resolveSupervisionConfig(value: unknown, base: string): SupervisionConfig {
  const c = supervisionConfigSchema.parse(value);
  const config = { ...c, ...Object.fromEntries((['manifest', 'journal', 'reports', 'incidents'] as const).map((k) => [k, resolve(base, c[k])])) };
  if (within(config.reports, config.incidents) || within(config.incidents, config.reports) ||
    [config.manifest, config.journal, `${config.journal}.lease`].some((p) => within(config.reports, p) || within(config.incidents, p)) ||
    config.manifest === config.journal || config.manifest === `${config.journal}.lease`) throw new Error('Invalid supervision paths.');
  parseObserveArgs(observerArguments(config)); // Reuse the observer's exact discovery/argument bounds.
  return config;
}
export function observerArguments(c: SupervisionConfig): string[] {
  return [c.manifest, c.journal, '--watch', `--interval=${c.intervalSeconds}`, `--reports=${c.reports}`,
    `--keep-reports=${c.keepReports}`, ...(c.discovery ? [`--discover-resume=${c.discovery}`] : [])];
}
export function observerEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // RPC credentials can be used by the child but never copied into incident data.
  return Object.fromEntries(['PATH', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'BASE_SEPOLIA_RPC_URL', 'SEPOLIA_RPC_URL']
    .filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));
}
const reasons = z.enum(['configuration', 'deployment', 'journal', 'quarantine', 'rpc-unavailable', 'rpc-behind',
  'scope', 'capacity', 'evidence', 'internal', 'publication', 'observation-stopped', 'observation-unavailable']);
const diagnosticSchema = z.object({ version: z.literal(1), mode: z.literal('observe'), enforcement: z.literal(false),
  phase: z.enum(['startup', 'running', 'cleanup']), reason: reasons, restartable: z.boolean() }).strict();
type Diagnostic = z.infer<typeof diagnosticSchema>;
export const crashSignals = ['SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGBUS'] as const;
export function restartAllowed(code: number | null, signal: string | null, crashPolicy: boolean): boolean {
  return code === 75 || (code === null && crashPolicy && crashSignals.some((s) => s === signal));
}
export type ProcessEvent = { kind: 'process'; event: 'starting' | 'exited' | 'restart-scheduled' | 'restart-exhausted' | 'stopping' | 'stop-timeout' | 'spawn-failed';
  attempt: number; exitCode?: number; signal?: string; reason?: Diagnostic['reason']; delaySeconds?: number };
export type SupervisorResult = { exitCode: number; attempts: number };
type ChildResult = { code: number | null; signal: NodeJS.Signals | null; diagnostic?: Diagnostic; spawnFailed: boolean; forced: boolean };

export async function superviseObserver(config: SupervisionConfig, signal: AbortSignal, ports: {
  record(event: ProcessEvent): void;
  check(): void;
  launch?(): ChildProcess; // Test-only process port. The CLI always uses the fixed observer entrypoint.
  wait?: typeof waitForObservation;
  checkMs?: number; graceMs?: number;
}): Promise<SupervisorResult> {
  let attempts = 0;
  const record = ports.record, wait = ports.wait ?? waitForObservation;
  const launch = ports.launch ?? (() => spawn(process.execPath,
    ['--import', 'tsx', fileURLToPath(new URL('./observeCctp.ts', import.meta.url)), ...observerArguments(config)], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)), shell: false,
      env: observerEnvironment(process.env), stdio: ['ignore', 'ignore', 'pipe'],
    }));
  while (!signal.aborted) {
    attempts++; record({ kind: 'process', event: 'starting', attempt: attempts });
    if (signal.aborted) return { exitCode: 0, attempts: attempts - 1 };
    let child: ChildProcess;
    try { child = launch(); }
    catch { record({ kind: 'process', event: 'spawn-failed', attempt: attempts }); return { exitCode: 70, attempts }; }
    const result = await new Promise<ChildResult>((done, reject) => {
      let diagnostic: Diagnostic | undefined, pending = '', dropping = false;
      let spawnFailed = false, forced = false, localFailure: unknown, hasLocalFailure = false, stopping = false;
      let grace: ReturnType<typeof setTimeout> | undefined;
      const safeRecord = (event: ProcessEvent) => { try { record(event); } catch (error) { localFailure = error; hasLocalFailure = true; } };
      const stop = () => {
        if (stopping || child.exitCode !== null || child.signalCode !== null) return;
        stopping = true; safeRecord({ kind: 'process', event: 'stopping', attempt: attempts });
        child.kill('SIGTERM');
        grace = setTimeout(() => {
          forced = true; safeRecord({ kind: 'process', event: 'stop-timeout', attempt: attempts }); child.kill('SIGKILL');
        }, ports.graceMs ?? config.stopGraceSeconds * 1000);
      };
      const check = () => { try { ports.check(); } catch (error) { localFailure = error; hasLocalFailure = true; stop(); } };
      // Inspect only bounded fixed diagnostics. Discard raw warnings, stacks and URLs.
      const parseLine = (line: string) => {
        try { const parsed = diagnosticSchema.safeParse(JSON.parse(line)); if (parsed.success) diagnostic = parsed.data; } catch { /* raw stderr is deliberately discarded */ }
      };
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        for (const part of chunk.split(/(?<=\n)/)) {
          if (!dropping && pending.length + part.length <= 8192) pending += part; else dropping = true;
          if (part.endsWith('\n')) { if (!dropping) parseLine(pending); pending = ''; dropping = false; }
        }
      });
      child.once('error', () => { spawnFailed = true; });
      // close occurs after exit AND all stdio handles close; never launch a sibling early.
      child.once('close', (code, exitSignal) => {
        clearInterval(timer); if (grace) clearTimeout(grace); signal.removeEventListener('abort', stop);
        if (pending && !dropping) parseLine(pending);
        if (hasLocalFailure) reject(localFailure);
        else done({ code, signal: exitSignal, diagnostic, spawnFailed, forced });
      });
      const timer = setInterval(check, ports.checkMs ?? config.checkSeconds * 1000);
      signal.addEventListener('abort', stop, { once: true });
      check(); if (signal.aborted) stop();
    });
    ports.check();
    // A reason is retained only when it agrees with the actual process exit contract.
    const d = result.diagnostic;
    const reasonCode = d?.reason === 'rpc-unavailable' || d?.reason === 'rpc-behind' ? 75
      : d?.reason === 'publication' ? 74 : d?.reason === 'internal' || d?.reason === 'observation-unavailable' ? 70 : 78;
    const reason = d && reasonCode === result.code && d.restartable === (result.code === 75) ? d.reason : undefined;
    record({ kind: 'process', event: result.spawnFailed ? 'spawn-failed' : 'exited', attempt: attempts,
      ...(result.code !== null ? { exitCode: result.code } : {}),
      ...(crashSignals.some((s) => s === result.signal) || result.signal === 'SIGTERM' || result.signal === 'SIGINT' ? { signal: result.signal ?? undefined } : {}),
      ...(reason ? { reason } : {}) });
    if (result.forced) return { exitCode: 78, attempts };
    if (result.spawnFailed) return { exitCode: 70, attempts };
    if (result.code === 0) return { exitCode: 0, attempts };
    if (signal.aborted) return { exitCode: result.code ?? 78, attempts };
    if (!restartAllowed(result.code, result.signal, config.restartOnCrash)) return { exitCode: result.code ?? 78, attempts };
    if (attempts > config.maxRestarts) {
      record({ kind: 'process', event: 'restart-exhausted', attempt: attempts }); return { exitCode: 78, attempts };
    }
    const delaySeconds = Math.min(config.maxBackoffSeconds, config.backoffSeconds * 2 ** (attempts - 1));
    record({ kind: 'process', event: 'restart-scheduled', attempt: attempts, delaySeconds });
    await wait(delaySeconds, signal);
  }
  return { exitCode: 0, attempts };
}

export function prepareLocalDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (!lstatSync(path).isDirectory()) throw new Error('A real local directory is required.');
}
