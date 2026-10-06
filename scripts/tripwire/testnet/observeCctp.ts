// Read finalized USDC escrow state and proof evidence; never authorize or send.
import { readFileSync, writeFileSync, openSync, closeSync, fsyncSync, linkSync, unlinkSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { createCctpAudit } from './cctpAudit.js';
import { pilotManifestSchema } from './cctpManifest.js';
import { cctpPublicClients } from './cctpPublic.js';
import { runCctpObserver } from './cctpObserver.js';
import { archivePublicReports, reportKeepSchema } from './reportArchive.js';

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
async function main() {
  if (process.argv.includes('--help')) { console.log(observeUsage); return; }
  const args = parseObserveArgs(process.argv.slice(2));
  const emit = (value: unknown) => {
    if (args.reportPath) saveObservation(args.reportPath, value);
    else { if (args.reportsDir) saveWatchObservation(args.reportsDir, value, args.keepReports); json(value); }
  };
  const readManifest = () => pilotManifestSchema.parse(JSON.parse(readFileSync(args.manifestPath, 'utf8')));
  const manifest = readManifest();
  if (args.discovery && (manifest.version !== 3 || manifest.requests.length)) throw new Error('Discovery requires an empty customer-payment manifest.');
  const abort = new AbortController(); const stop = () => abort.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let audit: Awaited<ReturnType<typeof createCctpAudit>> | undefined;
  try {
    const clients = cctpPublicClients(manifest, abort.signal);
    audit = await createCctpAudit(manifest, args.statePath ?? resolve(`.tripwire/cctp-${manifest.vault}.sqlite`),
      clients.source, clients.destination, true);
    const outcome = await runCctpObserver({ audit, feeds: clients.feeds, initialManifest: manifest, readManifest,
      options: args, signal: abort.signal, emit });
    if (outcome === 'failed') process.exitCode = 1;
  } finally {
    audit?.close(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch(() => { console.error('CCTP observer failed. Check arguments, manifest, accepted deployment, RPC, journal and public report storage/archive. No transaction was sent.'); process.exitCode = 1; });
}
