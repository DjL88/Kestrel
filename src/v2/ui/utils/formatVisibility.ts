import { useEffect, useState } from 'react';
import type { SizePreset } from '../contract';

/**
 * Which ready-made formats a person keeps out of sight (Dave, 27 Nov: "hide all social if they print a lot, or keep only
 * Instagram"). Stored on this device, offline, and always reversible: hidden formats leave the Formats panel (and so
 * the export picker, which lists the formats in use). The Original and formats the person made can never be hidden, and
 * a format a photo already uses still shows on that photo, so it can always be switched off.
 */
export const HIDDEN_FORMATS_KEY = 'inflight.v2.hiddenFormats';
export const HIDDEN_FORMATS_EVENT = 'inflight:hidden-formats';
const ORIGINAL_ID = 'orig-3x2';

const store = (): Storage | null => { try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; } };

export function readHiddenFormats(source: Pick<Storage, 'getItem'> | null = store()): Set<string> {
  try {
    const value = JSON.parse(source?.getItem(HIDDEN_FORMATS_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id !== ORIGINAL_ID) : []);
  } catch {
    return new Set();
  }
}

export function saveHiddenFormats(hidden: ReadonlySet<string>, target: Pick<Storage, 'setItem'> | null = store()): void {
  try { target?.setItem(HIDDEN_FORMATS_KEY, JSON.stringify([...hidden].filter((id) => id !== ORIGINAL_ID))); } catch { /* not kept */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(HIDDEN_FORMATS_EVENT));
}

/** Whether a format can be hidden: a ready-made one, not the Original and not one the person made. */
export const canHideFormat = (size: Pick<SizePreset, 'id' | 'platform'>): boolean => size.id !== ORIGINAL_ID && size.platform !== 'custom';

/** The formats to list for a photo: hidden ones stay out, unless this photo already uses them. */
export function shownFormats<T extends Pick<SizePreset, 'id' | 'platform' | 'enabled'>>(sizes: readonly T[], hidden: ReadonlySet<string>): T[] {
  return sizes.filter((size) => !canHideFormat(size) || !hidden.has(size.id) || size.enabled);
}

/** The hidden formats, kept current when Settings changes them. */
export function useHiddenFormats(): Set<string> {
  const [hidden, setHidden] = useState(() => readHiddenFormats());
  useEffect(() => {
    const again = () => setHidden(readHiddenFormats());
    const fromElsewhere = (event: StorageEvent) => { if (event.key === HIDDEN_FORMATS_KEY) again(); };
    window.addEventListener(HIDDEN_FORMATS_EVENT, again);
    window.addEventListener('storage', fromElsewhere);
    return () => { window.removeEventListener(HIDDEN_FORMATS_EVENT, again); window.removeEventListener('storage', fromElsewhere); };
  }, []);
  return hidden;
}
