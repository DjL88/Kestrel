/**
 * "Open in another editor and come back" (desktop only; the Tauri adapter is `src-tauri/src/external_edit.rs`).
 *
 * InFlight writes the current edit as a 16-bit TIFF into its own working folder, opens it in the app the person chose,
 * and watches that file. A save is brought back only once it has settled (the size and modified time have stopped
 * changing for a moment), so a half-written file is never read. Each settled save becomes a new photo beside the
 * original, recording where it came from. The original photo and its recipe are never changed.
 *
 * Pure: no clock, no disk. The caller polls the file's stamp and acts on the step this returns.
 */
import type { PhotoFrame } from './types';

/** A file's size in bytes and its last modified time in milliseconds, as the desktop app reports them. */
export interface FileStamp { size: number; modifiedMs: number }

/** An app to open photos in. An empty path means the computer's default app for TIFF files. */
export interface ExternalApp { name: string; path: string }

/** How long a changed file must stay unchanged before it is read. Photoshop and Affinity write large TIFFs in pieces. */
export const SETTLE_MS = 2_500;
/** How often the working file is checked while a photo is out in another app. */
export const POLL_MS = 1_500;
/** Watching stops after this long; the TIFF stays in the working folder and the person can send the photo again. */
export const WATCH_LIMIT_MS = 12 * 60 * 60 * 1_000;
/** A save that cannot be read this many times in a row stops the watch with the reason, rather than retrying for ever. */
export const MAX_FAILED_READS = 3;

export interface ExternalEditWatch {
  /** The photo that was sent. Never changed by anything here. */
  frameId: string;
  sourceFilename: string;
  app: ExternalApp;
  /** The TIFF in InFlight's working folder. */
  tiffPath: string;
  sentAt: number;
  /** Bits per channel of the edit InFlight rendered: 16 from the 16-bit RAW path, otherwise 8 held in a 16-bit file. */
  sentBits: 8 | 16;
  /** How many of InFlight's own edit steps were in the picture that was sent. */
  stepsSent: number;
  /** The file as last brought back (or as written, before any save). A save is a change from this. */
  baseline: FileStamp;
  /** A change seen but not yet settled, and when it was first seen like this. */
  pending?: { stamp: FileStamp; since: number };
  /** Saves already brought back from this watch. */
  returned: number;
  failedReads: number;
}

export type WatchStep =
  | { kind: 'waiting' }
  | { kind: 'saving' }
  | { kind: 'bring-back'; stamp: FileStamp }
  | { kind: 'gone' }
  | { kind: 'expired' };

export const sameStamp = (a: FileStamp, b: FileStamp) => a.size === b.size && a.modifiedMs === b.modifiedMs;

export function startWatch(input: Omit<ExternalEditWatch, 'baseline' | 'pending' | 'returned' | 'failedReads'> & { stamp: FileStamp }): ExternalEditWatch {
  const { stamp, ...rest } = input;
  return { ...rest, baseline: stamp, returned: 0, failedReads: 0 };
}

/**
 * One check of the working file. `stamp` is null when the file is no longer there. Returns the watch to keep and what
 * to do now. On 'bring-back' the returned watch already counts that save; if reading it fails, use `afterFailedRead`.
 */
export function nextWatchStep(watch: ExternalEditWatch, stamp: FileStamp | null, now: number, settleMs = SETTLE_MS): { watch: ExternalEditWatch; step: WatchStep } {
  if (!stamp) return { watch, step: { kind: 'gone' } };
  if (now - watch.sentAt > WATCH_LIMIT_MS) return { watch, step: { kind: 'expired' } };
  if (sameStamp(stamp, watch.baseline)) {
    const { pending: _cleared, ...rest } = watch;
    return { watch: rest, step: { kind: 'waiting' } };
  }
  // An empty file is a save that has only just begun.
  if (stamp.size > 0 && watch.pending && sameStamp(watch.pending.stamp, stamp) && now - watch.pending.since >= settleMs) {
    const { pending: _settled, ...rest } = watch;
    return { watch: { ...rest, baseline: stamp, returned: watch.returned + 1, failedReads: 0 }, step: { kind: 'bring-back', stamp } };
  }
  const since = watch.pending && sameStamp(watch.pending.stamp, stamp) ? watch.pending.since : now;
  return { watch: { ...watch, pending: { stamp, since } }, step: { kind: 'saving' } };
}

/**
 * The settled save could not be read (still locked, or written in a way InFlight cannot read). Go back to the watch as
 * it was before that step and wait a full settle period again. Returns null once it has failed too often.
 */
export function afterFailedRead(before: ExternalEditWatch, stamp: FileStamp, now: number): ExternalEditWatch | null {
  const failedReads = before.failedReads + 1;
  if (failedReads >= MAX_FAILED_READS) return null;
  return { ...before, pending: { stamp, since: now }, failedReads };
}

const lastPart = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? '';

/** The name a person knows an app by, from its path: "Affinity Photo 2" from ".../Affinity Photo 2.app". */
export function appFromPath(path: string): ExternalApp | null {
  const trimmed = path.trim();
  const name = lastPart(trimmed).replace(/\.(app|exe)$/i, '').trim();
  if (!trimmed || !name) return null;
  return { name, path: trimmed };
}

/** Apps chosen before, most recent first, without repeats, at most `max`. */
export function rememberApp(list: readonly ExternalApp[], app: ExternalApp, max = 5): ExternalApp[] {
  const key = (entry: ExternalApp) => entry.path.toLowerCase();
  return [app, ...list.filter((entry) => key(entry) !== key(app))].slice(0, max);
}

