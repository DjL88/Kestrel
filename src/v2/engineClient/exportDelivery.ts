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
  archive: (files: File[]) => Promise<Blob>, download: (blob: Blob, name: string) => void,
) {
  signal.throwIfAborted();
  if (destination === 'local-zip') {
    const zip = await archive(files);
    signal.throwIfAborted();
    download(zip, `inflight-export-${started.toISOString().slice(0, 10)}.zip`);
  } else if (destination === 'local-individual') {
    for (const file of files) {
      signal.throwIfAborted();
      download(file, file.name);
    }
  } else {
    throw new Error('Choose a local download destination.');
  }
}