import { searchWords } from './subjectTags';
import type { PhotoFrame } from './types';

/**
 * Search evidence stays in the local catalogue, separate from camera EXIF,
 * user-confirmed tags, exports, edits and culling decisions.
 */
export interface SearchObservation {
  value: string;
  status: 'confirmed' | 'agreed' | 'supported' | 'needs-review';
}

export interface PhotoSearchEvidence {
  schema: 1;
  sourceStableKey: string;
  /** SHA-256 of original bytes when the source reader supplies one. */
  sourceSha256?: string;
  modelRevision: string;
  indexedAt: number;
  ocr: SearchObservation[];
  subjects: SearchObservation[];
}

export interface SearchEvidenceReceipt {
  frameId: string;
  sourceStableKey: string;
  sourceSha256?: string;
  modelRevision: string;
  indexedAt: number;
  ocr?: readonly SearchObservation[];
  subjects?: readonly SearchObservation[];
}

const HASH = /^[a-f0-9]{64}$/i;

function cleanObservations(entries: readonly SearchObservation[] | undefined): SearchObservation[] {
  const seen = new Set<string>();
  const output: SearchObservation[] = [];
  for (const item of entries ?? []) {
    if (!item || typeof item.value !== 'string' ||
        !['confirmed', 'agreed', 'supported', 'needs-review'].includes(item.status)) continue;
    const value = item.value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    output.push({ value, status: item.status });
    if (output.length === 24) break;
  }
  return output;
}

/**
 * Only update an extant matching frame; optionally demand a fresh original SHA.
 * The caller must abandon stale scans and verify current bytes, because a path
 * alone cannot prove that its contents did not change during processing.
 */
export function retainPhotoSearchEvidence(
  frame: PhotoFrame,
  receipt: SearchEvidenceReceipt,
  currentOriginalSha256?: string,
): PhotoFrame {
  if (frame.removedAt != null || frame.id !== receipt.frameId ||
      !frame.stableKey || frame.stableKey !== receipt.sourceStableKey ||
      typeof receipt.modelRevision !== 'string' || !receipt.modelRevision.trim() ||
      !Number.isFinite(receipt.indexedAt) || receipt.indexedAt <= 0) return frame;
  if (receipt.sourceSha256 !== undefined && !HASH.test(receipt.sourceSha256)) return frame;
  if (currentOriginalSha256 !== undefined &&
      (!HASH.test(currentOriginalSha256) || receipt.sourceSha256?.toLowerCase() !== currentOriginalSha256.toLowerCase())) return frame;
  if (frame.searchEvidence?.sourceStableKey === frame.stableKey &&
      frame.searchEvidence.indexedAt > receipt.indexedAt) return frame;
  return { ...frame, searchEvidence: {
    schema: 1,
    sourceStableKey: frame.stableKey,
    ...(receipt.sourceSha256 ? { sourceSha256: receipt.sourceSha256.toLowerCase() } : {}),
    modelRevision: receipt.modelRevision.slice(0, 80),
    indexedAt: receipt.indexedAt,
    ocr: cleanObservations(receipt.ocr),
    subjects: cleanObservations(receipt.subjects),
  } };
}

export function searchableEvidenceWords(frame: { stableKey?: string; searchEvidence?: PhotoSearchEvidence }): string[] {
  const evidence = frame.searchEvidence;
  if (!evidence || evidence.schema !== 1 || evidence.sourceStableKey !== frame.stableKey) return [];
  // Two agreeing OCR reads remain suggestions, while uncertain single reads
  // are held back from automatic search. Subject detection needs a separate
  // corroborating witness; a species guess on its own is not evidence.
  const text = Array.isArray(evidence.ocr) ? evidence.ocr.filter((entry) => entry &&
    typeof entry.value === 'string' && (entry.status === 'agreed' || entry.status === 'confirmed')) : [];
  const subjects = Array.isArray(evidence.subjects) ? evidence.subjects.filter((entry) => entry &&
    typeof entry.value === 'string' && (entry.status === 'supported' || entry.status === 'confirmed')) : [];
  const supported = [...text, ...subjects].slice(0, 48).map((entry) => entry.value);
  return supported;
}

