import { histogramSummary } from './histogramNotes';
import { mayApplyGuidance, type GuidanceMode } from './guidanceMode';
import type { Histogram } from './histogram';
import type { PhotoEdit } from './photoEdits';

/**
 * Offline photo advice, shown as a short "Try this" / "Auto" plus a one-word verdict, never as prose on the picture.
 *
 * Kestrel MEASURES (the histogram of what is on screen); a vision model may later supply `SceneContext` (is a dark frame
 * deliberately low-key?). The model never supplies numbers: every suggestion is a bounded change to a real slider,
 * reversible through the normal edit history. Unknown stays unknown: with too little data the verdict is "unsure".
 */
export type AdviceIssue = 'whiteClip' | 'blackClip' | 'dark' | 'bright' | 'flat' | 'warm' | 'cool';
export type AdviceKey = 'exposure' | 'warmth' | 'highlights' | 'shadows' | 'contrast';
export type Verdict = 'good' | 'nearly' | 'needs-work' | 'unsure';
export type Confidence = 'high' | 'medium' | 'low';

/**
 * Optional context from an on-device vision model. Absent means unknown, never "normal".
 * It can only make the advisor more cautious (a deliberate silhouette, golden light); it never adds or upgrades advice.
 */
export interface SceneContext { intent?: 'low-key' | 'high-key' | 'normal'; light?: 'golden' | 'cool'; }

export interface Suggestion {
  issue: AdviceIssue;
  /** Signed change added to each slider. */
  changes: Partial<Record<AdviceKey, number>>;
  /** High only for objective, measured problems (clipping). Intent-dependent calls are never high. */
  confidence: Confidence;
}
export interface Advice { verdict: Verdict; issues: AdviceIssue[]; suggestions: Suggestion[]; }

const MIN_PIXELS = 100;
const LIMIT = 2; // slider range is -2 to 2
const SPENT = 1.5; // a slider this far along is not pushed further the same way
const round = (v: number) => Math.round(v * 100) / 100;

export function adviseOnPhoto(h: Histogram, edit: PhotoEdit, context: SceneContext = {}): Advice {
  if (!(h.pixels >= MIN_PIXELS)) return { verdict: 'unsure', issues: [], suggestions: [] };
  const s = histogramSummary(h);
  const found: Array<{ s: Suggestion; severe: boolean }> = [];
  const add = (issue: AdviceIssue, changes: Suggestion['changes'], confidence: Confidence, severe: boolean) => {
    // Do not push a slider further the same way once it is already far along: no runaway advice.
    const spent = Object.entries(changes).some(([key, delta]) => {
      const current = (edit[key as AdviceKey] as number | undefined) ?? 0;
      return Math.sign(delta!) === Math.sign(current) && Math.abs(current) >= SPENT;
    });
    if (!spent) found.push({ s: { issue, changes, confidence }, severe });
  };

  if (h.highlightClip > 0.01) add('whiteClip', { highlights: -round(Math.min(0.6, 0.25 + h.highlightClip * 4)) }, 'high', h.highlightClip > 0.05);
  if (h.shadowClip > 0.02) add('blackClip', { shadows: round(Math.min(0.6, 0.25 + h.shadowClip * 3)) }, 'high', h.shadowClip > 0.08);
  if (s.mean < 0.3 && s.shadows > 0.55 && context.intent !== 'low-key') add('dark', { exposure: 0.3 }, 'medium', s.mean < 0.18);
  else if (s.mean > 0.68 && s.highlights > 0.5 && context.intent !== 'high-key') add('bright', { exposure: -0.3 }, 'medium', s.mean > 0.82);
  else if (s.high - s.low < 0.4 && context.intent !== 'low-key' && context.intent !== 'high-key') add('flat', { contrast: 0.2 }, 'medium', false);
  const cast = s.red - s.blue;
  if (cast > 0.1 && context.light !== 'golden') add('warm', { warmth: -0.08 }, 'low', false);
  else if (cast < -0.1 && context.light !== 'cool') add('cool', { warmth: 0.08 }, 'low', false);

  // A warm or cool cast alone is often the light the photographer wanted, so it never lowers the verdict by itself.
  const counting = found.filter(({ s: item }) => item.issue !== 'warm' && item.issue !== 'cool');
  const verdict: Verdict = counting.some((item) => item.severe) || counting.length >= 2 ? 'needs-work' : counting.length === 1 ? 'nearly' : 'good';
  return { verdict, issues: found.map(({ s: item }) => item.issue), suggestions: found.map(({ s: item }) => item) };
}

/** The edit with one suggestion applied: additive, clamped to the slider range, masks and everything else untouched. */
export function applySuggestion(edit: PhotoEdit, suggestion: Suggestion): PhotoEdit {
  const next: PhotoEdit = { ...edit };
  for (const [key, delta] of Object.entries(suggestion.changes) as Array<[AdviceKey, number]>) {
    const current = (edit[key] as number | undefined) ?? 0;
    next[key] = round(Math.max(-LIMIT, Math.min(LIMIT, current + delta)));
  }
  return next;
}

export interface AdviceAction {
  /** Fly Solo shows nothing unprompted; asked = the person pressed "Check my photo". */
  show: boolean;
  /** Soar: measured, high-confidence, reversible changes that may be applied without a click (never over manual edits). */
  auto: Suggestion[];
  /** Glide (and Soar's leftovers): at most one "Try this", the most reliable first. */
  tryThis: Suggestion | null;
}
const ORDER: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

export function adviceAction(mode: GuidanceMode, advice: Advice, options: { asked?: boolean; manuallyRefined?: boolean } = {}): AdviceAction {
  if (mode === 'solo' && !options.asked) return { show: false, auto: [], tryThis: null };
  const auto = advice.suggestions.filter((item) => mayApplyGuidance(mode, item.confidence, options.manuallyRefined ?? false));
  const rest = advice.suggestions.filter((item) => !auto.includes(item)).sort((a, b) => ORDER[a.confidence] - ORDER[b.confidence]);
  return { show: true, auto, tryThis: rest[0] ?? null };
}
