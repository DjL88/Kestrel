import type { PhotoFrame } from '../../core/types';
import { openLinkedRange } from '../../providers/rangeBlob';
import type { OriginalByteSource } from '../../core/originalFileIdentity';
import {
  matchScannedOriginalsBySha, scanOriginalFolder,
  type NativeDirectoryEntry, type ScannedOriginal, type ScannedOriginalRead,
} from '../../providers/nativeOriginalScan';

/**
 * Desktop Reconnect for V2: the person picks a folder or drive, and every photo of the project whose original is not
 * connected is looked for inside it. A candidate must have the same filename and size AND the same full-file SHA-256
 * recorded at import. A file that only shares the name (another card's DSC_0001.NEF, an edited export, a copy with
 * different bytes) is never linked. Two identical copies stay ambiguous for the person to choose. Nothing is written to
 * any original; only the catalogue's saved path changes, and only for photos whose bytes were proved.
 *
 * The filesystem is injected so the same code runs against Tauri's plugin-fs in the app and node:fs in the release test.
 */
export interface RelinkFs {
  readDir(path: string): Promise<NativeDirectoryEntry[]>;
  stat(path: string): Promise<{ isFile: boolean; isSymlink?: boolean; size: number; mtime?: Date | null }>;
  /** Ranged reader over the whole file; closed after hashing. */
  openRange(path: string, size: number): Promise<{ blob: OriginalByteSource; close(): Promise<void> }>;
}

export interface DesktopRelinkPlan {
  /** stableKey → the new verified path. */
  replacements: Map<string, string>;
  /** Photos looked for that were not found with matching bytes. */
  notFound: number;
  /** Photos with more than one identical candidate: left for the person to choose. */
  ambiguous: number;
  /** Older photos imported before a fingerprint was recorded: cannot be proved, never guessed. */
  unverifiable: number;
  truncated: boolean;
  skippedDirectories: number;
}

const sizeFromKey = (key: string) => Number(key.split('::').at(-2)) || 0;

/** The photos Reconnect should look for: linked desktop originals the preview provider cannot read now. */
export function framesNeedingRelink(frames: readonly PhotoFrame[], isConnected: (stableKey: string) => boolean): PhotoFrame[] {
  const seen = new Set<string>();
  return frames.filter((frame) => {
    if (frame.removedAt || frame.isDemo || frame.sourceKind !== 'file' || !frame.sourcePath) return false;
    if (isConnected(frame.stableKey) || seen.has(frame.stableKey)) return false;
    seen.add(frame.stableKey);
    return true;
  });
}

export async function planDesktopRelink(
  missing: readonly PhotoFrame[],
  /** Paths of originals that are connected now: never handed to a second photo. */
  connectedPaths: readonly string[],
  folder: string,
  fs: RelinkFs,
  /** False once the project changed: stop reading and return nothing. */
  stillCurrent: () => boolean = () => true,
): Promise<DesktopRelinkPlan> {
  const empty: DesktopRelinkPlan = { replacements: new Map(), notFound: 0, ambiguous: 0, unverifiable: 0, truncated: false, skippedDirectories: 0 };
  const provable = missing.filter((frame) => typeof frame.originalSha256 === 'string' && /^[a-f0-9]{64}$/.test(frame.originalSha256));
  const unverifiable = missing.length - provable.length;
  if (!provable.length) return { ...empty, unverifiable };
  const found = await scanOriginalFolder(folder, fs.readDir, fs.stat, new Set(provable.map((frame) => frame.filename.toLowerCase())));
  if (!stillCurrent()) return empty;
  const byPath = new Map(found.files.map((file) => [file.path, file]));
  const open = async (path: string): Promise<ScannedOriginalRead> => {
    if (!stillCurrent()) throw new Error('Project changed during reconnect.');
    const scanned: ScannedOriginal | undefined = byPath.get(path);
    if (!scanned) throw new Error('Candidate is not part of the chosen folder.');
    const before = await fs.stat(path);
    // The file must still be the one the scan saw: same size and time, an ordinary file, not a link.
    if (!before.isFile || before.isSymlink || before.size !== scanned.size ||
        (before.mtime && before.mtime.getTime() !== scanned.lastModified)) throw new Error('Candidate changed before verification.');
    const range = await fs.openRange(path, before.size);
    return {
      bytes: range.blob,
      unchanged: async () => {
        const after = await fs.stat(path);
        return stillCurrent() && after.isFile && !after.isSymlink && after.size === before.size &&
          !(before.mtime && after.mtime && before.mtime.getTime() !== after.mtime.getTime());
      },
      close: range.close,
    };
  };
  const result = await matchScannedOriginalsBySha(
    provable.map((frame) => ({ stableKey: frame.stableKey, filename: frame.filename, size: sizeFromKey(frame.stableKey), originalSha256: frame.originalSha256 })),
    found.files, connectedPaths, open,
  );
  if (!stillCurrent()) return empty;
  return {
    replacements: result.matches,
    notFound: provable.length - result.matches.size - result.ambiguous.length,
    ambiguous: result.ambiguous.length,
    unverifiable,
    truncated: found.truncated,
    skippedDirectories: found.skippedDirectories,
  };
}

/**
 * The catalogue change: only the saved path moves, and only for a frame that still has the path and fingerprint the
 * plan was made from (an edit, removal or second reconnect in the meantime wins). Decisions, ratings, recipes,
 * history, virtual copies and the stableKey identity are untouched.
 */
export function applyDesktopRelink(
  frames: readonly PhotoFrame[],
  planned: readonly PhotoFrame[],
  replacements: ReadonlyMap<string, string>,
): PhotoFrame[] {
  const expected = new Map(planned.map((frame) => [frame.stableKey, frame]));
  return frames.map((frame) => {
    const path = replacements.get(frame.stableKey);
    const was = expected.get(frame.stableKey);
    if (!path || !was || frame.sourcePath !== was.sourcePath || frame.originalSha256 !== was.originalSha256) return frame;
    return { ...frame, sourcePath: path };
  });
}

/** The desktop app's system folder dialog. Read-only: it returns a path, or null when the person cancels. */
export async function pickRelinkFolder(title: string): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const folder = await open({ directory: true, multiple: false, recursive: true, title });
  return typeof folder === 'string' ? folder : null;
}

/** Tauri's file system, read-only: list folders, look at files, and read byte ranges. Nothing here writes. */
export async function tauriRelinkFs(): Promise<RelinkFs> {
  const fs = await import('@tauri-apps/plugin-fs');
  return { readDir: fs.readDir, stat: fs.lstat, openRange: (path, size) => openLinkedRange(path, size) };
}
