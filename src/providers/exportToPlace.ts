import type { ExportFormat } from '../core/exportFormats';
import { exportPaths, writeExportFiles } from '../core/exportPlace';
import { createExportRunSession } from '../core/exportRunSession';
import { connections, openConnection } from './connectionStore';
import { getLocations } from './projectLocations';

export interface ExportBatchDestination {
  folder: string;
  save(file: File, subfolder: string, signal: AbortSignal): Promise<void>;
}

export interface ExportPlace {
  label: string;
  /** A user-granted destination for one app-owned export run. */
  openBatch(): Promise<ExportBatchDestination>;
  /** Save copies into the "export" folder there, in a new dated folder. Never overwrites, never throws. */
  save: (files: File[], platforms?: readonly ExportFormat['platform'][], options?: {
    signal?: AbortSignal;
    onProgress?: (count: number) => void;
  }) => Promise<{ ok: true; count: number } | { ok: false; message: string; stopped?: boolean }>;
}

/** Where this project's exports are also saved, if the person chose a place for that. */
export function exportPlaceFor(projectId: string): ExportPlace | null {
  const id = getLocations(projectId).exportTo;
  const connection = connections().find((candidate) => candidate.id === id);
  if (!id || !connection) return null;
  return {
    label: connection.label,
    async openBatch() {
      const opened = await openConnection(id);
      if ('problem' in opened) throw new Error(opened.message);
      return createExportRunSession(opened.connector, new Date(), crypto.randomUUID());
    },
    async save(files, platforms, options) {
      const opened = await openConnection(id);
      if ('problem' in opened) return { ok: false, message: opened.message };
      // A minute-level folder name is not unique: two exports in the same minute
      // could otherwise replace one another on remote or mounted storage.
      const runId = crypto.randomUUID();
      const paths = exportPaths(files.map((file, index) => ({ name: file.name, platform: platforms?.[index] })), new Date(), runId);
      let count = 0;
      try {
        const result = await writeExportFiles(files, paths, (path, bytes) => opened.connector.put(path, bytes, ''), {
          signal: options?.signal,
          onProgress: (saved) => { count = saved; options?.onProgress?.(saved); },
        });
        if (result.stopped) return { ok: false, stopped: true, message: `Stopped after saving ${result.count} of ${files.length} files.` };
        return { ok: true, count: result.count };
      } catch (error) {
        return { ok: false, message: `${count ? `Saved ${count} of ${files.length}, then it stopped: ` : ''}${error instanceof Error ? error.message : 'The files could not be saved there.'}` };
      }
    },
  };
}
