// Sequential keyless observation. The CLI owns signals, clients and the journal lease.
import { z } from 'zod';
import type { createCctpAudit, AuditReport } from './cctpAudit.js';
import { pilotManifestSchema } from './cctpManifest.js';
import { discoverCctpRequests, DiscoveryStoppedError, type DiscoveryCoverage } from './cctpDiscovery.js';
import { FinalityConflictError } from '../finality.js';
import { auditBoundary, CctpAuditFailure, journalOperation, retryableAuditFailure, type AuditFailureReason } from '../auditFailure.js';

export interface WorkerStatus {
  version: 1; state: 'scheduled' | 'retrying' | 'stopped'; attempt: number;
  consecutiveFailures: number; intervalSeconds: number; nextPollSeconds: number;
}
type FailureReport = { version: 1; mode: 'observe'; enforcement: false; status: 'unavailable' | 'quarantined'; observedAt: string; reason: string };
export type ObserverReport = (FailureReport | (AuditReport & { status: 'ok'; observedAt: string; durationMs: number; discovery?: DiscoveryCoverage })) & { worker?: WorkerStatus };
type Audit = Awaited<ReturnType<typeof createCctpAudit>>;
type Feeds = Parameters<typeof discoverCctpRequests>[1];
const optionsSchema = z.object({ watch: z.boolean(), intervalSeconds: z.number().int().min(5).max(300),
  discovery: z.object({ source: z.bigint().nonnegative(), destination: z.bigint().nonnegative() }).optional(),
  discoveryPersistent: z.boolean(),
}).refine((o) => (!o.discoveryPersistent || Boolean(o.discovery)) && (!o.watch || !o.discovery || o.discoveryPersistent));
export const retrySeconds = (interval: number, failures: number) => Math.min(300, interval * 2 ** Math.min(Math.max(0, failures - 1), 6));
const failureText: Record<AuditFailureReason, string> = {
  configuration: 'Observation configuration is unavailable or invalid.', deployment: 'Deployment acceptance failed; reconcile configuration and runtime.',
  journal: 'Observation journal could not be read or updated; preserve it and reconcile storage.',
  quarantine: 'Finalized history is quarantined; reconcile the operator journal.', scope: 'Observation scope changed; preserve the original manifest and journal.',
  capacity: 'Discovery capacity reached; reconcile retained hints without resetting cursors.',
  evidence: 'Global observation evidence is malformed or inconsistent; reconcile the provider and inputs.',
  internal: 'An unclassified observation failure requires investigation.',
  'rpc-unavailable': 'A recognized temporary RPC failure prevented this observation.',
  'rpc-behind': 'Finalized RPC is behind previously observed history; saved cursors were preserved.',
};
export async function waitForObservation(seconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((done) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); done(); };
    const timer = setTimeout(finish, seconds * 1000);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

