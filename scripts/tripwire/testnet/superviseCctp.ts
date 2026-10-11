// Foreground repo supervisor. Installing a daemon or external alerts is separate work.
import { chmodSync, closeSync, fstatSync, openSync, readFileSync, constants, lstatSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname, join } from 'node:path';
import { createReportMonitor, recordReportTransitions, type ReportHealth } from './observerIncidents.js';
import { prepareLocalDirectory, resolveSupervisionConfig, superviseObserver, type ProcessEvent } from './observerSupervision.js';
import { saveObservation } from './observeCctp.js';

export const superviseUsage = 'Usage: npm run tripwire:cctp:supervise -- supervisor.json';
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log(superviseUsage); return; }
  let config: ReturnType<typeof resolveSupervisionConfig>;
  try {
    if (args.length !== 1 || args[0].startsWith('--')) throw new Error('Invalid args.');
    const file = resolve(args[0]), fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!fstatSync(fd).isFile() || fstatSync(fd).size > 65_536) throw new Error('Invalid config.');
      config = resolveSupervisionConfig(JSON.parse(readFileSync(fd, 'utf8')), dirname(file));
    } finally { closeSync(fd); }
  } catch {
    console.error(JSON.stringify({ version: 1, mode: 'supervise', enforcement: false, reason: 'configuration' })); process.exitCode = 78; return;
  }
  let lease: DatabaseSync | undefined;
  const abort = new AbortController(), stop = () => abort.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let phase: 'journal' | 'publication' = 'journal';
  const runId = randomUUID();
  try {
    prepareLocalDirectory(config.incidents);
    const leasePath = join(config.incidents, 'supervisor.lease');
    if (existsSync(leasePath) && !lstatSync(leasePath).isFile()) throw new Error('Invalid local lease.');
    lease = new DatabaseSync(leasePath); chmodSync(leasePath, 0o600);
    lease.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE'); // Released by the OS on a crash. Never unlink.
    phase = 'publication';
    const record = (event: ProcessEvent | ReportHealth) => {
      const time = new Date().toISOString();
      const incident = { version: 1, mode: 'supervise', enforcement: false, runId, recordedAt: time, ...event };
      saveObservation(join(config.incidents, `incident-${Date.now()}-${randomUUID()}.json`), incident);
      console.log(JSON.stringify(incident));
    };
    const monitor = createReportMonitor(config.reports, config.staleSeconds);
    const check = recordReportTransitions(() => monitor(Date.now()), record);
    const result = await superviseObserver(config, abort.signal, { record, check });
    process.exitCode = result.exitCode;
  } catch {
    console.error(JSON.stringify({ version: 1, mode: 'supervise', enforcement: false, reason: phase }));
    process.exitCode = phase === 'journal' ? 78 : 74;
  } finally {
    try { lease?.close(); } catch { process.exitCode = 78; }
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch(() => { console.error(JSON.stringify({ version: 1, mode: 'supervise', enforcement: false, reason: 'internal' })); process.exitCode = 70; });
}
