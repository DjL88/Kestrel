import { useEffect, useState } from 'react';
import { friendlyCamera, friendlyLens, rulesInUse, type NameRule } from '../../../core/autoCorrectNames';

/**
 * The camera and lens name rules in use on this device: InFlight's built-in rules with the person's choices, and their
 * own renames (Settings › Auto-correct). Kept in memory and read again only when they change, because search reads a
 * name for every photo on every key press.
 */
export const NAME_RULES_KEY = 'inflight.v2.nameRules';
export const NAME_RULES_EVENT = 'inflight:name-rules';

export interface SavedNameRules { yours?: NameRule[]; builtinOff?: string[] }

let cache: NameRule[] | null = null;

const store = (): Storage | null => { try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; } };

export function readSavedNameRules(): SavedNameRules {
  try {
    const value = JSON.parse(store()?.getItem(NAME_RULES_KEY) ?? '{}') as SavedNameRules;
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export function nameRules(): NameRule[] {
  if (!cache) cache = rulesInUse(readSavedNameRules());
  return cache;
}

/** Saves the person's rules and tells every view to show the new names. */
export function saveNameRules(saved: SavedNameRules): void {
  try { store()?.setItem(NAME_RULES_KEY, JSON.stringify(saved)); } catch { /* not kept: the names still change for now */ }
  cache = rulesInUse(saved);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NAME_RULES_EVENT));
}

if (typeof window !== 'undefined') {
  // Another window of InFlight changed them.
  window.addEventListener('storage', (event) => { if (event.key === NAME_RULES_KEY) { cache = null; window.dispatchEvent(new Event(NAME_RULES_EVENT)); } });
}

export const cameraName = (raw: string | undefined) => friendlyCamera(raw, nameRules());
export const lensName = (raw: string | undefined) => friendlyLens(raw, nameRules());

/** Re-renders the caller when the name rules change (Settings › Auto-correct), so names update where they show. */
export function useNameRulesVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((n) => n + 1);
    window.addEventListener(NAME_RULES_EVENT, bump);
    return () => window.removeEventListener(NAME_RULES_EVENT, bump);
  }, []);
  return version;
}
