import type { OperationsSnapshot } from '../domain/operations';
import { reportPublicationTime } from '../domain/reportFiles';

// A deliberately read-only subset of the native API. No write or persistence ports.
export interface ReportEntry {
  kind: string; name: string;
  getFile?: () => Promise<{ size: number; text: () => Promise<string> }>;
}
export interface ReportDirectory { name: string; values: () => AsyncIterable<ReportEntry> }
type PickerWindow = Window & { showDirectoryPicker?: (options: { mode: 'read' }) => Promise<ReportDirectory> };
export function folderSupported(): boolean {
  return window.isSecureContext && typeof (window as PickerWindow).showDirectoryPicker === 'function';
}
export function chooseReportDirectory(): Promise<ReportDirectory> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!folderSupported() || !picker) return Promise.reject(new Error('Folder access is unavailable in this browser. Import a public report instead.'));
  return picker.call(window, { mode: 'read' });
}
export const FOLDER_ENTRY_LIMIT = 2_000;
export const FOLDER_CHECK_MS = 5_000;
class FolderReadError extends Error {}
export type FolderUpdate = { report: OperationsSnapshot | null; fileName: string; error: string };
export function reportFolderReader(parse: (text: string) => OperationsSnapshot, fileLimit: number) {
  let previous: { stamp: bigint; name: string; text: string; captured: number } | undefined;
  let scope: string | undefined, synthetic: boolean | undefined;
  let newestSeen: { stamp: bigint; name?: string } | undefined;
  return async (directory: ReportDirectory, signal: AbortSignal): Promise<FolderUpdate | undefined> => {
    const active = () => { if (signal.aborted) throw new Error('Cancelled'); };
    try {
      active();
      let count = 0, latest: { entry: ReportEntry; stamp: bigint } | undefined, tied = false;
      for await (const entry of directory.values()) {
        active();
        if (++count > FOLDER_ENTRY_LIMIT) throw new FolderReadError('This folder exceeds 2,000 entries. Choose a smaller public-report folder.');
        const stamp = entry.kind === 'file' ? reportPublicationTime(entry.name) : undefined;
        if (stamp === undefined) continue;
        if (!latest || stamp > latest.stamp) { latest = { entry, stamp }; tied = false; }
        else if (stamp === latest.stamp) tied = true;
      }
      active();
      if (!latest) throw new FolderReadError('No completed observer reports found. Waiting for an observation-…json file.');
      if (newestSeen && (latest.stamp < newestSeen.stamp || (latest.stamp === newestSeen.stamp && latest.entry.name !== newestSeen.name))) throw new FolderReadError('The latest report disappeared or publication order changed. Waiting for a newer observation.');
      newestSeen = { stamp: latest.stamp, name: tied ? undefined : latest.entry.name };
      if (tied) throw new FolderReadError('The newest reports have the same publication time. No report was chosen; wait for a later observation.');
      if (previous && (latest.stamp < previous.stamp || (latest.stamp === previous.stamp && latest.entry.name !== previous.name))) throw new FolderReadError('The latest report disappeared or publication order changed. Waiting for a newer observation.');
      if (!latest.entry.getFile) throw new FolderReadError('This report cannot be read.');
      const file = await latest.entry.getFile(); active();
      if (file.size > fileLimit) throw new FolderReadError('The newest report exceeds 2 MB. No older report is substituted.');
      const text = await file.text(); active();
      if (previous?.name === latest.entry.name && previous.text !== text) throw new FolderReadError('A published report was changed. Waiting for a new observation.');
      let report: OperationsSnapshot;
      try { report = parse(text); } catch { throw new FolderReadError('The newest report is invalid. No older report is substituted.'); }
      if (!report.observer || report.kind === 'readiness') throw new FolderReadError('Choose reports from the continuous public observer. This file is not a watch report.');
      const captured = Date.parse(report.capturedAt);
      if (previous && captured < previous.captured) throw new FolderReadError('Report capture time moved backwards. Waiting for a newer observation.');
      if ((scope !== undefined && report.observationScope !== undefined && scope !== report.observationScope) ||
        (synthetic !== undefined && synthetic !== report.synthetic)) throw new FolderReadError('Report deployment or example scope changed. Select the intended report folder again.');
      scope ??= report.observationScope; synthetic ??= report.synthetic;
      previous = { stamp: latest.stamp, name: latest.entry.name, text, captured };
      return { report, fileName: latest.entry.name, error: '' };
    } catch (error) {
      if (signal.aborted) return undefined;
      // Only our own messages are exposed; native filesystem errors can contain paths.
      const own = error instanceof FolderReadError;
      return { report: null, fileName: '', error: own ? error.message : 'Folder access failed. Re-select the public-report folder if access was removed.' };
    }
  };
}

// One read at a time, with the delay after completion; cancellation suppresses late output.
export function watchReportFolder(read: (signal: AbortSignal) => Promise<FolderUpdate | undefined>, emit: (update: FolderUpdate) => void,
  schedule: (callback: () => void, delay: number) => () => void = (callback, delay) => {
    const timer = window.setTimeout(callback, delay); return () => window.clearTimeout(timer);
  }): () => void {
  const controller = new AbortController(); let cancelTimer: (() => void) | undefined;
  const tick = async () => {
    if (controller.signal.aborted) return;
    const update = await read(controller.signal);
    if (controller.signal.aborted) return;
    if (update) emit(update);
    if (!controller.signal.aborted) cancelTimer = schedule(() => { void tick(); }, FOLDER_CHECK_MS);
  };
  void tick();
  return () => { controller.abort(); cancelTimer?.(); };
}
