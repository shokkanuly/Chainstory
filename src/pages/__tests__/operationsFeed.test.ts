import { describe, expect, it, vi, afterEach } from 'vitest';
import healthy from '../../testing/fixtures/tripwire/operations-worker-synthetic.json';
import outage from '../../testing/fixtures/tripwire/operations-worker-outage-synthetic.json';
import { readOperationsText, OPERATIONS_FILE_LIMIT } from '../../chains/evm/operations';
import { reportFolderReader, watchReportFolder, folderSupported, chooseReportDirectory, type ReportEntry, type ReportDirectory, type FolderUpdate } from '../operationsFeed';

const name = (stamp: number, id = 1) => `observation-${stamp}-00000000-0000-0000-0000-${String(id).padStart(12, '0')}.json`;
function entry(stamp: number, value: unknown = healthy, id = 1): ReportEntry {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return { name: name(stamp, id), kind: 'file', getFile: vi.fn(async () => ({ size: new TextEncoder().encode(text).length, text: async () => text })) };
}
function directory(entries: ReportEntry[]): ReportDirectory {
  return { name: 'public-only', values: async function* () { yield* entries; } };
}
const reader = () => reportFolderReader(readOperationsText, OPERATIONS_FILE_LIMIT);
const signal = () => new AbortController().signal;
const later = () => ({ ...structuredClone(healthy), observedAt: '2026-10-06T12:01:00.000Z' });
afterEach(() => vi.unstubAllGlobals());
describe('local public report folder continuity', () => {
  it('selects numeric publication order, not enumeration or lexical order; reads only the latest body', async () => {
    const older = entry(9), newest = entry(100);
    const result = await reader()(directory([newest, older]), signal());
    expect(result?.report?.payments).toHaveLength(4); expect(result?.fileName).toBe(newest.name);
    expect(older.getFile).not.toHaveBeenCalled(); expect(newest.getFile).toHaveBeenCalledOnce();
  });
  it('ignores partial files, private/config filenames and nested folders without reading them', async () => {
    const ignored = ['.env.owner', 'payment-config.json', `${name(300)}.partial-123`, 'observation-1-bad.json'].map((n) => ({ ...entry(1), name: n }));
    const nested = { ...entry(400), kind: 'directory' };
    expect((await reader()(directory([...ignored, nested, entry(2)]), signal()))?.report?.kind).toBe('payments');
    for (const e of [...ignored, nested]) expect(e.getFile).not.toHaveBeenCalled();
  });
  it('waits on an empty folder, then recovers when a completed file arrives', async () => {
    const read = reader(); expect((await read(directory([]), signal()))?.report).toBeNull();
    expect((await read(directory([entry(1)]), signal()))?.report?.kind).toBe('payments');
  });
  it('rereads the latest file without inventing a fresh capture time', async () => {
    const read = reader(), e = entry(1), folder = directory([e]);
    const first = await read(folder, signal()), second = await read(folder, signal());
    expect(second?.report?.capturedAt).toBe(first?.report?.capturedAt); expect(e.getFile).toHaveBeenCalledTimes(2);
  });
  it('healthy → unavailable → recovery replaces all payment evidence and retains scope', async () => {
    const read = reader(); await read(directory([entry(1)]), signal());
    const failed = await read(directory([entry(2, outage)]), signal());
    expect(failed?.report?.kind).toBe('unavailable'); expect(failed?.report?.payments).toEqual([]); expect(failed?.report?.blocks).toEqual([]);
    expect((await read(directory([entry(3, later())]), signal()))?.report?.payments).toHaveLength(4);
  });
  it.each(['{', JSON.stringify({ mode: 'observe', status: 'ok' })])('invalid newest input clears rows without fallback (%s)', async (bad) => {
    const read = reader(), old = entry(1); await read(directory([old]), signal());
    const update = await read(directory([old, entry(2, bad)]), signal());
    expect(update?.report).toBeNull(); expect(update?.error).toContain('invalid');
    expect((await read(directory([old]), signal()))?.error).toContain('disappeared');
    expect((await read(directory([entry(3, later())]), signal()))?.report?.kind).toBe('payments');
  });
  it('refuses oversized newest files before reading their body', async () => {
    const text = vi.fn(async () => JSON.stringify(healthy));
    const oversized = { ...entry(2), getFile: async () => ({ size: OPERATIONS_FILE_LIMIT + 1, text }) };
    expect((await reader()(directory([entry(1), oversized]), signal()))?.error).toContain('2 MB'); expect(text).not.toHaveBeenCalled();
  });
  it('refuses a replaced published report until a newer publication arrives', async () => {
    const read = reader(); await read(directory([entry(1)]), signal());
    expect((await read(directory([entry(1, outage)]), signal()))?.error).toContain('changed');
    expect((await read(directory([entry(2, later())]), signal()))?.report?.kind).toBe('payments');
  });
  it('never reverts to old statuses when the newest accepted file disappears', async () => {
    const read = reader(); await read(directory([entry(2)]), signal());
    expect((await read(directory([entry(1)]), signal()))?.report).toBeNull();
    expect((await read(directory([entry(2, healthy, 2)]), signal()))?.error).toContain('order changed');
  });
  it('does not arbitrarily choose equal-time UUIDs or choose after one disappears', async () => {
    const read = reader(); expect((await read(directory([entry(2), entry(2, outage, 2)]), signal()))?.error).toContain('same publication');
    expect((await read(directory([entry(2)]), signal()))?.report).toBeNull();
    expect((await read(directory([entry(3)]), signal()))?.report?.kind).toBe('payments');
  });
  it('older ties do not mask an unambiguous latest file', async () => {
    expect((await reader()(directory([entry(1), entry(1, outage, 2), entry(2)]), signal()))?.report?.kind).toBe('payments');
  });
  it('pins deployment and operator scope across an outage; reselection is a fresh reader', async () => {
    const read = reader(), changed = structuredClone(healthy); changed.scope.operator = `0x${'f'.repeat(40)}`;
    await read(directory([entry(1)]), signal()); await read(directory([entry(2, outage)]), signal());
    expect((await read(directory([entry(3, changed)]), signal()))?.error).toContain('scope changed');
    expect((await reader()(directory([entry(3, changed)]), signal()))?.report?.kind).toBe('payments');
  });
  it('pins synthetic provenance and refuses switching to an unmarked report', async () => {
    const read = reader(); await read(directory([entry(1)]), signal());
    const changed = { ...healthy, fixture: false };
    expect((await read(directory([entry(2, changed)]), signal()))?.error).toContain('scope changed');
  });
  it('refuses backwards capture clocks; equal-time snapshots can still report an outage', async () => {
    const read = reader(); await read(directory([entry(1, later())]), signal());
    expect((await read(directory([entry(2)]), signal()))?.error).toContain('backwards');
    expect((await read(directory([entry(3, { ...outage, observedAt: later().observedAt })]), signal()))?.report?.kind).toBe('unavailable');
  });
  it('refuses one-shot reports as an automatic feed', async () => {
    const manual = structuredClone(healthy); delete (manual as { worker?: unknown }).worker;
    expect((await reader()(directory([entry(1, manual)]), signal()))?.error).toContain('not a watch report');
  });
  it('limits enumeration even when entries are unrelated and never reads a partial directory result', async () => {
    const e = entry(1); const entries = Array.from({ length: 2001 }, (_, i) => ({ ...e, name: `unrelated-${i}` })); entries[0] = e;
    expect((await reader()(directory(entries), signal()))?.error).toContain('2,000'); expect(e.getFile).not.toHaveBeenCalled();
  });
  it.each(['enumeration', 'getFile', 'text'])('redacts native %s failures and clears rows', async (where) => {
    const failure = () => { throw new Error('secret /private/path provider-token'); };
    const e = entry(1);
    if (where === 'getFile') e.getFile = async () => failure();
    if (where === 'text') e.getFile = async () => ({ size: 20, text: async () => failure() });
    const dir = where === 'enumeration' ? { name: 'public', values: async function* () { failure(); yield e; } } : directory([e]);
    const update = await reader()(dir, signal()); expect(update?.report).toBeNull(); expect(update?.error).toBe('Folder access failed. Re-select the public-report folder if access was removed.');
  });
  it('suppresses output after cancellation during file reading', async () => {
    const controller = new AbortController(); let reading = false; let finish: (value: string) => void = () => {};
    const e = { ...entry(1), getFile: async () => ({ size: 20, text: () => new Promise<string>((resolve) => { reading = true; finish = resolve; }) }) };
    const pending = reader()(directory([e]), controller.signal);
    await vi.waitFor(() => expect(reading).toBe(true));
    controller.abort(); finish(JSON.stringify(healthy)); expect(await pending).toBeUndefined();
  });
  it('cancels before enumeration without touching a folder', async () => {
    const controller = new AbortController(); controller.abort(); const values = vi.fn(directory([]).values);
    expect(await reader()({ name: 'public', values }, controller.signal)).toBeUndefined(); expect(values).not.toHaveBeenCalled();
  });
});
describe('sequential folder subscription and native capability', () => {
  it('continues after a failed folder read and prevents a queued callback from reading after disconnect', async () => {
    const callbacks: (() => void)[] = [], emit = vi.fn();
    const read = vi.fn(async () => ({ report: null, fileName: '', error: 'Unavailable' }));
    const stop = watchReportFolder(read, emit, (callback) => { callbacks.push(callback); return () => {}; });
    await vi.waitFor(() => expect(callbacks).toHaveLength(1)); callbacks[0]();
    await vi.waitFor(() => expect(callbacks).toHaveLength(2)); expect(emit).toHaveBeenCalledTimes(2);
    stop(); callbacks[1](); expect(read).toHaveBeenCalledTimes(2);
  });
  it('the real timer port is cancelled on disconnect', async () => {
    const cancel = vi.fn(), timer = vi.fn(() => 12);
    vi.stubGlobal('window', { setTimeout: timer, clearTimeout: cancel });
    const stop = watchReportFolder(async () => ({ report: null, fileName: '', error: '' }), () => {});
    await vi.waitFor(() => expect(timer).toHaveBeenCalledOnce()); stop(); expect(cancel).toHaveBeenCalledWith(12);
  });
  it('only schedules after completion and stops queued work', async () => {
    let finish: (update: FolderUpdate) => void = () => {}; const read = vi.fn(() => new Promise<FolderUpdate>((r) => { finish = r; }));
    const cancel = vi.fn(), schedule = vi.fn((_callback: () => void, _delay: number) => cancel), emit = vi.fn();
    const stop = watchReportFolder(read, emit, schedule); expect(read).toHaveBeenCalledOnce(); expect(schedule).not.toHaveBeenCalled();
    finish({ report: null, fileName: '', error: 'Unavailable' }); await vi.waitFor(() => expect(schedule).toHaveBeenCalledOnce());
    expect(schedule.mock.calls[0][1]).toBe(5000); expect(emit).toHaveBeenCalledOnce(); stop(); expect(cancel).toHaveBeenCalledOnce();
  });
  it('disconnect during a slow read suppresses late rows and another timer', async () => {
    let finish: (update: FolderUpdate) => void = () => {}; const schedule = vi.fn(() => () => {}), emit = vi.fn();
    const stop = watchReportFolder(() => new Promise<FolderUpdate>((r) => { finish = r; }), emit, schedule);
    stop(); finish({ report: readOperationsText(JSON.stringify(healthy)), fileName: name(1), error: '' });
    await Promise.resolve(); expect(emit).not.toHaveBeenCalled(); expect(schedule).not.toHaveBeenCalled();
  });
  it('detects unsupported/insecure contexts without requesting access', async () => {
    const picker = vi.fn(); vi.stubGlobal('window', { isSecureContext: false, showDirectoryPicker: picker });
    expect(folderSupported()).toBe(false); await expect(chooseReportDirectory()).rejects.toThrow('unavailable'); expect(picker).not.toHaveBeenCalled();
    vi.stubGlobal('window', { isSecureContext: true }); expect(folderSupported()).toBe(false);
  });
  it('requests only read access on an explicit picker call', async () => {
    const dir = directory([]), picker = vi.fn(async () => dir); vi.stubGlobal('window', { isSecureContext: true, showDirectoryPicker: picker });
    expect(folderSupported()).toBe(true); expect(picker).not.toHaveBeenCalled(); expect(await chooseReportDirectory()).toBe(dir);
    expect(picker).toHaveBeenCalledWith({ mode: 'read' });
  });
});
