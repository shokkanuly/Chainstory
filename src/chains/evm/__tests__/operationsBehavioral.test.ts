import { describe, expect, it } from 'vitest';
import sample from '../../../testing/fixtures/tripwire/operations-behavioral-synthetic.json';
import old from '../../../testing/fixtures/tripwire/operations-worker-synthetic.json';
import outage from '../../../testing/fixtures/tripwire/operations-worker-outage-synthetic.json';
import { parseOperationsReport, readOperationsText } from '../operations';
import { projectBehavioralAdvisory } from '../../../tripwire/behavioralShadow';
import { reportFolderReader, type ReportEntry } from '../../../pages/operationsFeed';

const captured = Math.floor(Date.parse(sample.observedAt) / 1000);
const fresh = () => structuredClone(sample);
function folder(stamp: number, data: unknown) {
  const text = JSON.stringify(data);
  const entry: ReportEntry = { kind: 'file', name: `observation-${stamp}-00000000-0000-0000-0000-000000000001.json`,
    getFile: async () => ({ size: text.length, text: async () => text }) };
  return { name: 'synthetic-public', values: async function* () { yield entry; } };
}
describe('optional public behavioral advisory', () => {
  it('reads the scoped fixture without changing payment state, reasons, money or receipts', () => {
    const view = parseOperationsReport(sample), legacy = fresh();
    const rows = legacy.results as Record<string, unknown>[]; delete rows[0].behavioral;
    const { behavioral, ...display } = view.payments[0];
    const { behavioral: omitted, ...before } = parseOperationsReport(legacy).payments[0];
    expect(omitted).toBeUndefined(); expect(display).toEqual(before);
    expect(behavioral).toEqual(sample.results[0].behavioral);
    expect(view.payments[0].state).toBe('Held'); expect(view.payments[0].reasons).toContain('Current customer approval is required.');
    expect(view.synthetic).toBe(true);
  });
  it('keeps old reports valid with no implied zero scores', () => {
    expect(parseOperationsReport(old).payments.every((p) => p.behavioral === undefined)).toBe(true);
  });
  it.each(['route', 'transfer', 'synthetic', 'check-time', 'numeric-clock', 'version', 'authorization', 'enforcement', 'extra', 'mandatory-signal'] as const)
    ('refuses malformed or incompatible advisory: %s', (kind) => {
      const r = fresh(), a: Record<string, unknown> = r.results[0].behavioral.assessment;
      if (kind === 'route') a.route = 'other';
      if (kind === 'transfer') a.transferId = old.results[1].messageId;
      if (kind === 'synthetic') a.synthetic = false;
      if (kind === 'check-time') a.checkedAt = captured + 1;
      if (kind === 'numeric-clock') a.capturedAt = '1791270000';
      if (kind === 'version') a.version = 2;
      if (kind === 'authorization') a.authorization = 'ALLOW';
      if (kind === 'enforcement') a.enforcement = true;
      if (kind === 'extra') a.signature = 'forged';
      if (kind === 'mandatory-signal') r.results[0].behavioral.assessment.signals[0].id = 'counterparty_screen';
      expect(() => parseOperationsReport(r)).toThrow();
    });
  it.each([{ version: 2, status: 'unavailable', reason: 'assessment-not-produced' },
    { version: 1, status: 'unavailable', reason: 'private RPC URL' },
    { version: 1, status: 'unavailable', reason: 'assessment-not-produced', score: 0 },
    { version: 1, status: 'unavailable', reason: 'assessment-not-produced', assessment: sample.results[0].behavioral.assessment }])
    ('refuses incompatible unavailable extensions %j', (behavioral) => {
      const r = fresh(); (r.results[0] as Record<string, unknown>).behavioral = behavioral;
      expect(() => parseOperationsReport(r)).toThrow();
    });
  it('accepts explicit absence without deleting mandatory failures', () => {
    const r = fresh(); (r.results[0] as Record<string, unknown>).behavioral = projectBehavioralAdvisory();
    const row = parseOperationsReport(r).payments[0];
    expect(row.behavioral).toEqual({ version: 1, status: 'unavailable', reason: 'assessment-not-produced' });
    expect(row.state).toBe('Held'); expect(row.reasons).toContain('Current customer approval is required.');
  });
  it.each(['stale', 'future'] as const)('imports suppressed %s projections without rewriting capture time', (kind) => {
    const r = fresh(), time = kind === 'stale' ? captured - 301 : captured + 1;
    const original = { transfer: { route: r.route, hash: r.results[0].messageId }, signals: [{ id: 'size_vs_baseline', score: 0.5 }] };
    const extension = projectBehavioralAdvisory(original, { route: r.route, transferId: original.transfer.hash,
      capturedAt: time, checkedAt: captured, synthetic: true });
    (r.results[0] as Record<string, unknown>).behavioral = extension;
    const view = parseOperationsReport(r).payments[0].behavioral;
    expect(view).toEqual(extension);
    if (view?.status !== 'reported') throw new Error('Missing synthetic projection.');
    expect(view.assessment.capturedAt).toBe(time); expect(view.assessment.freshness).toBe(kind);
    expect(view.assessment.signals.every((s) => s.score === null)).toBe(true);
  });
  it('refuses scores resurrected from a stale capture', () => {
    const r = fresh(); r.results[0].behavioral.assessment.capturedAt = captured - 301;
    expect(() => parseOperationsReport(r)).toThrow();
  });
  it('replaces advisory rows on outage and recovers without refreshing original capture', async () => {
    const read = reportFolderReader(readOperationsText, 2_000_000), signal = new AbortController().signal;
    const first = await read(folder(1, sample), signal);
    expect(first?.report?.payments[0].behavioral?.status).toBe('reported');
    const failed = await read(folder(2, outage), signal); expect(failed?.report?.payments).toEqual([]);
    const recovered = await read(folder(3, sample), signal);
    expect(recovered?.report?.payments[0].behavioral).toEqual(first?.report?.payments[0].behavioral);
  });
  it.each(['malformed', 'scope', 'unavailable', 'old'] as const)('replaces old advisory data on new %s snapshot', async (kind) => {
    const read = reportFolderReader(readOperationsText, 2_000_000), signal = new AbortController().signal;
    await read(folder(1, sample), signal); const r = fresh();
    if (kind === 'malformed') r.results[0].behavioral.assessment.authorization = 'ALLOW';
    if (kind === 'scope') r.scope.operator = `0x${'f'.repeat(40)}`;
    if (kind === 'unavailable') (r.results[0] as Record<string, unknown>).behavioral = projectBehavioralAdvisory();
    if (kind === 'old') delete (r.results[0] as Record<string, unknown>).behavioral;
    const update = await read(folder(2, r), signal);
    if (kind === 'malformed' || kind === 'scope') expect(update?.report).toBeNull();
    else expect(update?.report?.payments[0].behavioral?.status).not.toBe('reported');
  });
});
