/**
 * Why Auto changed nothing, as a stable key the screen can say in the person's language. The safety checks
 * (autoQualityGate.ts, autoRenderSupervisor.ts, naturalAuto.ts, unifiedAuto.ts) each give an English reason; this maps
 * every one of them to a key, so the editor never has to show raw English, or the same generic sentence for every cause.
 * An unknown reason maps to null and the caller says only that a check failed.
 */
export type AutoReasonKey =
  | 'clipWhite' | 'crushedBlack' | 'vividColours' | 'lostDetail' | 'halos' | 'subjectSmall' | 'crunchyBackground'
  | 'noisyShadows' | 'flatBackground' | 'noSafeLift' | 'strongColour' | 'incomplete' | 'noneChecked' | 'keptDark';

/** Every key, for tests and for the language files. */
export const AUTO_REASON_KEYS: readonly AutoReasonKey[] = [
  'clipWhite', 'crushedBlack', 'vividColours', 'lostDetail', 'halos', 'subjectSmall', 'crunchyBackground',
  'noisyShadows', 'flatBackground', 'noSafeLift', 'strongColour', 'incomplete', 'noneChecked', 'keptDark',
];

const RULES: readonly [RegExp, AutoReasonKey][] = [
  // autoQualityGate.ts
  [/pure-white clipping|colour-channel clipping|lose highlight detail/i, 'clipWhite'],
  [/crushed black/i, 'crushedBlack'],
  [/vivid feathers|colours would be pushed too far|colours would shift/i, 'vividColours'],
  // autoRenderSupervisor.ts
  [/too small to verify/i, 'subjectSmall'],
  [/removed too much local detail|lost highlight or shadow detail|lost too much texture/i, 'lostDetail'],
  [/edge overshoot/i, 'halos'],
  [/comparison is incomplete|dimensions are inconsistent|renderer unavailable/i, 'incomplete'],
  // naturalAuto.ts
  [/crunchier/i, 'crunchyBackground'],
  [/noisy shadows/i, 'noisyShadows'],
  [/bright background would be flattened/i, 'flatBackground'],
  // unifiedAuto.ts and runAuto.ts
  [/no safe exposure lift/i, 'noSafeLift'],
  [/colour is strong or clipped/i, 'strongColour'],
  [/outside their ranges|no preferred|passed every detected subject/i, 'noneChecked'],
];

/** The key for one of the checks' English reasons, or null when it is not one this knows. */
export function autoReasonKey(reason: string | null | undefined): AutoReasonKey | null {
  if (!reason) return null;
  for (const [pattern, key] of RULES) if (pattern.test(reason)) return key;
  return null;
}
