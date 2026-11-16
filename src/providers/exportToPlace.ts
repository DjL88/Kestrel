import { exportPaths } from '../core/exportPlace';
import { connections, openConnection } from './connectionStore';
import { getLocations } from './projectLocations';

export interface ExportPlace {
  label: string;
  /** Save copies into the "export" folder there, in a new dated folder. Never overwrites, never throws. */
  save: (files: File[]) => Promise<{ ok: true; count: number } | { ok: false; message: string }>;
}

/** Where this project's exports are also saved, if the person chose a place for that. */
export function exportPlaceFor(projectId: string): ExportPlace | null {
  const id = getLocations(projectId).exportTo;
  const connection = connections().find((candidate) => candidate.id === id);
  if (!id || !connection) return null;
  return {
    label: connection.label,
    async save(files) {
      const opened = await openConnection(id);
      if ('problem' in opened) return { ok: false, message: opened.message };
      // A minute-level folder name is not unique: two exports in the same minute
      // could otherwise replace one another on remote or mounted storage.
      const runId = crypto.randomUUID();
      const paths = exportPaths(files, new Date(), runId);
      let count = 0;
      try {
        for (let i = 0; i < files.length; i += 1) { await opened.connector.put(paths[i], new Uint8Array(await files[i].arrayBuffer()), ''); count += 1; }
        return { ok: true, count };
      } catch (error) {
        return { ok: false, message: `${count ? `Saved ${count} of ${files.length}, then it stopped: ` : ''}${error instanceof Error ? error.message : 'The files could not be saved there.'}` };
      }
    },
  };
}
