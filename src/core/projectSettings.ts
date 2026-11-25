import { parseSpeciesArea, type SpeciesArea } from './speciesArea';

export interface ProjectSettings {
  /** After photos are added, scan them on this device and suggest keepers and rejects. */
  autoCull: boolean;
  /** Develop untouched keepers in background after import; edited photos keep suggestions behind Auto. */
  autoEdit: boolean;
  /** "Where were these taken?": the place species names are matched against. Absent means the person's home region. */
  speciesArea?: SpeciesArea;
  /** The GPS suggestion the person answered "Not now" to, so the same one is not offered again (the area's key only). */
  speciesAreaDeclined?: string;
}

/** What the new-project wizard starts with. */
export const WIZARD_DEFAULTS: ProjectSettings = { autoCull: true, autoEdit: true };

/** Projects made before the wizard have no settings, and stay as they were. */
export const LEGACY_SETTINGS: ProjectSettings = { autoCull: false, autoEdit: false };

export function parseSettings(value: unknown): ProjectSettings {
  if (typeof value !== 'object' || value === null) return LEGACY_SETTINGS;
  const raw = value as Record<string, unknown>;
  const speciesArea = parseSpeciesArea(raw.speciesArea);
  return {
    autoCull: raw.autoCull === true, autoEdit: raw.autoEdit === true,
    ...(speciesArea ? { speciesArea } : {}),
    ...(typeof raw.speciesAreaDeclined === 'string' && raw.speciesAreaDeclined.length <= 200 ? { speciesAreaDeclined: raw.speciesAreaDeclined } : {}),
  };
}

export const TARGET_CHOICES = [20, 50, 100, 200] as const;
export const DEFAULT_TARGET = 50;

/** Accept whole numbers from 1 to 9999. Returns null for anything else so the wizard can say what is wrong. */
export function parseTarget(text: string): number | null {
  if (!/^\s*\d{1,4}\s*$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= 9999 ? value : null;
}
