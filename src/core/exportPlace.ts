/**
 * Saving a copy of exports into an "export" folder in a place the person chose, for example the drive their originals
 * are on. Each save goes into its own dated folder, so nothing already there is ever overwritten.
 */
const two = (n: number) => String(n).padStart(2, '0');

/** "export/2026-11-16 14-30": the folder for exports saved at this time. */
export const exportRunFolder = (now: Date, runId?: string) => `export/${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}-${two(now.getMinutes())}${runId ? `-${runId}` : ''}`;

/** A file name that is safe inside that folder: no folders, no tricks, never empty. */
export function safeExportName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim().slice(0, 150);
  return cleaned || 'export.jpg';
}

/** Where each file goes. Two files with the same name in one save get a number, so neither replaces the other. */
export function exportPaths(files: readonly { name: string }[], now: Date, runId?: string): string[] {
  const folder = exportRunFolder(now, runId);
  const used = new Set<string>();
  return files.map((file) => {
    const name = safeExportName(file.name);
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ending = dot > 0 ? name.slice(dot) : '';
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n += 1) candidate = `${stem}-${n}${ending}`;
    used.add(candidate.toLowerCase());
    return `${folder}/${candidate}`;
  });
}
