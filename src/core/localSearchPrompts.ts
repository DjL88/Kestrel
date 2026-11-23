import type { PhotoFrame } from './types';
import { searchPhotoCollection, searchableEvidenceWords } from './photoSearch';

/**
 * Offline search examples from real photographs, never from a generic prompt list.
 * This is a pure, bounded selector; no model, network, telemetry or uploaded data.
 */
export interface LocalSearchPrompt { label: string; query: string; matchCount: number }

const WINTER = new Set([12, 1, 2]);
const SPRING = new Set([3, 4, 5]);
const SUMMER = new Set([6, 7, 8]);
const AUTUMN = new Set([9, 10, 11]);
const SNOW = new Set(['snow', 'snowy', 'snowfall']);
const SAFE_LABEL = /^[\p{L}\p{N}][\p{L}\p{N} '\-]{0,47}$/u;

function seasonOf(ms: number | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || ms > 8.64e15) return null;
  const month = new Date(ms).getUTCMonth() + 1;
  if (WINTER.has(month)) return 'winter';
  if (SPRING.has(month)) return 'spring';
  if (SUMMER.has(month)) return 'summer';
  if (AUTUMN.has(month)) return 'autumn';
  return null;
}

function subjects(frame: PhotoFrame): string[] {
  // Do not promote unreviewed automatic tags, OCR, personal face identities,
  // filenames, or private project descriptions to highlighted suggestions.
  const confirmed = frame.subjectNames ?? [];
  const evidence = frame.searchEvidence?.subjects
    ?.filter((item) => item.status === 'confirmed' || item.status === 'supported')
    .map((item) => item.value) ?? [];
  const searchable = new Set(searchableEvidenceWords(frame).map((value) => value.toLocaleLowerCase('en-GB')));
  return [...confirmed, ...evidence.filter((value) => searchable.has(value.toLocaleLowerCase('en-GB')))]
    .map((value) => value.trim())
    .filter((value) => SAFE_LABEL.test(value) && !/\b(person|people|man|woman|child|face)\b/i.test(value));
}

function snowConfirmed(frame: PhotoFrame): boolean {
  // Snow is a *scene observation*. A winter capture date alone proves nothing.
  // Only the photographer's ordinary tags count; auto-generated tags excluded.
  const auto = new Set((frame.autoTags ?? []).map((tag) => tag.toLocaleLowerCase('en-GB')));
  return (frame.tags ?? []).some((tag) => !auto.has(tag.toLocaleLowerCase('en-GB')) &&
    SNOW.has(tag.trim().toLocaleLowerCase('en-GB')));
}

/** At most max prompts. Every suggestion is verified against the actual search engine. */
export function localSearchPrompts(frames: readonly PhotoFrame[], max = 5): LocalSearchPrompt[] {
  if (!Number.isSafeInteger(max) || max <= 0) return [];
  const candidates = new Map<string, LocalSearchPrompt>();
  for (const frame of frames) {
    if (frame.removedAt != null) continue;
    const season = seasonOf(frame.exif.capturedAtMs);
    for (const subject of subjects(frame)) {
      if (season) {
        const label = `${subject} in ${season}`;
        const query = label;
        if (!candidates.has(label.toLocaleLowerCase('en-GB'))) {
          const count = searchPhotoCollection(frames, query, 0).primary.length;
          if (count) candidates.set(label.toLocaleLowerCase('en-GB'), { label, query, matchCount: count });
        }
      }
      if (snowConfirmed(frame)) {
        const label = `${subject} in the snow`;
        // Search's existing free-text parser does not know the phrase 'in the snow'.
        // The executable query intentionally uses the actually indexed tag.
        const query = `${subject} snow`;
        if (!candidates.has(label.toLocaleLowerCase('en-GB'))) {
          const count = searchPhotoCollection(frames, query, 0).primary.length;
          if (count) candidates.set(label.toLocaleLowerCase('en-GB'), { label, query, matchCount: count });
        }
      }
    }
  }
  return [...candidates.values()]
    .sort((a, b) => b.matchCount - a.matchCount || a.label.localeCompare(b.label, 'en-GB'))
    .slice(0, Math.min(max, 12));
}
