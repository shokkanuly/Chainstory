import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createReportMonitor, recordReportTransitions, type ReportHealth } from '../testnet/observerIncidents.js';

const healthy = JSON.parse(readFileSync('src/testing/fixtures/tripwire/operations-worker-synthetic.json', 'utf8'));
const outage = JSON.parse(readFileSync('src/testing/fixtures/tripwire/operations-worker-outage-synthetic.json', 'utf8'));
const now = Date.parse(healthy.observedAt), dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); });
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'tripwire-incidents-')); dirs.push(root);
  const directory = join(root, 'public'), monitor = createReportMonitor(directory, 300);
  const name = (time: number, id = '1') => `observation-${time}-00000000-0000-0000-0000-${id.padStart(12, '0')}.json`;
  const publish = (value: unknown, time = 1, id = '1') => {
    mkdirSync(directory, { recursive: true }); const file = join(directory, name(time, id));
    writeFileSync(file, JSON.stringify(value)); return file;
  };
  return { root, directory, monitor, name, publish };
}
describe('local incidents from validated immutable public report snapshots', () => {
  it('reports missing input without fabricating a capture time', () => {
    const s = setup(); expect(s.monitor(now)).toEqual({ kind: 'report', conditions: ['report-missing'] });
  });
  it('uses original capture time, not filename time or check time, for stale/future state', () => {
    const s = setup(); s.publish(healthy, Date.now());
    expect(s.monitor(now)).toMatchObject({ capturedAt: healthy.observedAt, conditions: ['discovery-gaps'], synthetic: true });
    expect(s.monitor(now + 300_001)).toMatchObject({ capturedAt: healthy.observedAt, conditions: ['report-stale', 'discovery-gaps'] });
    expect(s.monitor(now - 120_001)).toMatchObject({ conditions: ['report-future', 'discovery-gaps'] });
  });
  it('reports retrying/stopped/quarantined from fixed fields without logging the private reason', () => {
    const s = setup(); s.publish({ ...outage, reason: 'https://user:REDACTION_SENTINEL@rpc.invalid/?secret=REDACTION_SENTINEL' });
    expect(s.monitor(now).conditions).toEqual(['report-unavailable', 'report-retrying']);
    s.publish({ ...outage, status: 'quarantined', worker: { ...outage.worker, state: 'stopped', nextPollSeconds: 0 } }, 2);
    const r = s.monitor(now); expect(r.conditions).toEqual(['report-unavailable', 'report-stopped', 'report-quarantined']);
    expect(JSON.stringify(r)).not.toContain('REDACTION_SENTINEL');
  });
  it('reports remaining discovery backlog and retained capacity without inventing money exposure', () => {
    const s = setup(), value = structuredClone(healthy);
    value.discovery.incremental.sourceHead.number = '80'; value.discovery.incremental.sourceHead.timestamp = '1791263601';
    value.discovery.counts.sourceHints = 100; s.publish(value);
    const r = s.monitor(now); expect(r.conditions).toEqual(['discovery-backlog', 'discovery-gaps', 'discovery-capacity']);
    expect(Object.keys(r)).toEqual(['kind', 'conditions', 'capturedAt', 'synthetic']);
  });
  it('remembers an invalid newest report and refuses deletion-based fallback to old success', () => {
    const s = setup(); s.publish(healthy); expect(s.monitor(now).conditions).toEqual(['discovery-gaps']);
    const broken = s.publish({ raw: 'REDACTION_SENTINEL' }, 2); expect(s.monitor(now).conditions).toEqual(['report-invalid']);
    rmSync(broken); expect(s.monitor(now).conditions).toEqual(['report-invalid']);
    s.publish(healthy, 3); expect(s.monitor(now).conditions).toEqual(['discovery-gaps']);
  });
  it('rejects equal publication timestamps rather than choosing an arbitrary report', () => {
    const s = setup(); s.publish(healthy, 1, '1'); s.publish(outage, 1, '2'); expect(s.monitor(now).conditions).toEqual(['report-invalid']);
  });
  it.each(['symlink', 'directory', 'oversize', 'malformed'])('rejects %s newest input and does not reuse older evidence', (mode) => {
    const s = setup(); s.publish(healthy); const file = join(s.directory, s.name(2));
    if (mode === 'symlink') { const target = join(s.root, 'private-synthetic'); writeFileSync(target, 'REDACTION_SENTINEL'); symlinkSync(target, file); }
    if (mode === 'directory') mkdirSync(file);
    if (mode === 'oversize') writeFileSync(file, ' '.repeat(2_000_001));
    if (mode === 'malformed') writeFileSync(file, 'REDACTION_SENTINEL');
    const r = s.monitor(now); expect(r.conditions).toEqual(['report-invalid']); expect(JSON.stringify(r)).not.toContain('REDACTION_SENTINEL');
  });
  it('refuses a symlink report root without traversing it', () => {
    const s = setup(), other = join(s.root, 'other'); mkdirSync(other); symlinkSync(other, s.directory);
    expect(s.monitor(now).conditions).toEqual(['report-access']);
  });
  it('pins successful scope and refuses a different deployment report', () => {
    const s = setup(); s.publish(healthy); s.monitor(now); const value = structuredClone(healthy);
    value.scope.operator = '0x0000000000000000000000000000000000000999'; s.publish(value, 2);
    expect(s.monitor(now).conditions).toEqual(['report-invalid']);
  });
  it('ignores incomplete/foreign names and nested archive files', () => {
    const s = setup(); s.publish(healthy); writeFileSync(join(s.directory, 'observation-partial.json'), 'REDACTION_SENTINEL');
    mkdirSync(join(s.directory, 'archive')); writeFileSync(join(s.directory, 'archive', s.name(100)), 'REDACTION_SENTINEL');
    expect(s.monitor(now).conditions).toEqual(['discovery-gaps']);
  });
  it('records condition transitions and recovery without emitting a new healthy event every check', () => {
    const s = setup(), events: ReportHealth[] = []; let clock = now;
    const check = recordReportTransitions(() => s.monitor(clock), (e) => events.push(e));
    check(); check(); expect(events).toHaveLength(1);
    const value = structuredClone(healthy); delete value.discovery; s.publish(value); check(); check();
    expect(events).toHaveLength(2); expect(events.at(-1)?.conditions).toEqual([]);
    clock += 300_001; check(); check(); expect(events).toHaveLength(3); expect(events.at(-1)?.conditions).toEqual(['report-stale']);
    s.publish({ ...value, observedAt: new Date(clock).toISOString() }, 2); check();
    expect(events).toHaveLength(4); expect(events.at(-1)?.conditions).toEqual([]);
  });
});