export async function runCctpObserver(input: {
  audit: Audit; feeds: Feeds; initialManifest: unknown; readManifest(): unknown;
  options: z.input<typeof optionsSchema>; signal: AbortSignal; emit(report: ObserverReport): void | Promise<void>;
  onFailure?(reason: AuditFailureReason): void;
  wait?: typeof waitForObservation; now?: () => Date;
}): Promise<'complete' | 'stopped' | 'failed'> {
  const options = optionsSchema.parse(input.options), initial = pilotManifestSchema.parse(input.initialManifest);
  if (options.discovery && (initial.version !== 3 || initial.requests.length)) throw new DiscoveryStoppedError('Discovery requires an empty customer-payment manifest.');
  const scope = (m: typeof initial) => JSON.stringify({ ...m, requests: [] }, (_k, v: unknown) => typeof v === 'bigint' ? v.toString() : v);
  const expectedScope = scope(initial), wait = input.wait ?? waitForObservation, now = input.now ?? (() => new Date());
  let attempt = 0, failures = 0;
  const journal = journalOperation;
  const quarantined = () => journal(() => Boolean(input.audit.store.sourceQuarantine() || input.audit.store.loadWatcher()?.quarantine));
  while (!input.signal.aborted) {
    attempt++; const started = performance.now(); let report: ObserverReport, stop = false;
    try {
      if (quarantined()) throw new CctpAuditFailure('quarantine', new Error('Observation journal is quarantined.'));
      let manifest: typeof initial;
      try { manifest = pilotManifestSchema.parse(input.readManifest()); }
      catch (error) { throw new CctpAuditFailure('configuration', error); }
      if (scope(manifest) !== expectedScope) throw new CctpAuditFailure('scope', new Error('Observation manifest scope changed.'));
      const persistent = options.discoveryPersistent ? { resume: journal(() => input.audit.store.loadDiscovery()) } : undefined;
      const starts = options.discovery;
      const discovered = starts ? await auditBoundary('evidence', () => discoverCctpRequests(manifest, input.feeds, starts, input.signal, persistent), true) : undefined;
      const observed = await auditBoundary('internal', () => input.audit.tick(discovered?.manifest ?? manifest));
      if (discovered) {
        await auditBoundary('evidence', () => discovered.assertCanonical(), true);
        if (input.signal.aborted) return 'stopped';
        const state = discovered.state;
        if (state) journal(() => input.audit.store.saveDiscovery(state));
        const increment = discovered.metadata.incremental;
        if (increment && (increment.sourceHead.number > discovered.metadata.source.through.number || increment.destinationHead.number > discovered.metadata.destination.through.number)) observed.blockers.push('Discovery is catching up with finalized history. Further scans are required; unscanned blocks may contain additional operations.');
        if (discovered.metadata.pendingSource.length) observed.blockers.push('Source operation hints have no matching credit in the scanned destination range. They are not authenticated unminted balances.');
        if (discovered.metadata.unmatchedDestination.length || discovered.metadata.conflicts.length) observed.blockers.push('Discovery has unmatched or ambiguous operations. Some credits were not audited; reconcile the range and receipts.');
      }
      failures = 0;
      report = { ...observed, ...(discovered ? { discovery: discovered.metadata } : {}), status: 'ok', observedAt: now().toISOString(), durationMs: Math.round(performance.now() - started) };
    } catch (error) {
      if (input.signal.aborted) {
        if (error instanceof CctpAuditFailure && !retryableAuditFailure(error.reason)) throw error;
        return 'stopped';
      }
      let reason: AuditFailureReason = error instanceof CctpAuditFailure ? error.reason : error instanceof FinalityConflictError ? 'quarantine' : 'internal';
      let quarantine = false;
      try {
        if (error instanceof FinalityConflictError) journal(() => input.audit.store.quarantineSource('Finalized observation history changed. Reconcile the operator journal.'));
        quarantine = quarantined();
      } catch { reason = 'journal'; }
      if (quarantine && reason !== 'journal') reason = 'quarantine';
      failures++; stop = !retryableAuditFailure(reason);
      input.onFailure?.(reason);
      report = { version: 1, mode: 'observe', enforcement: false, status: quarantine ? 'quarantined' : 'unavailable', observedAt: now().toISOString(),
        reason: `${stop ? 'Observation stopped.' : 'Observation failed.'} ${failureText[reason]} No authorization was produced.` };
    }
    if (input.signal.aborted) return 'stopped';
    const nextPollSeconds = stop || !options.watch ? 0 : failures ? retrySeconds(options.intervalSeconds, failures) : options.intervalSeconds;
    if (options.watch) report.worker = { version: 1, state: stop ? 'stopped' : failures ? 'retrying' : 'scheduled', attempt,
      consecutiveFailures: failures, intervalSeconds: options.intervalSeconds, nextPollSeconds };
    // Export/storage failures are fatal. Never retry publishing as a healthy RPC poll.
    await input.emit(report);
    if (input.signal.aborted) return 'stopped';
    if (stop || !options.watch) return report.status === 'ok' ? 'complete' : 'failed';
    await wait(nextPollSeconds, input.signal);
  }
  return 'stopped';
}
