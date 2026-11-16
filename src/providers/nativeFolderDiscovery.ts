/**
 * Camera-brand-agnostic, bounded discovery of photographs in a selected folder.
 * Returns paths only: no photo bytes are loaded while discovering a shoot.
 */
export interface FolderEntry { name: string; isFile: boolean; isDirectory: boolean; isSymlink?: boolean }
export interface FolderDiscovery {
  paths: string[];
  truncated: boolean;
  skippedFolders: number;
}
export async function discoverPhotoPaths(
  root: string,
  readDir: (path: string) => Promise<FolderEntry[]>,
  extensions: ReadonlySet<string>,
  limits: { maxEntries?: number; maxDepth?: number; maxPhotos?: number } = {},
): Promise<FolderDiscovery> {
  const maxEntries = Math.max(1, limits.maxEntries ?? 50000);
  const maxPhotos = Math.max(1, limits.maxPhotos ?? 20000);
  const maxDepth = Math.max(0, limits.maxDepth ?? 12);
  const queue = [{ path: root, depth: 0 }];
  const paths: string[] = [];
  let visited = 0, skippedFolders = 0, truncated = false;
  while (queue.length) {
    const current = queue.shift()!;
    let entries: FolderEntry[];
    try { entries = await readDir(current.path); }
    catch { skippedFolders++; continue; }
    for (const entry of entries) {
      if (visited >= maxEntries || paths.length >= maxPhotos) { truncated = true; break; }
      visited++;
      if (entry.isSymlink) continue;
      const path = current.path.replace(/[\\/]+$/, '') + '/' + entry.name;
      if (entry.isDirectory) {
        if (current.depth < maxDepth) queue.push({ path, depth: current.depth + 1 });
        else skippedFolders++;
      } else if (entry.isFile) {
        const extension = entry.name.split('.').at(-1)?.toLowerCase() ?? '';
        if (extensions.has(extension)) paths.push(path);
      }
    }
    if (truncated) break;
  }
  return { paths, truncated, skippedFolders };
}
