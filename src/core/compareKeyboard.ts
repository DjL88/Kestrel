import type { CullDecision } from './types';
import { toggleCompareDecision } from './compareDecision';

/**
 * A comparison shortcut is only valid when the photo surface itself has focus.
 * Global shortcuts own the rest of the application; dialogs, controls and IME
 * input must never accidentally change a photo's decision.
 */
export interface CompareKey {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}
export type CompareAction =
  | { kind: 'previous' | 'next' }
  | { kind: 'decision'; decision: CullDecision };

export function resolveCompareKey(
  event: CompareKey,
  rightDecision: CullDecision | null,
  canPrevious: boolean,
  canNext: boolean,
): CompareAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      event.repeat || event.isComposing || event.keyCode === 229 ||
      event.key === 'Process' || event.key === 'Dead') return null;
  switch (event.key.toLowerCase()) {
    case 'arrowleft': return canPrevious ? { kind: 'previous' } : null;
    case 'arrowright': return canNext ? { kind: 'next' } : null;
    case 'k': return rightDecision === null ? null : { kind: 'decision', decision: toggleCompareDecision(rightDecision, 'keep') };
    case 'x': return rightDecision === null ? null : { kind: 'decision', decision: toggleCompareDecision(rightDecision, 'reject') };
    case 'u': return rightDecision === null ? null : { kind: 'decision', decision: 'unreviewed' };
    default: return null;
  }
}
