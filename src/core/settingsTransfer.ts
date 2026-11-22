/**
 * Copy a person's InFlight settings to another device through a plain file. They save it somewhere their devices share
 * (iCloud Drive, Dropbox, a USB stick) and load it on the other device. Only an allow-list of look-and-feel settings
 * travels: never licence keys, helper keys or consent, photos, projects or edits.
 */
export const SETTINGS_KEYS = [
  'kestrel.preferences.v1', // shortcuts and the macro pad, view choices
  'kestrel-theme', 'kestrel-theme-v1', 'kestrel-font', 'kestrel-text-size', 'kestrel-display-v1',
  'kestrel-panel-width-v1', 'kestrel-presets-v1', 'kestrel.watermark.v1',
] as const;

const FORMAT = 'kestrel-settings';
const MAX_VALUE = 4_500_000;
const MAX_TOTAL = 9_000_000;

export interface SettingsFile { format: typeof FORMAT; version: 1; savedAt: string; settings: Record<string, string> }

export function buildSettingsFile(read: (key: string) => string | null, now: Date): SettingsFile {
  const settings: Record<string, string> = {};
  for (const key of SETTINGS_KEYS) { const value = read(key); if (value !== null) settings[key] = value; }
  return { format: FORMAT, version: 1, savedAt: now.toISOString(), settings };
}

export type SettingsParse = { ok: true; settings: Record<string, string>; skipped: number } | { ok: false; reason: string };

/** Read a settings file back. Anything outside the allow-list, or not text, or too large, is skipped; a wrong file is refused. */
export function parseSettingsFile(text: string): SettingsParse {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, reason: 'That is not an InFlight settings file.' }; }
  const file = value as Partial<SettingsFile> | null;
  if (!file || file.format !== FORMAT || file.version !== 1 || typeof file.settings !== 'object' || file.settings === null) {
    return { ok: false, reason: 'That is not an InFlight settings file.' };
  }
  const settings: Record<string, string> = {};
  let skipped = 0, total = 0;
  for (const [key, entry] of Object.entries(file.settings)) {
    if (!(SETTINGS_KEYS as readonly string[]).includes(key) || typeof entry !== 'string' || entry.length > MAX_VALUE || total + entry.length > MAX_TOTAL) { skipped += 1; continue; }
    total += entry.length;
    settings[key] = entry;
  }
  return Object.keys(settings).length ? { ok: true, settings, skipped } : { ok: false, reason: 'That file has no settings InFlight can use.' };
}
