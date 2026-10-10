// Read finalized USDC escrow state and proof evidence; never authorize or send.
import { readFileSync, writeFileSync, openSync, closeSync, fsyncSync, linkSync, unlinkSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { createCctpAudit } from './cctpAudit.js';
import { parseObserverManifest, type OperatorManifest } from './cctpManifest.js';
import { cctpPublicClients } from './cctpPublic.js';
import { runCctpObserver } from './cctpObserver.js';
import { archivePublicReports, reportKeepSchema } from './reportArchive.js';
import { CctpAuditFailure, retryableAuditFailure, type AuditFailureReason } from '../auditFailure.js';
import { FinalityConflictError } from '../finality.js';

export const observeUsage = 'Usage: npm run tripwire:cctp:observe -- manifest.json [state.sqlite] [--watch] [--interval=10] [--report=new-report.json (one-shot) OR --reports=directory (watch)] [--keep-reports=10..1000 (requires --reports; archives older public files)] [--discover=sourceStart:destinationStart OR --discover-resume=sourceStart:destinationStart (empty manifest v3; only resume supports watch)]';
export function parseObserveArgs(args: string[]) {
  const positional = args.filter((arg) => !arg.startsWith('--'));
  if (positional.length < 1 || positional.length > 2 || args.some((arg) => arg.startsWith('--') && arg !== '--watch' && !/^--interval=\d+$/.test(arg) && !/^--keep-reports=(0|[1-9][0-9]*)$/.test(arg) && !/^--reports?=.+$/.test(arg) && !/^--discover(?:-resume)?=(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/.test(arg))) {
    throw new Error(observeUsage);
  }
  const intervals = args.filter((arg) => arg.startsWith('--interval='));
  if (intervals.length > 1) throw new Error(observeUsage);
  if (args.filter((arg) => arg === '--watch').length > 1) throw new Error(observeUsage);
  const reportDirs = args.filter((arg) => arg.startsWith('--reports='));
  const retention = args.filter((arg) => arg.startsWith('--keep-reports='));
  if (retention.length > 1 || (retention.length && !reportDirs.length)) throw new Error(observeUsage);
  const keepReports = retention[0] ? reportKeepSchema.min(10).parse(Number(retention[0].slice('--keep-reports='.length))) : undefined;
  const reports = args.filter((arg) => arg.startsWith('--report='));
  if (reports.length > 1 || reportDirs.length > 1 || (reports.length && args.includes('--watch')) || (reportDirs.length && !args.includes('--watch')) || (reports.length && reportDirs.length)) throw new Error(observeUsage);
  const discoveries = args.filter((arg) => /^--discover(?:-resume)?=/.test(arg));
  if (discoveries.length > 1 || (discoveries[0]?.startsWith('--discover=') && args.includes('--watch'))) throw new Error(observeUsage);
  const decimal = z.string().max(78).transform(BigInt).refine((n) => n < (1n << 256n));
  const discovery = discoveries[0]?.split('=')[1].split(':');
  const discoveryPersistent = discoveries[0]?.startsWith('--discover-resume=') ?? false;
  const intervalSeconds = z.number().int().min(5).max(300).parse(Number(intervals[0]?.split('=')[1] ?? 10));
  return { manifestPath: resolve(positional[0]), statePath: positional[1] ? resolve(positional[1]) : undefined,
    watch: args.includes('--watch'), intervalSeconds, reportPath: reports[0] ? resolve(reports[0].slice('--report='.length)) : undefined,
    reportsDir: reportDirs[0] ? resolve(reportDirs[0].slice('--reports='.length)) : undefined, keepReports,
    discoveryPersistent, discovery: discovery ? { source: decimal.parse(discovery[0]), destination: decimal.parse(discovery[1]) } : undefined };
}
const json = (value: unknown) => console.log(JSON.stringify(value, (_k, v: unknown) => typeof v === 'bigint' ? v.toString() : v));
export function saveObservation(path: string, value: unknown) {
  const temp = `${path}.partial-${randomUUID()}`;
  const fd = openSync(temp, 'wx', 0o600);
  try {
    try {
      writeFileSync(fd, `${JSON.stringify(value, (_key, v: unknown) => typeof v === 'bigint' ? v.toString() : v, 2)}\n`);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    linkSync(temp, path); // Atomic publication with no overwrite, even on a name collision.
  } finally { unlinkSync(temp); }
}
export function saveWatchObservation(directory: string, value: unknown, keepReports?: number): string {
  if (keepReports !== undefined) reportKeepSchema.parse(keepReports);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `observation-${Date.now()}-${randomUUID()}.json`);
  saveObservation(path, value);
  if (keepReports !== undefined) archivePublicReports(directory, path, keepReports);
  return path;
}
type ExitReason = AuditFailureReason | 'publication' | 'observation-stopped' | 'observation-unavailable';
type ExitPhase = 'startup' | 'running' | 'cleanup';
type ObserverClients = { source: Parameters<typeof createCctpAudit>[2]; destination: Parameters<typeof createCctpAudit>[3];
  feeds: Parameters<typeof runCctpObserver>[0]['feeds'] };
export interface ObserverExit {
  exitCode: 0 | 70 | 74 | 75 | 78;
  diagnostic?: { version: 1; mode: 'observe'; enforcement: false; phase: ExitPhase; reason: ExitReason; restartable: boolean };
}
function failedExit(reason: ExitReason, phase: ExitPhase): ObserverExit {
  const exitCode = reason === 'rpc-unavailable' || reason === 'rpc-behind' ? 75 : reason === 'publication' ? 74
    : reason === 'internal' || reason === 'observation-unavailable' ? 70 : 78;
  return { exitCode, diagnostic: { version: 1, mode: 'observe', enforcement: false, phase, reason, restartable: exitCode === 75 } };
}
export async function runObserveCommand(argv: string[], signal: AbortSignal, ports: {
  clients?: (manifest: OperatorManifest, signal: AbortSignal) => ObserverClients;
  output?: (value: unknown) => void;
} = {}): Promise<ObserverExit> {
  if (signal.aborted) return { exitCode: 0 };
  let args: ReturnType<typeof parseObserveArgs>, manifest: OperatorManifest;
  let readManifest: () => typeof manifest;
  try {
    args = parseObserveArgs(argv);
    readManifest = () => parseObserverManifest(JSON.parse(readFileSync(args.manifestPath, 'utf8')));
    manifest = readManifest();
    if (args.discovery && ((manifest.version !== 3 && manifest.version !== 4) || manifest.requests.length)) return failedExit('configuration', 'startup');
  } catch { return failedExit('configuration', 'startup'); }
  let failure: ObserverExit | undefined;
  const emit = (value: unknown) => {
    try {
      if (args.reportPath) saveObservation(args.reportPath, value);
      else { if (args.reportsDir) saveWatchObservation(args.reportsDir, value, args.keepReports); (ports.output ?? json)(value); }
    } catch (error) { failure = failedExit('publication', 'running'); throw error; }
  };
  let audit: Awaited<ReturnType<typeof createCctpAudit>> | undefined;
  let phase: ExitPhase = 'startup';
  try {
    let clients: ObserverClients;
    try { clients = (ports.clients ?? cctpPublicClients)(manifest, signal); }
    catch { return failedExit('configuration', phase); }
    audit = await createCctpAudit(manifest, args.statePath ?? resolve(`.tripwire/cctp-${manifest.vault}.sqlite`),
      clients.source, clients.destination, true);
    phase = 'running';
    let observedFailure: AuditFailureReason | undefined;
    const outcome = await runCctpObserver({ audit, feeds: clients.feeds, initialManifest: manifest, readManifest,
      options: args, signal, emit, onFailure: (reason) => { observedFailure = reason; } });
    if (outcome === 'failed') failure = failedExit(observedFailure ?? (args.watch ? 'observation-stopped' : 'observation-unavailable'), phase);
  } catch (error) {
    // Signal cancellation is clean, except storage/publication failures still need reconciliation.
    const terminal = error instanceof CctpAuditFailure && !retryableAuditFailure(error.reason);
    failure ??= signal.aborted && !terminal ? undefined : failedExit(error instanceof CctpAuditFailure ? error.reason
      : error instanceof FinalityConflictError ? 'quarantine' : 'internal', phase);
  } finally {
    try { audit?.close(); } catch { failure = failedExit('journal', 'cleanup'); }
  }
  return failure ?? { exitCode: 0 };
}
async function main() {
  if (process.argv.slice(2).includes('--help')) { console.log(observeUsage); return; }
  const abort = new AbortController(), stop = () => abort.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const result = await runObserveCommand(process.argv.slice(2), abort.signal);
    if (result.diagnostic) console.error(JSON.stringify(result.diagnostic));
    process.exitCode = result.exitCode;
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch(() => { console.error(JSON.stringify(failedExit('internal', 'cleanup').diagnostic)); process.exitCode = 70; });
}