export function photoSearchableText(frame: PhotoFrame): string {
  return [
    frame.filename, frame.exif.camera ?? '', frame.exif.lens ?? '',
    frame.demoVariant?.demoSceneLabel ?? '', ...searchWords(frame), ...searchableEvidenceWords(frame),
  ].join(' ');
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const DATE_CONTEXT = /\b(?:from|in|during|around|throughout|for)\s+(?:the\s+month\s+of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(?:of\s+)?((?:19|20)\d{2}))?\b/i;
const DATE_YEAR = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+((?:19|20)\d{2})\b/i;
const DATE_SHORT = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const STOP = new Set([
  'find', 'show', 'me', 'my', 'the', 'a', 'an', 'all', 'any',
  'photos', 'photo', 'photographs', 'photograph', 'pictures', 'picture', 'images', 'image',
  'shots', 'shot', 'taken', 'captured', 'from', 'in', 'during', 'of',
  'with', 'containing', 'contains', 'around', 'throughout', 'for',
  'please', 'can', 'you', 'and', 'also', 'this', 'last', 'year',
]);

function normalise(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-GB').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

export interface ParsedPhotoSearch {
  terms: string[];
  month?: number; // 1 through 12
  year?: number; // only when explicitly requested
  exactMonthOnly: boolean;
}

export function parsePhotoSearch(query: string): ParsedPhotoSearch {
  const raw = normalise(query).slice(0, 240);
  let rest = raw;
  let month: number | undefined, year: number | undefined;
  // A modal 'may contain' is not a date. Short shorthand ('Kingfisher May') is.
  const hit = DATE_CONTEXT.exec(raw) ?? DATE_YEAR.exec(raw) ??
    (raw.split(/\s+/).length <= 3 && !/\bmay\s+(?:contain|have|show|be)\b/.test(raw) ? DATE_SHORT.exec(raw) : null);
  if (hit) {
    month = MONTHS.findIndex((name) => name.toLowerCase().startsWith(hit[1].slice(0, 3))) + 1;
    year = hit[2] ? Number(hit[2]) : undefined;
    rest = raw.slice(0, hit.index) + ' ' + raw.slice(hit.index + hit[0].length);
  }
  if (year === undefined) {
    const y = /\b(?:in|from|during)\s+((?:19|20)\d{2})\b/.exec(rest);
    if (y) { year = Number(y[1]); rest = rest.replace(y[0], ' '); }
  }
  const words = rest.match(/[a-z0-9]+(?:[-'][a-z0-9]+)*/g) ?? [];
  const terms = words.filter((word) => !STOP.has(word) && !['exactly', 'only', 'strictly', 'just'].includes(word))
    .map((word) => word.length > 5 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
  return {
    terms: [...new Set(terms)],
    ...(month ? { month } : {}),
    ...(year ? { year } : {}),
    exactMonthOnly: /\b(?:only|strictly|exactly|just)\b/.test(raw),
  };
}

function monthKind(frame: PhotoFrame, parsed: ParsedPhotoSearch): 'primary' | 'nearby' | 'none' {
  if (parsed.month === undefined && parsed.year === undefined) return 'primary';
  const ms = frame.exif.capturedAtMs;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || ms > 8.64e15) return 'none';
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return 'none';
  const observedMonth = date.getUTCMonth() + 1, observedYear = date.getUTCFullYear();
  if (parsed.month === undefined) return observedYear === parsed.year ? 'primary' : 'none';
  if (observedMonth === parsed.month && (parsed.year === undefined || observedYear === parsed.year)) return 'primary';
  if (parsed.exactMonthOnly) return 'none';
  if (parsed.year === undefined) {
    const previous = parsed.month === 1 ? 12 : parsed.month - 1;
    const next = parsed.month === 12 ? 1 : parsed.month + 1;
    return observedMonth === previous || observedMonth === next ? 'nearby' : 'none';
  }
  const first = Date.UTC(parsed.year, parsed.month - 2, 1);
  const last = Date.UTC(parsed.year, parsed.month + 1, 1);
  return ms >= first && ms < last ? 'nearby' : 'none';
}

export interface PhotoSearchResults<T> {
  primary: T[];
  nearby: T[];
  matches: T[];
  parsed: ParsedPhotoSearch;
  nearbyMessage?: string;
}

/**
 * Match subject/text and capture month on the SAME photo. Exact month first;
 * supplement with adjacent months only if fewer than three exact matches.
 * Keep the nearby group separate so the UI can label it honestly.
 */
export function searchPhotoCollection<T extends PhotoFrame>(
  frames: readonly T[], query: string, nearbyThreshold = 3,
): PhotoSearchResults<T> {
  const parsed = parsePhotoSearch(query);
  const primary: T[] = [], neighbours: T[] = [];
  for (const frame of frames) {
    if (frame.removedAt != null) continue;
    const haystack = normalise(photoSearchableText(frame));
    if (!parsed.terms.every((term) => haystack.includes(term))) continue;
    const kind = monthKind(frame, parsed);
    if (kind === 'primary') primary.push(frame);
    else if (kind === 'nearby') neighbours.push(frame);
  }
  const nearby = parsed.month !== undefined && !parsed.exactMonthOnly &&
    primary.length < Math.max(0, nearbyThreshold) ? neighbours : [];
  const name = parsed.month === undefined ? '' : MONTHS[parsed.month - 1];
  return {
    primary, nearby, matches: [...primary, ...nearby], parsed,
    ...(nearby.length ? { nearbyMessage: name + ' had few matches. Nearby-month results are suggestions, not photos from ' + name + '.' } : {}),
  };
}
