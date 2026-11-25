/**
 * Comments on photos in a shared project (#1387): threads pinned to a point on the photo, with replies, resolve and
 * reopen. The app and the control plane both use these rules, so they cannot drift apart.
 *
 * A pin is relative to the photograph (0..1 on each axis, like the live cursors in editingSequence.ts), so it lands on
 * the same feather at any zoom, crop preview or screen size. A thread may also have no pin (about the whole photo).
 * A comment is text only: no photo, preview, file name or EXIF is stored with it. Resolving never deletes anything;
 * the thread and its replies stay, and reopening puts it back with the open ones.
 */
import type { PhotoPoint } from './editingSequence';

export const COMMENT_MAX_CHARS = 2000;
export const COMMENT_MAX_ENTRIES = 200;
export const COMMENT_MAX_THREADS_PER_PHOTO = 300;

export interface CommentEntry { id: string; authorAccountId: string; authorName: string; text: string; atMs: number }
export interface CommentThread {
  id: string;
  photoId: string;
  /** Where on the photo, relative (0..1). Null: about the whole photo. */
  pin: PhotoPoint | null;
  entries: CommentEntry[];
  /** Set while resolved; cleared when reopened. */
  resolved: { byAccountId: string; byName: string; atMs: number } | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export type CommentRefusal = 'empty' | 'too-long' | 'bad-pin' | 'thread-full' | 'photo-full' | 'already-resolved' | 'not-resolved';
export type CommentResult = { ok: true; thread: CommentThread } | { ok: false; reason: CommentRefusal };

/** Trims, and refuses empty or over-long text. Control characters other than line breaks and tabs are removed. */
export function cleanCommentText(text: unknown): { ok: true; text: string } | { ok: false; reason: 'empty' | 'too-long' } {
  // eslint-disable-next-line no-control-regex
  const cleaned = String(text ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim();
  if (!cleaned) return { ok: false, reason: 'empty' };
  if ([...cleaned].length > COMMENT_MAX_CHARS) return { ok: false, reason: 'too-long' };
  return { ok: true, text: cleaned };
}

/** A pin must be a point on the photo itself. */
export function validPin(pin: unknown): pin is PhotoPoint {
  if (!pin || typeof pin !== 'object') return false;
  const { x, y } = pin as Record<string, unknown>;
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1;
}

export function startThread(
  input: { id: string; entryId: string; photoId: string; pin: unknown; authorAccountId: string; authorName: string; text: unknown },
  existingOnPhoto: number, atMs: number,
): CommentResult {
  if (input.pin !== null && input.pin !== undefined && !validPin(input.pin)) return { ok: false, reason: 'bad-pin' };
  if (existingOnPhoto >= COMMENT_MAX_THREADS_PER_PHOTO) return { ok: false, reason: 'photo-full' };
  const text = cleanCommentText(input.text);
  if (!text.ok) return text;
  const pin = input.pin ? { x: (input.pin as PhotoPoint).x, y: (input.pin as PhotoPoint).y } : null;
  return {
    ok: true,
    thread: {
      id: input.id, photoId: input.photoId, pin, resolved: null, createdAtMs: atMs, updatedAtMs: atMs,
      entries: [{ id: input.entryId, authorAccountId: input.authorAccountId, authorName: input.authorName.slice(0, 80), text: text.text, atMs }],
    },
  };
}

/** A reply. Replying to a resolved thread reopens it: the conversation is clearly not over. */
export function reply(thread: CommentThread, entry: { id: string; authorAccountId: string; authorName: string; text: unknown }, atMs: number): CommentResult {
  if (thread.entries.length >= COMMENT_MAX_ENTRIES) return { ok: false, reason: 'thread-full' };
  const text = cleanCommentText(entry.text);
  if (!text.ok) return text;
  return {
    ok: true,
    thread: { ...thread, resolved: null, updatedAtMs: atMs, entries: [...thread.entries, { id: entry.id, authorAccountId: entry.authorAccountId, authorName: entry.authorName.slice(0, 80), text: text.text, atMs }] },
  };
}

export function resolveThread(thread: CommentThread, by: { accountId: string; name: string }, atMs: number): CommentResult {
  if (thread.resolved) return { ok: false, reason: 'already-resolved' };
  return { ok: true, thread: { ...thread, resolved: { byAccountId: by.accountId, byName: by.name.slice(0, 80), atMs }, updatedAtMs: atMs } };
}

export function reopenThread(thread: CommentThread, atMs: number): CommentResult {
  if (!thread.resolved) return { ok: false, reason: 'not-resolved' };
  return { ok: true, thread: { ...thread, resolved: null, updatedAtMs: atMs } };
}

/**
 * Who sees a thread. Team comments are never shown to a client; a client (when the owner lets clients comment) sees
 * only the threads they started.
 */
export function threadVisibleTo(thread: CommentThread, viewer: { accountId: string; isClient: boolean }): boolean {
  return !viewer.isClient || thread.entries[0]?.authorAccountId === viewer.accountId;
}

/**
 * Open threads first, each group oldest first, numbered by when they were started so a pin keeps its number when
 * others are resolved. The number is shown on the pin and in the list, so pins are told apart by number, not colour.
 */
export function orderThreads(threads: readonly CommentThread[]): (CommentThread & { number: number })[] {
  const numbered = [...threads].sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id)).map((thread, index) => ({ ...thread, number: index + 1 }));
  return [...numbered.filter((t) => !t.resolved), ...numbered.filter((t) => t.resolved)];
}
