import { chooseDesktopExportFolder } from '../../providers/desktopShell';
import type { ExportDestination } from '../ui/contract';

export function describeExport(count: number, missingOriginals: readonly string[]): string {
  const result = count ? `Exported ${count} file${count === 1 ? '' : 's'}.` : 'No files exported.';
  if (!missingOriginals.length) return result;
  const names = missingOriginals.slice(0, 3).join(', ');
  const extra = missingOriginals.length > 3 ? ` and ${missingOriginals.length - 3} more` : '';
  return `${result} Reconnect the missing original${missingOriginals.length === 1 ? '' : 's'} to export: ${names}${extra}.`;
}

export async function deliverExport(
  files: File[], destination: ExportDestination, started: Date, signal: AbortSignal,
  archive: (files: File[]) => Promise<Blob>, download: (blob: Blob, name: string, signal: AbortSignal) => Promise<boolean>,
  chooseFolder = chooseDesktopExportFolder,
) {
  signal.throwIfAborted();
  if (destination === 'local-zip') {
    const zip = await archive(files);
    signal.throwIfAborted();
    return await download(zip, `inflight-export-${started.toISOString().slice(0, 10)}.zip`, signal) ? files.length : 0;
  } else if (destination === 'local-individual' || destination === 'local-folder') {
    const folder = destination === 'local-folder' ? await chooseFolder() : null;
    if (destination === 'local-folder' && !folder) return 0;
    let delivered = 0;
    for (const file of files) {
      signal.throwIfAborted();
      try {
        if (folder) await folder.save(file, '', signal);
        else if (!await download(file, file.name, signal)) break;
        delivered++;
      } catch (reason) {
        if (signal.aborted) throw reason;
        const detail = reason instanceof Error ? reason.message : 'Write failed.';
        throw new Error(`Saved ${delivered} of ${files.length} files. Could not save ${file.name}. ${detail}`);
      }
    }
    return delivered;
  } else {
    throw new Error('Choose a local download destination.');
  }
}