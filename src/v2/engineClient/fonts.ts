import type { FontOption } from '../ui/contract';
import { INITIAL_FONTS } from '../ui/stub';

/** Our favourite fonts, all bundled with the app (SIL Open Font Licence). */
export const FAVOURITE_FONTS: readonly FontOption[] = INITIAL_FONTS;

const STORAGE_KEY = 'inflight.v2.deviceFonts';

/** A font name from the person or the device, tidied: no empty names, no duplicates, sorted, case kept as the first seen. */
export function normaliseFontNames(names: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en-GB', { sensitivity: 'base' }));
}

/** A device font as a picker entry. It is marked as a device font: it exists on this computer only. */
export function deviceFontOption(name: string): FontOption {
  const clean = name.trim();
  return {
    id: `device-${clean.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    label: clean,
    family: `"${clean.replace(/"/g, '')}", sans-serif`,
    category: 'Custom',
    isDevice: true,
  };
}

/** Favourites first, then the device fonts the person added, without repeating a favourite. */
export function mergeFonts(deviceNames: readonly string[]): FontOption[] {
  const favourites = new Set(FAVOURITE_FONTS.map((font) => font.label.toLowerCase()));
  return [...FAVOURITE_FONTS, ...normaliseFontNames(deviceNames).filter((name) => !favourites.has(name.toLowerCase())).map(deviceFontOption)];
}

export function loadSavedDeviceFonts(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? normaliseFontNames(parsed.filter((entry): entry is string => typeof entry === 'string')) : [];
  } catch { return []; }
}

export function saveDeviceFonts(names: readonly string[]): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normaliseFontNames(names))); } catch { /* a font list is a convenience */ }
}

interface LocalFontData { family: string }
type QueryLocalFonts = () => Promise<LocalFontData[]>;

/** The fonts installed on this device, by family name, or null when the browser or webview cannot list them (it needs
 * the Local Font Access API and the person's permission). Nothing is read from the font files, only the names. */
export async function listDeviceFonts(): Promise<string[] | null> {
  const query = (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;
  if (!query) return null;
  try { return normaliseFontNames((await query.call(window)).map((font) => font.family)); } catch { return null; }
}

/** True when a font of this name can be drawn here. A name nothing matches falls back to the default font, so this
 * compares a probe string in the font against the same text in two generic fonts. */
export function hasDeviceFont(name: string): boolean {
  const clean = name.trim().replace(/"/g, '');
  if (!clean) return false;
  if (FAVOURITE_FONTS.some((font) => font.label.toLowerCase() === clean.toLowerCase())) return true;
  try {
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return false;
    const text = 'mmmmmmmmmmlliWWWW@#0123456789';
    const width = (family: string) => { probe.font = `72px ${family}`; return probe.measureText(text).width; };
    return ['monospace', 'serif', 'sans-serif'].some((generic) => width(`"${clean}", ${generic}`) !== width(generic));
  } catch { return false; }
}
