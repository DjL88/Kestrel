import type { CropTransform } from '../ui/contract';
import { sanitiseCrop } from './cropOps';
import { readFormats } from './formatOps';

/**
 * Recorded on the PHOTO, but scoped to an output format. Source image bytes
 * are never copied. The parent edit cursor captures the photo-wide recipe at
 * the instant a new format was created; subsequent linked edits remain on the
 * shared editHistory (not duplicated as made-up local edits).
 */
export type FormatEventKind = 'created' | 'crop' | 'hidden' | 'shown' | 'removed' | 'linked' | 'unlinked' | 'size';
export interface FormatHistoryEvent {
  formatId: string;
  kind: FormatEventKind;
  at: number;
  /** Only meaningful for 'created'. The Original is the permanent root. */
  parentFormatId?: string;
  forkEditCursor?: number;
  before?: CropTransform;
  after?: CropTransform;
  dimensions?: { width: number; height: number };
}
export interface FormatHistory { version: 1; events: FormatHistoryEvent[] }
export const ORIGINAL_BRANCH_ID = 'orig-3x2'; // historical stable saved ID
export const MAX_FORMAT_HISTORY = 300;

const eventKinds = new Set<FormatEventKind>(['created','crop','hidden','shown','removed','linked','unlinked','size']);
const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 80;
const validTime = (at: unknown): at is number => typeof at === 'number' && Number.isSafeInteger(at) && at > 0;

export function readFormatHistory(raw: unknown): FormatHistory {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { version: 1, events: [] };
  const v = raw as Record<string, unknown>;
  if (v.version !== 1 || !Array.isArray(v.events)) return { version: 1, events: [] };
  const events: FormatHistoryEvent[] = [];
  for (const rawEvent of v.events.slice(-MAX_FORMAT_HISTORY)) {
    if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) continue;
    const e = rawEvent as Record<string, unknown>;
    if (!validId(e.formatId) || !eventKinds.has(e.kind as FormatEventKind) || !validTime(e.at)) continue;
    const event: FormatHistoryEvent = { formatId: e.formatId, kind: e.kind as FormatEventKind, at: e.at };
    if (validId(e.parentFormatId)) event.parentFormatId = e.parentFormatId;
    if (Number.isSafeInteger(e.forkEditCursor) && (e.forkEditCursor as number) >= 0) event.forkEditCursor = e.forkEditCursor as number;
    if (e.before && typeof e.before === 'object') event.before = sanitiseCrop(e.before);
    if (e.after && typeof e.after === 'object') event.after = sanitiseCrop(e.after);
    if (e.dimensions && typeof e.dimensions === 'object') {
      const d = e.dimensions as Record<string, unknown>;
      if (Number.isSafeInteger(d.width) && Number.isSafeInteger(d.height) && (d.width as number) > 0 && (d.height as number) > 0) {
        event.dimensions = { width: d.width as number, height: d.height as number };
      }
    }
    events.push(event);
  }
  return { version: 1, events };
}

function append(raw: unknown, event: FormatHistoryEvent): FormatHistory {
  const history = readFormatHistory(raw);
  const events = history.events;
  const last = events.at(-1);
  // Slider / drag motion is ONE action; a pause creates a new checkpoint.
  if (event.kind === 'crop' && last?.kind === 'crop' && last.formatId === event.formatId
    && event.at >= last.at && event.at - last.at < 550) {
    const combined = { ...event, before: last.before };
    if (JSON.stringify(combined.before) === JSON.stringify(combined.after)) return { version: 1, events: events.slice(0, -1) };
    return { version: 1, events: [...events.slice(0, -1), combined] };
  }
  return { version: 1, events: [...events, event].slice(-MAX_FORMAT_HISTORY) };
}

export function recordFormatCrop(
  raw: unknown, formatId: string, before: CropTransform, after: CropTransform, at: number,
): FormatHistory {
  if (!validId(formatId) || !validTime(at) || JSON.stringify(before) === JSON.stringify(after)) return readFormatHistory(raw);
  return append(raw, { kind: 'crop', formatId, before: sanitiseCrop(before), after: sanitiseCrop(after), at });
}

/** Log actual changes only, including creation, deletion and visibility. */
export function recordFormatSetChange(
  rawHistory: unknown, oldRaw: unknown, nextRaw: unknown,
  at: number, forkEditCursor: number,
): FormatHistory {
  let history = readFormatHistory(rawHistory);
  if (!validTime(at)) return history;
  const old = readFormats(oldRaw), next = readFormats(nextRaw);
  const oldCustom = new Map(old.custom.map(x => [x.id, x]));
  const newCustom = new Map(next.custom.map(x => [x.id, x]));
  for (const [id, size] of newCustom) {
    const before = oldCustom.get(id);
    if (!before) history = append(history, {
      formatId: id, kind: 'created', at, parentFormatId: ORIGINAL_BRANCH_ID,
      forkEditCursor: Math.max(0, forkEditCursor),
      dimensions: { width: size.width, height: size.height },
    });
    else if (before.width !== size.width || before.height !== size.height) {
      history = append(history, { formatId: id, kind: 'size', at, dimensions: { width: size.width, height: size.height } });
    }
  }
  for (const id of oldCustom.keys()) if (!newCustom.has(id)) {
    history = append(history, { formatId: id, kind: 'removed', at });
  }
  const ids = new Set([...old.disabled, ...next.disabled, ...(old.enabled ?? []), ...(next.enabled ?? [])]);
  for (const id of ids) {
    const wasDisabled = old.disabled.includes(id);
    const nowDisabled = next.disabled.includes(id);
    // Built-ins can also start disabled by default and be explicitly opted in.
    const wasEnabledByChoice = old.enabled?.includes(id) === true;
    const nowEnabledByChoice = next.enabled?.includes(id) === true;
    if (wasDisabled !== nowDisabled || (!wasDisabled && !nowDisabled && wasEnabledByChoice !== nowEnabledByChoice)) {
      history = append(history, {
        formatId: id, kind: nowDisabled || (!nowEnabledByChoice && wasEnabledByChoice) ? 'hidden' : 'shown', at,
      });
    }
  }
  return history;
}

export function recordFormatLink(raw: unknown, formatId: string, linked: boolean, at: number): FormatHistory {
  if (!validId(formatId) || !validTime(at)) return readFormatHistory(raw);
  return append(raw, { formatId, kind: linked ? 'linked' : 'unlinked', at });
}

export function historyForFormat(raw: unknown, formatId: string): FormatHistoryEvent[] {
  return readFormatHistory(raw).events.filter(event => event.formatId === formatId);
}
