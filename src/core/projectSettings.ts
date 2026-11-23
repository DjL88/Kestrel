export type ProjectPilotMode = 'solo' | 'copilot' | 'autopilot';

export interface ProjectSettings {
  pilotMode?: ProjectPilotMode;
  /** After photos are added, scan them on this device and suggest keepers and rejects. */
  autoCull: boolean;
  /** Develop untouched keepers in background after import; edited photos keep suggestions behind Auto. */
  autoEdit: boolean;
}

/** What the new-project wizard starts with. */
export const WIZARD_DEFAULTS: ProjectSettings = { autoCull: true, autoEdit: true, pilotMode: 'solo' };

/** Projects made before the wizard have no settings, and stay as they were. */
export const LEGACY_SETTINGS: ProjectSettings = { autoCull: false, autoEdit: false };

export function parseSettings(value: unknown): ProjectSettings {
  if (typeof value !== 'object' || value === null) return LEGACY_SETTINGS;
  const raw = value as Record<string, unknown>;
  const pilotMode = raw.pilotMode === 'solo' || raw.pilotMode === 'copilot' || raw.pilotMode === 'autopilot' ? raw.pilotMode : undefined;
  return { autoCull: raw.autoCull === true, autoEdit: raw.autoEdit === true, ...(pilotMode ? { pilotMode } : {}) };
}

export const TARGET_CHOICES = [20, 50, 100, 200] as const;
export const DEFAULT_TARGET = 50;

/** Accept whole numbers from 1 to 9999. Returns null for anything else so the wizard can say what is wrong. */
export function parseTarget(text: string): number | null {
  if (!/^\s*\d{1,4}\s*$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= 9999 ? value : null;
}
