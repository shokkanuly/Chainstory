import { lstatSync, mkdirSync, opendirSync, linkSync, unlinkSync, fsyncSync, openSync, closeSync, type BigIntStats } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { z } from 'zod';
import { reportPublicationTime } from '../../../src/domain/reportFiles.js';

export const reportKeepSchema = z.number().int().min(1).max(1000);
export const ARCHIVE_BATCH_LIMIT = 100;
const sameFile = (a: BigIntStats, b: BigIntStats) => a.isFile() && b.isFile() &&
  a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs;
function statIfPresent(path: string): BigIntStats | undefined {
  try { return lstatSync(path, { bigint: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
function flushDirectory(path: string) {
  const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
}

// Reversible archival of public snapshots only. Never accesses JSON bodies or a journal.
// The directory must be dedicated to one writer; concurrent local tampering is not supported.
export function archivePublicReports(directory: string, currentPath: string, keep: number): { archived: number; retained: number; remaining: number } {
  reportKeepSchema.parse(keep);
  const root = resolve(directory), current = resolve(currentPath), currentName = basename(current);
  if (dirname(current) !== root || reportPublicationTime(currentName) === undefined) throw new Error('Current publication is outside the public report directory.');
  if (!lstatSync(root).isDirectory()) throw new Error('Public report directory must be a real directory.');
  const files: { name: string; stamp: bigint; stat: BigIntStats }[] = [];
  const entries = opendirSync(root); let count = 0;
  try {
    for (let entry = entries.readSync(); entry; entry = entries.readSync()) {
      if (++count > 10_000) throw new Error('Public report archival exceeds 10,000 top-level entries. Reconcile the report directory.');
      const stamp = reportPublicationTime(entry.name); if (stamp === undefined) continue;
      const stat = lstatSync(join(root, entry.name), { bigint: true });
      if (!stat.isFile()) throw new Error('A public report filename is not a regular file. No archive plan was applied.');
      files.push({ name: entry.name, stamp, stat });
    }
  } finally { entries.closeSync(); }
  if (!files.some((f) => f.name === currentName)) throw new Error('Current public report is missing.');
  files.sort((a, b) => a.stamp > b.stamp ? -1 : a.stamp < b.stamp ? 1 : a.name.localeCompare(b.name));
  const cutoff = files[Math.min(keep, files.length) - 1]?.stamp;
  const retained = files.filter((f) => f.name === currentName || cutoff === undefined || f.stamp >= cutoff);
  if (retained.length > 1001) throw new Error('Too many equal-time public reports to retain safely. Reconcile publication ambiguity.');
  const retainedNames = new Set(retained.map((f) => f.name));
  const selected = files.filter((f) => !retainedNames.has(f.name));
  if (!selected.length) return { archived: 0, retained: retained.length, remaining: 0 };
  const archive = join(root, 'archive');
  mkdirSync(archive, { recursive: true, mode: 0o700 });
  if (!lstatSync(archive).isDirectory()) throw new Error('Public report archive must be a real directory.');
  // Validate all collisions before moving anything; never replace an archive entry.
  const plan = selected.map((f) => {
    const source = join(root, f.name), target = join(archive, f.name), existing = statIfPresent(target);
    if (existing && !sameFile(existing, f.stat)) throw new Error('Public report archive filename conflict. Existing copies were preserved.');
    return { ...f, source, target };
  });
  let archived = 0;
  for (const f of plan.slice(0, ARCHIVE_BATCH_LIMIT)) {
    if (!sameFile(lstatSync(f.source, { bigint: true }), f.stat)) throw new Error('Public report changed during archival. Existing copies were preserved.');
    if (!statIfPresent(f.target)) linkSync(f.source, f.target);
    if (!sameFile(lstatSync(f.target, { bigint: true }), f.stat)) throw new Error('Public report archive identity changed. Existing copies were preserved.');
    // Persist the archive link before removing the top-level link. A crash may leave two copies.
    const fd = openSync(f.target, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
    flushDirectory(archive);
    if (!sameFile(lstatSync(f.source, { bigint: true }), f.stat)) throw new Error('Public report changed during archival. Existing copies were preserved.');
    unlinkSync(f.source); flushDirectory(root); archived++;
  }
  return { archived, retained: retained.length, remaining: selected.length - archived };
}
