import { PLATFORMS, type ExportFormat } from './exportFormats';

/**
 * Saving a copy of exports into an "export" folder in a place the person chose, for example the drive their originals
 * are on. Each save goes into its own dated folder, so nothing already there is ever overwritten.
 */
const two = (n: number) => String(n).padStart(2, '0');

/** "export/2026-11-16 14-30": the folder for exports saved at this time. */
export const exportRunFolder = (now: Date, runId?: string) => `export/${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}-${two(now.getMinutes())}${runId ? `-${runId}` : ''}`;

/** A file name that is safe inside that folder: no folders, no tricks, never empty. */
const MAX_NAME_LENGTH = 150;
function boundedName(stem: string, extension: string, suffix = ''): string {
  return stem.slice(0, Math.max(1, MAX_NAME_LENGTH - extension.length - suffix.length)).replace(/[. ]+$/, '') + suffix + extension;
}
const filenameKey = (path: string) => path.normalize('NFC').toLowerCase();

export function safeExportName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim().replace(/[. ]+$/, '');
  if (!cleaned) return 'export.jpg';
  const extension = /\.[a-zA-Z0-9]{1,8}$/.exec(cleaned)?.[0] ?? '';
  return boundedName(extension ? cleaned.slice(0, -extension.length) : cleaned, extension);
}

/** Where each file goes. Two files with the same name in one save get a number, so neither replaces the other. */
export function exportPaths(files: readonly { name: string; platform?: ExportFormat['platform'] }[], now: Date, runId?: string): string[] {
  const folder = exportRunFolder(now, runId);
  const used = new Set<string>();
  return files.map((file) => {
    const platform = PLATFORMS.find(({ id }) => id === file.platform)?.id;
    const destination = platform ? `${folder}/${platform}` : folder;
    let name = safeExportName(file.name);
    // Windows device names are not valid output names, even with a suffix.
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = safeExportName('_' + name);
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ending = dot > 0 ? name.slice(dot) : '';
    let candidate = name;
    for (let n = 2; used.has(filenameKey(`${destination}/${candidate}`)); n += 1) candidate = boundedName(stem, ending, `-${n}`);
    used.add(filenameKey(`${destination}/${candidate}`));
    return `${destination}/${candidate}`;
  });
}

/** Stop at file boundaries so a connector can finish any write already in progress. */
export async function writeExportFiles(
  files: readonly Blob[],
  paths: readonly string[],
  write: (path: string, bytes: Uint8Array) => Promise<unknown>,
  options?: { signal?: AbortSignal; onProgress?: (count: number) => void },
): Promise<{ count: number; stopped: boolean }> {
  if (files.length !== paths.length || new Set(paths.map(filenameKey)).size !== paths.length) {
    throw new Error('Export destinations must match the files and be unique. No files were written.');
  }
  let count = 0;
  for (const [index, file] of files.entries()) {
    if (options?.signal?.aborted) return { count, stopped: true };
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (options?.signal?.aborted) return { count, stopped: true };
    await write(paths[index], bytes);
    count += 1;
    options?.onProgress?.(count);
  }
  return { count, stopped: false };
}
