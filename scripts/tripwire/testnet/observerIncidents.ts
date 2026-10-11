// Advisory local report monitoring. Reading a report never refreshes its capture time.
import { openSync, closeSync, fstatSync, readFileSync, opendirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { constants } from 'node:fs';
import { reportPublicationTime } from '../../../src/domain/reportFiles.js';
import { readOperationsText, OPERATIONS_FILE_LIMIT } from '../../../src/chains/evm/operations.js';

export type ReportCondition = 'report-missing' | 'report-invalid' | 'report-access' | 'report-stale' | 'report-future'
  | 'report-unavailable' | 'report-retrying' | 'report-stopped' | 'report-quarantined'
  | 'discovery-backlog' | 'discovery-gaps' | 'discovery-capacity';
export type ReportHealth = { kind: 'report'; conditions: ReportCondition[]; capturedAt?: string; synthetic?: boolean };
export function createReportMonitor(directory: string, staleSeconds: number) {
  let newest: { name: string; time: bigint } | undefined, scope: string | undefined;
  return (nowMs: number): ReportHealth => {
    const bad = (condition: ReportCondition): ReportHealth => ({ kind: 'report', conditions: [condition] });
    let selected: { name: string; time: bigint } | undefined, tied = false;
    try {
      if (!lstatSync(directory).isDirectory()) return bad('report-access');
      const entries = opendirSync(directory); let count = 0;
      try {
        for (let entry = entries.readSync(); entry; entry = entries.readSync()) {
          if (++count > 10_000) return bad('report-access');
          const time = reportPublicationTime(entry.name); if (time === undefined) continue;
          if (!selected || time > selected.time) { selected = { name: entry.name, time }; tied = false; }
          else if (time === selected.time) tied = true;
        }
      } finally { entries.closeSync(); }
    } catch (error) {
      return bad((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'report-missing' : 'report-access');
    }
    if (!selected) return bad('report-missing');
    if (newest && (selected.time < newest.time || (selected.time === newest.time && selected.name !== newest.name))) return bad('report-invalid');
    newest = selected; // Remember even a rejected newest name; never fall back to an older report.
    if (tied) return bad('report-invalid');
    let value: unknown, snapshot: ReturnType<typeof readOperationsText>;
    try {
      const selectedPath = join(directory, selected.name);
      if (!lstatSync(selectedPath).isFile()) return bad('report-invalid');
      const fd = openSync(selectedPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = fstatSync(fd); if (!stat.isFile() || stat.size > OPERATIONS_FILE_LIMIT) return bad('report-invalid');
        const text = readFileSync(fd, 'utf8');
        snapshot = readOperationsText(text); value = JSON.parse(text);
      } finally { closeSync(fd); }
      if (snapshot.kind === 'readiness') return bad('report-invalid');
      if (snapshot.observationScope) {
        if (scope && scope !== snapshot.observationScope) return bad('report-invalid');
        scope = snapshot.observationScope;
      }
    } catch { return bad('report-invalid'); }
    const conditions: ReportCondition[] = [], age = nowMs - Date.parse(snapshot.capturedAt);
    if (!Number.isFinite(age) || age < -120_000) conditions.push('report-future');
    else if (age > staleSeconds * 1000) conditions.push('report-stale');
    if (snapshot.kind === 'unavailable') conditions.push('report-unavailable');
    if (snapshot.observer?.state === 'retrying') conditions.push('report-retrying');
    if (snapshot.observer?.state === 'stopped') conditions.push('report-stopped');
    if (value && typeof value === 'object' && 'status' in value && value.status === 'quarantined') conditions.push('report-quarantined');
    const d = snapshot.discovery;
    if (d?.incremental?.ranges.some((r) => r.remaining > 0n)) conditions.push('discovery-backlog');
    if (d && (d.pendingSource.length || d.unmatchedDestination.length || d.conflicts.length)) conditions.push('discovery-gaps');
    if (d && (d.sourceHints >= 100 || d.destinationHints >= 100)) conditions.push('discovery-capacity');
    return { kind: 'report', conditions, capturedAt: snapshot.capturedAt, synthetic: snapshot.synthetic };
  };
}

export function recordReportTransitions(read: () => ReportHealth, record: (event: ReportHealth) => void): () => void {
  let previous: string | undefined;
  return () => {
    const event = read(), key = JSON.stringify({ conditions: event.conditions, synthetic: event.synthetic });
    if (key !== previous) { record(event); previous = key; }
  };
}
