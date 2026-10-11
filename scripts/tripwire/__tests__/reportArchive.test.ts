import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { archivePublicReports } from '../testnet/reportArchive.js';
import { parseObserveArgs, saveWatchObservation } from '../testnet/observeCctp.js';
import { reportPublicationTime } from '../../../src/domain/reportFiles.js';
import { reportFolderReader, type ReportDirectory } from '../../../src/pages/operationsFeed.js';
import { readOperationsText, OPERATIONS_FILE_LIMIT } from '../../../src/chains/evm/operations.js';
import healthy from '../../../src/testing/fixtures/tripwire/operations-worker-synthetic.json';
import outage from '../../../src/testing/fixtures/tripwire/operations-worker-outage-synthetic.json';

vi.mock('node:fs', async (load) => {
  const actual = await load<typeof import('node:fs')>();
  return { ...actual, linkSync: vi.fn(actual.linkSync), unlinkSync: vi.fn(actual.unlinkSync), fsyncSync: vi.fn(actual.fsyncSync) };
});
const folders: string[] = [];
const name = (stamp: number, id = 1) => `observation-${stamp}-00000000-0000-0000-0000-${String(id).padStart(12, '0')}.json`;
function setup(count: number) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tripwire-archive-')); folders.push(dir);
  const paths = Array.from({ length: count }, (_, i) => join(dir, name(i + 1)));
  for (const path of paths) fs.writeFileSync(path, `Public fixture ${basename(path)}`, { mode: 0o600 });
  return { dir, paths, current: paths[paths.length - 1] };
}
function asDirectory(dir: string): ReportDirectory {
  return { name: 'synthetic-public-only', values: async function* () {
    for (const file of fs.readdirSync(dir, { withFileTypes: true })) yield { name: file.name, kind: file.isFile() ? 'file' : 'directory',
      getFile: async () => ({ size: fs.statSync(join(dir, file.name)).size, text: async () => fs.readFileSync(join(dir, file.name), 'utf8') }) };
  } };
}
// Restore real mocked filesystem operations explicitly, rather than changing test fixture data.
afterEach(async () => {
  vi.restoreAllMocks();
  const real = await vi.importActual<typeof import('node:fs')>('node:fs');
  vi.mocked(fs.linkSync).mockImplementation(real.linkSync);
  vi.mocked(fs.unlinkSync).mockImplementation(real.unlinkSync);
  vi.mocked(fs.fsyncSync).mockImplementation(real.fsyncSync);
  for (const dir of folders.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('reversible public report archival', () => {
  it('keeps newest reports at top level and preserves every old byte and permission', () => {
    const s = setup(5), original = s.paths.map((p) => fs.readFileSync(p, 'utf8'));
    expect(archivePublicReports(s.dir, s.current, 2)).toEqual({ archived: 3, retained: 2, remaining: 0 });
    expect(fs.readdirSync(s.dir).sort()).toEqual(['archive', name(4), name(5)].sort());
    s.paths.forEach((p, i) => {
      const location = i < 3 ? join(s.dir, 'archive', basename(p)) : p;
      expect(fs.readFileSync(location, 'utf8')).toBe(original[i]); expect(fs.statSync(location).mode & 0o777).toBe(0o600);
    });
    expect(fs.statSync(join(s.dir, 'archive')).mode & 0o777).toBe(0o700);
  });
  it('is idempotent and continues with a pre-existing archive directory', () => {
    const s = setup(4); archivePublicReports(s.dir, s.current, 2);
    expect(archivePublicReports(s.dir, s.current, 2)).toEqual({ archived: 0, retained: 2, remaining: 0 });
    const newer = join(s.dir, name(5)); fs.writeFileSync(newer, 'New');
    expect(archivePublicReports(s.dir, newer, 2)).toEqual({ archived: 1, retained: 2, remaining: 0 });
    expect(fs.readdirSync(join(s.dir, 'archive'))).toHaveLength(3);
  });
  it('keeps the just-published file even if the publisher clock went backwards', () => {
    const s = setup(4), rolledBack = join(s.dir, name(0)); fs.writeFileSync(rolledBack, 'Current after clock rollback');
    expect(archivePublicReports(s.dir, rolledBack, 2)).toEqual({ archived: 2, retained: 3, remaining: 0 });
    expect(fs.existsSync(rolledBack)).toBe(true); expect(fs.existsSync(s.current)).toBe(true);
  });
  it('preserves equal-time boundary groups instead of hiding ambiguity with UUID selection', () => {
    const s = setup(2), peer = join(s.dir, name(2, 2)); fs.writeFileSync(peer, 'Peer');
    expect(archivePublicReports(s.dir, s.current, 1)).toEqual({ archived: 1, retained: 2, remaining: 0 });
    expect(fs.existsSync(peer)).toBe(true); expect(fs.existsSync(s.current)).toBe(true);
  });
  it('refuses oversized equal-time groups without moving any publication', () => {
    const s = setup(1); for (let i = 2; i <= 1002; i++) fs.writeFileSync(join(s.dir, name(1, i)), 'Peer');
    expect(() => archivePublicReports(s.dir, s.current, 1)).toThrow('equal-time');
    expect(fs.readdirSync(s.dir)).toHaveLength(1002); expect(fs.existsSync(join(s.dir, 'archive'))).toBe(false);
  });
  it('never touches partial, configuration, private-key, journal or unrelated nested files', () => {
    const s = setup(3), unrelated = ['.env.owner', 'observer.sqlite', 'observer.sqlite.lease', 'payment-config.json', `${name(0)}.partial-1`];
    for (const n of unrelated) fs.writeFileSync(join(s.dir, n), 'Unrelated synthetic sentinel');
    fs.mkdirSync(join(s.dir, 'nested')); fs.writeFileSync(join(s.dir, 'nested', name(0)), 'Nested sentinel');
    archivePublicReports(s.dir, s.current, 1);
    for (const n of unrelated) expect(fs.readFileSync(join(s.dir, n), 'utf8')).toBe('Unrelated synthetic sentinel');
    expect(fs.readFileSync(join(s.dir, 'nested', name(0)), 'utf8')).toBe('Nested sentinel');
  });
  it('refuses a source symlink before moving any files or touching its target', () => {
    const s = setup(2), target = join(s.dir, 'not-a-report'); fs.writeFileSync(target, 'Untouched'); fs.symlinkSync(target, join(s.dir, name(0)));
    expect(() => archivePublicReports(s.dir, s.current, 1)).toThrow('regular file'); expect(fs.readFileSync(target, 'utf8')).toBe('Untouched');
    expect(s.paths.every(fs.existsSync)).toBe(true);
  });
  it.each(['file', 'symlink'])('refuses an archive path occupied by a %s', (kind) => {
    const s = setup(2), archive = join(s.dir, 'archive');
    if (kind === 'file') fs.writeFileSync(archive, 'Occupied');
    else { fs.mkdirSync(join(s.dir, 'outside')); fs.symlinkSync(join(s.dir, 'outside'), archive); }
    expect(() => archivePublicReports(s.dir, s.current, 1)).toThrow(); expect(s.paths.every(fs.existsSync)).toBe(true);
  });
  it('validates every archive collision before applying any move, even byte-identical different files', () => {
    const s = setup(4), archive = join(s.dir, 'archive'); fs.mkdirSync(archive);
    const target = join(archive, name(1)); fs.copyFileSync(s.paths[0], target);
    expect(() => archivePublicReports(s.dir, s.current, 1)).toThrow('conflict'); expect(s.paths.every(fs.existsSync)).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe(fs.readFileSync(s.paths[0], 'utf8'));
  });
  it('recovers a crash after linking the archive copy but before removing the top-level link', () => {
    const s = setup(2), archive = join(s.dir, 'archive'); fs.mkdirSync(archive); fs.linkSync(s.paths[0], join(archive, name(1)));
    expect(archivePublicReports(s.dir, s.current, 1)).toEqual({ archived: 1, retained: 1, remaining: 0 });
    expect(fs.existsSync(s.paths[0])).toBe(false); expect(fs.readFileSync(join(archive, name(1)), 'utf8')).toContain('Public fixture');
  });
  it('preserves the original on a hard-link publication failure', () => {
    const s = setup(2); vi.mocked(fs.linkSync).mockImplementationOnce(() => { throw new Error('Disk unavailable'); });
    expect(() => archivePublicReports(s.dir, s.current, 1)).toThrow('Disk unavailable'); expect(s.paths.every(fs.existsSync)).toBe(true);
    expect(fs.readdirSync(join(s.dir, 'archive'))).toEqual([]);
  });
  it('never removes the original if flushing the archive copy fails', () => {
    const s = setup(2); vi.mocked(fs.fsyncSync).mockImplementationOnce(() => { throw new Error('Flush failed'); });
    expect(() => archivePublicReports(s.dir, s.current, 1)).toThrow('Flush failed'); expect(s.paths.every(fs.existsSync)).toBe(true);
    expect(fs.readFileSync(join(s.dir, 'archive', name(1)), 'utf8')).toBe(fs.readFileSync(s.paths[0], 'utf8'));
  });
  it('recovers after an unlink failure, preserving both copies until retry', () => {
    const s = setup(2); vi.mocked(fs.unlinkSync).mockImplementationOnce(() => { throw new Error('Move interrupted'); });
    expect(() => archivePublicReports(s.dir, s.current, 1)).toThrow('Move interrupted'); expect(s.paths.every(fs.existsSync)).toBe(true);
    expect(archivePublicReports(s.dir, s.current, 1)).toEqual({ archived: 1, retained: 1, remaining: 0 });
    expect(fs.existsSync(join(s.dir, 'archive', name(1)))).toBe(true);
  });
  it('refuses a publication changed after the archive plan was captured', () => {
    const s = setup(2); const actualLink = vi.mocked(fs.linkSync).getMockImplementation();
    vi.mocked(fs.linkSync).mockImplementationOnce((...args) => { actualLink?.(...args); fs.appendFileSync(s.paths[0], 'Changed'); });
    expect(() => archivePublicReports(s.dir, s.current, 1)).toThrow('identity changed'); expect(s.paths.every(fs.existsSync)).toBe(true);
  });
  it.each([0, -1, 1001, 1.5, NaN])('refuses keep=%s before applying a plan', (keep) => {
    const s = setup(2); expect(() => archivePublicReports(s.dir, s.current, keep)).toThrow(); expect(fs.readdirSync(s.dir)).toHaveLength(2);
  });
  it('refuses a missing or outside current publication and a symlink root', () => {
    const s = setup(2); expect(() => archivePublicReports(s.dir, join(s.dir, name(9)), 1)).toThrow('missing');
    expect(() => archivePublicReports(s.dir, join(s.dir, 'nested', name(9)), 1)).toThrow('outside');
    const alias = `${s.dir}-alias`; fs.symlinkSync(s.dir, alias); folders.push(alias);
    expect(() => archivePublicReports(alias, join(alias, name(2)), 1)).toThrow('real directory'); expect(s.paths.every(fs.existsSync)).toBe(true);
  });
  it('bounds top-level enumeration before any move', () => {
    const s = setup(1); for (let i = 0; i < 10_000; i++) fs.writeFileSync(join(s.dir, `unrelated-${i}`), 'x');
    expect(() => archivePublicReports(s.dir, s.current, 1)).toThrow('10,000'); expect(fs.existsSync(s.current)).toBe(true);
    expect(fs.existsSync(join(s.dir, 'archive'))).toBe(false);
  });
});

describe('observer publication → archival → browser reader', () => {
  it('makes a previously over-limit folder usable while preserving old snapshots and current failure evidence', async () => {
    const s = setup(2001); fs.writeFileSync(s.current, JSON.stringify(healthy));
    const read = reportFolderReader(readOperationsText, OPERATIONS_FILE_LIMIT), signal = new AbortController().signal;
    expect((await read(asDirectory(s.dir), signal))?.error).toContain('2,000');
    expect(archivePublicReports(s.dir, s.current, 10)).toEqual({ archived: 100, retained: 10, remaining: 1891 });
    expect((await read(asDirectory(s.dir), signal))?.report?.payments).toHaveLength(4);
    const failed = join(s.dir, name(2002)); fs.writeFileSync(failed, JSON.stringify(outage)); archivePublicReports(s.dir, failed, 10);
    expect((await read(asDirectory(s.dir), signal))?.report?.payments).toEqual([]);
    expect(fs.readdirSync(join(s.dir, 'archive'))).toHaveLength(200);
  });
  it('watch publication remains append-only without opt-in; opt-in retains both latest and archived evidence', () => {
    const s = setup(2); const a = saveWatchObservation(s.dir, healthy), b = saveWatchObservation(s.dir, outage);
    expect(fs.existsSync(a)).toBe(true); expect(fs.existsSync(b)).toBe(true); expect(fs.existsSync(join(s.dir, 'archive'))).toBe(false);
    const latest = saveWatchObservation(s.dir, healthy, 2); expect(fs.existsSync(latest)).toBe(true);
    expect(fs.existsSync(join(s.dir, 'archive', name(1)))).toBe(true);
  });
  it('archival failure leaves the newly published report readable, rather than retrying publication or hiding it', () => {
    const s = setup(2); fs.writeFileSync(join(s.dir, 'archive'), 'Blocked');
    expect(() => saveWatchObservation(s.dir, healthy, 1)).toThrow();
    const newFile = fs.readdirSync(s.dir).find((n) => n.startsWith('observation-') && n !== name(1) && n !== name(2));
    expect(newFile).toBeDefined(); expect(readOperationsText(fs.readFileSync(join(s.dir, newFile!), 'utf8')).payments).toHaveLength(4);
  });
  it('validates retention before publishing, and CLI retention requires watch directory output', () => {
    const s = setup(1); expect(() => saveWatchObservation(s.dir, healthy, 0)).toThrow(); expect(fs.readdirSync(s.dir)).toHaveLength(1);
    expect(parseObserveArgs(['manifest.json', '--watch', '--reports=public', '--keep-reports=500']).keepReports).toBe(500);
    expect(parseObserveArgs(['manifest.json', '--watch', '--reports=public']).keepReports).toBeUndefined();
  });
  it.each([['--keep-reports=500'], ['--watch', '--keep-reports=500'], ['--report=x.json', '--keep-reports=500'],
    ['--watch', '--reports=public', '--keep-reports=9'], ['--watch', '--reports=public', '--keep-reports=1001'],
    ['--watch', '--reports=public', '--keep-reports=0500'], ['--watch', '--reports=public', '--keep-reports=10', '--keep-reports=20'],
    ['--watch', '--reports=public', '--keep-reports=1.5']])('rejects incompatible archival flags %j', (...args) => {
    expect(() => parseObserveArgs(['manifest.json', ...args])).toThrow();
  });
  it('shared filename boundary uses exact bigint ordering and rejects partial or malformed names', () => {
    expect(reportPublicationTime(name(9))).toBe(9n); expect(reportPublicationTime(name(100))).toBe(100n);
    expect(reportPublicationTime('observation-9999999999999999-00000000-0000-0000-0000-000000000001.json')).toBe(9999999999999999n);
    for (const n of [`${name(1)}.partial-1`, name(1).replace('-1-', '-01-'), '../' + name(1), '.env.owner']) expect(reportPublicationTime(n)).toBeUndefined();
  });
});
