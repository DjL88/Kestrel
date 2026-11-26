import { hasNativeRaw } from './desktopShell';

/**
 * Import reads done by the desktop app itself, one call for many small things (src-tauri/src/import_io.rs). Importing a
 * 2,000-RAW folder used to cross the bridge tens of thousands of times: a `stat` per photo while looking through the
 * folder, and a seek and a read per MiB to fingerprint each original. Each function here returns null when the app
 * can't answer (a browser, a phone, an older desktop build or an error), so the caller falls back to the page's own
 * reads: slower, never a different answer.
 */
export interface NativePhotoStat { size: number; modifiedMs: number }

/** Paths per call: one call covers a 2,000-photo folder, and the app refuses more than 20,000. */
export const STAT_BATCH = 5_000;

async function call<T>(command: string, args: Record<string, unknown>): Promise<T | null> {
  if (!hasNativeRaw()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

/** Size and modified time of each path, in order (null for one that is not a readable, granted file); null if unavailable. */
export async function nativePhotoStats(paths: readonly string[]): Promise<Array<NativePhotoStat | null> | null> {
  const out: Array<NativePhotoStat | null> = [];
  for (let at = 0; at < paths.length; at += STAT_BATCH) {
    const batch = paths.slice(at, at + STAT_BATCH);
    const answer = await call<Array<NativePhotoStat | null>>('photo_stats', { paths: batch });
    if (!answer || answer.length !== batch.length) return null;
    out.push(...answer);
  }
  return out;
}

/**
 * Whole-file reads one after another. The owner's photos are on a spinning USB disk (about 34 MB/s read whole): several
 * whole-file reads at once make its head seek between files and every read slower. So whole files are read by one
 * reader in turn, while the lanes of an import still decode and encode previews on several cores at once.
 */
let wholeFileQueue: Promise<unknown> = Promise.resolve();
export function oneWholeFileReadAtATime<T>(read: () => Promise<T>): Promise<T> {
  const turn = wholeFileQueue.then(read, read);
  wholeFileQueue = turn.catch(() => undefined);
  return turn;
}

/** The original's SHA-256 (lower-case hex), read once by the app; null when the app can't, so the caller reads it itself. */
export async function nativeFingerprint(path: string, size?: number): Promise<string | null> {
  const answer = await oneWholeFileReadAtATime(() => call<{ sha256: string; size: number }>('photo_fingerprint', { path, size: size ?? null }));
  if (!answer || !/^[0-9a-f]{64}$/.test(answer.sha256) || (size !== undefined && answer.size !== size)) return null;
  return answer.sha256;
}