/** Apps read back from settings: anything malformed is dropped, never shown. */
export function readApps(value: unknown): ExternalApp[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const { name, path } = entry as Record<string, unknown>;
    return typeof name === 'string' && name.trim() && typeof path === 'string' && path.trim() ? [{ name: name.trim(), path: path.trim() }] : [];
  }).slice(0, 5);
}

const stemOf = (filename: string) => (filename.replace(/\.[^.]+$/, '') || 'photo').replace(/[\\/:*?"<>|]/g, '_');
const pad = (n: number) => String(n).padStart(2, '0');

/** The working TIFF's name (without extension): the photo's name and when it was sent, so repeated sends never clash. */
export function workingFileName(filename: string, at: Date): string {
  return `${stemOf(filename)} InFlight edit ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
}

/** The returned photo's name: "DSC_0001 edited in Photoshop.png", then "(2)", "(3)" for later saves. */
export function returnedFileName(filename: string, appName: string, round: number): string {
  const app = appName.replace(/[\\/:*?"<>|]/g, '_').trim() || 'another app';
  return `${stemOf(filename)} edited in ${app}${round > 1 ? ` (${round})` : ''}.png`;
}

/** Recorded on the photo that came back, so its history says where it came from. */
export interface ExternalEditRecord {
  fromFrameId: string;
  fromFilename: string;
  appName: string;
  sentAt: number;
  returnedAt: number;
  /** 1 for the first save brought back from one send, 2 for the next... */
  round: number;
  sentBits: 8 | 16;
  /** Bits per channel the other app actually saved. */
  savedBits: 8 | 16 | 32;
  stepsSent: number;
  /**
   * The colour profile the other app saved, by its name ("Adobe RGB (1998)"), kept in the returned file. Null: it saved
   * none. Absent on records made before profiles were carried back: not known.
   */
  savedProfile?: string | null;
}

export function externalEditRecord(watch: ExternalEditWatch, returnedAt: number, savedBits: number, savedProfile: string | null): ExternalEditRecord {
  return {
    savedProfile,
    fromFrameId: watch.frameId, fromFilename: watch.sourceFilename, appName: watch.app.name,
    sentAt: watch.sentAt, returnedAt, round: watch.returned, sentBits: watch.sentBits,
    savedBits: savedBits === 8 || savedBits === 32 ? savedBits : 16, stepsSent: watch.stepsSent,
  };
}

/** A stored record, checked: a malformed one is ignored, never shown as history. */
export function readExternalEdit(value: unknown): ExternalEditRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const text = (key: string) => (typeof v[key] === 'string' && (v[key] as string).trim() ? (v[key] as string) : null);
  const count = (key: string) => (typeof v[key] === 'number' && Number.isSafeInteger(v[key]) && (v[key] as number) >= 0 ? (v[key] as number) : null);
  const fromFrameId = text('fromFrameId'), fromFilename = text('fromFilename'), appName = text('appName');
  const sentAt = count('sentAt'), returnedAt = count('returnedAt'), round = count('round'), stepsSent = count('stepsSent');
  if (!fromFrameId || !fromFilename || !appName || sentAt === null || returnedAt === null || !round || stepsSent === null) return undefined;
  if (v.sentBits !== 8 && v.sentBits !== 16) return undefined;
  if (v.savedBits !== 8 && v.savedBits !== 16 && v.savedBits !== 32) return undefined;
  const savedProfile = v.savedProfile === null ? null : typeof v.savedProfile === 'string' && v.savedProfile.trim() ? v.savedProfile.trim().slice(0, 200) : undefined;
  return { fromFrameId, fromFilename, appName, sentAt, returnedAt, round, stepsSent, sentBits: v.sentBits, savedBits: v.savedBits, ...(savedProfile !== undefined ? { savedProfile } : {}) };
}

/** The name to record for a profile the other app saved: its own description, or a plain stand-in when it has none. */
export function profileName(description: string | null, present: boolean): string | null {
  if (!present) return null;
  return description?.trim() || 'an unnamed colour profile';
}

/** True when a named profile is sRGB, so the picture needs no conversion to be shown and exported as it was saved. */
export const isSrgbProfile = (name: string | null | undefined) => typeof name === 'string' && /\bsRGB\b/i.test(name);

/** How many of InFlight's edit steps are in the picture as it stands (undone steps are not). */
export function stepsInEdit(frame: Pick<PhotoFrame, 'editHistory'>): number {
  const history = frame.editHistory;
  if (!history || !Number.isSafeInteger(history.cursor) || history.cursor < 0) return 0;
  return Math.min(history.cursor, history.steps.length) + (history.discarded ?? 0);
}

/**
 * The capture details of the photo that came back: the original's camera, lens, exposure and capture time (the returned
 * PNG carries none of its own), but never its pixel size, file format or embedded-preview flag, which describe the
 * original file rather than this one.
 */
export function returnedExif(original: PhotoFrame['exif']): PhotoFrame['exif'] {
  const { width: _w, height: _h, formatLabel: _f, isEmbeddedPreviewOnly: _p, rating: _r, rejectedByMetadata: _x, ...capture } = original;
  return capture;
}

/**
 * Put the returned photos straight after their original (after any earlier ones brought back from it), so they sit
 * beside it in shoot order. Everything else keeps its place.
 */
export function placeBeside(frames: readonly PhotoFrame[], returnedIds: readonly string[], originalId: string): PhotoFrame[] {
  const moving = new Set(returnedIds);
  const moved = frames.filter((frame) => moving.has(frame.id));
  const rest = frames.filter((frame) => !moving.has(frame.id));
  const at = rest.findIndex((frame) => frame.id === originalId);
  if (at < 0 || !moved.length) return [...frames];
  let end = at + 1;
  while (end < rest.length && readExternalEdit(rest[end].externalEdit)?.fromFrameId === originalId) end += 1;
  return [...rest.slice(0, end), ...moved, ...rest.slice(end)];
}
