/**
 * Whether the on-image advice layer is shown. Each device remembers its own choice (`on` or `off`); until the person
 * has chosen, it is on in Solo (where the person edits by hand and most wants to see clipping and colour at a glance)
 * and off in Co-Pilot and Auto-Pilot, which already say what they did in words.
 */
export type AdviceChoice = 'on' | 'off';

export const ADVICE_CHOICE_KEY = 'inflight.v2.advice-layer';

export function resolveAdviceShown(choice: AdviceChoice | null, mode: 'solo' | 'copilot' | 'autopilot'): boolean {
  if (choice === 'on') return true;
  if (choice === 'off') return false;
  return mode === 'solo';
}

export function readAdviceChoice(storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage === 'undefined' ? null : localStorage): AdviceChoice | null {
  try {
    const value = storage?.getItem(ADVICE_CHOICE_KEY);
    return value === 'on' || value === 'off' ? value : null;
  } catch { return null; }
}

/** Remembered on this device only; if storage is blocked the choice lasts for this session. */
export function writeAdviceChoice(choice: AdviceChoice, storage: Pick<Storage, 'setItem'> | null | undefined = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(ADVICE_CHOICE_KEY, choice); } catch { /* lasts for this session */ }
}
