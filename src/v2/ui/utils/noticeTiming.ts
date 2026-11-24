/**
 * How long a workspace message stays. A message that reports a problem stays until the person dismisses it; any other
 * message stays long enough to read at a slow pace (about 200 words a minute, never under 6 seconds) and pauses while
 * the pointer or keyboard focus is on it. Nothing important should vanish while someone is looking elsewhere
 * (WCAG 2.2.1 Timing Adjustable; W3C COGA "do not rely on memory").
 */

const PROBLEM = /\b(could not|couldn['’]t|cannot|can['’]t|failed|failure|error|not saved|stopped|refused|not applied|not connected|unavailable|missing)\b/i;

/** True for a message that reports something going wrong or not happening: it must wait for the person. */
export function noticeNeedsDismiss(text: string): boolean {
  return PROBLEM.test(text);
}

export const MIN_NOTICE_MS = 6000;
const MAX_NOTICE_MS = 20000;

/** Reading time for a confirmation: 6 seconds, plus 300 ms a word beyond the first ten, at most 20 seconds. */
export function noticeDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(MAX_NOTICE_MS, MIN_NOTICE_MS + Math.max(0, words - 10) * 300);
}
