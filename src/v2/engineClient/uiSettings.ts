import type { AssistMode, WorkspaceSettings } from '../ui/contract';

/** The interface choices kept on this device between sessions (theme, tool side, mode and so on). Never anything about photos. */
export interface SavedUi {
  assistMode?: AssistMode;
  settings: Partial<Pick<WorkspaceSettings, 'theme' | 'calmView' | 'calmMotion' | 'calmBadges' | 'calmHints' | 'calmReadouts' | 'touchDensity' | 'cvdGuidance' | 'ongoingCritique' | 'defaultAssistMode' | 'hand' | 'language' | 'advancedControls' | 'advanceAfterDecision'>>;
}

const KEY = 'inflight.v2.ui';
const CALM_PARTS = ['calmMotion', 'calmBadges', 'calmHints', 'calmReadouts'] as const;

/** Calm View reads as on when all three of its parts are on, whichever way they got there. */
export function calmViewOn(settings: Pick<WorkspaceSettings, 'calmMotion' | 'calmBadges' | 'calmHints'>): boolean {
  return settings.calmMotion && settings.calmBadges && settings.calmHints;
}

/** Switching the Calm View preset. Slider numbers are not part of it: they stay as the person set them. */
export function calmViewPatch(on: boolean): Pick<WorkspaceSettings, 'calmView' | 'calmMotion' | 'calmBadges' | 'calmHints'> {
  return { calmView: on, calmMotion: on, calmBadges: on, calmHints: on };
}
const MODES: readonly AssistMode[] = ['solo', 'copilot', 'autopilot'];
const LANGUAGES = ['en-GB', 'en-US', 'de-DE', 'fr-FR'] as const;

/** Read defensively: any value that is not one we know is ignored, so a damaged or older record never breaks the interface. */
export function parseSavedUi(raw: string | null): SavedUi {
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    if (!value || typeof value !== 'object') return { settings: {} };
    const entry = value as Record<string, unknown>;
    const source = (entry.settings && typeof entry.settings === 'object' ? entry.settings : {}) as Record<string, unknown>;
    const settings: SavedUi['settings'] = {};
    if (source.theme === 'dark' || source.theme === 'light' || source.theme === 'auto') settings.theme = source.theme;
    if (typeof source.calmView === 'boolean') settings.calmView = source.calmView;
    // Calm View used to be one switch that hid all four. A record from then keeps exactly what it had.
    for (const part of CALM_PARTS) {
      if (typeof source[part] === 'boolean') settings[part] = source[part] as boolean;
      else if (source.calmView === true) settings[part] = true;
    }
    if (source.touchDensity === 'comfortable' || source.touchDensity === 'compact') settings.touchDensity = source.touchDensity;
    if (typeof source.cvdGuidance === 'boolean') settings.cvdGuidance = source.cvdGuidance;
    if (typeof source.advancedControls === 'boolean') settings.advancedControls = source.advancedControls;
    if (typeof source.advanceAfterDecision === 'boolean') settings.advanceAfterDecision = source.advanceAfterDecision;
    if (typeof source.ongoingCritique === 'boolean') settings.ongoingCritique = source.ongoingCritique;
    if ((MODES as readonly unknown[]).includes(source.defaultAssistMode)) settings.defaultAssistMode = source.defaultAssistMode as AssistMode;
    if (source.hand === 'right' || source.hand === 'left') settings.hand = source.hand;
    if ((LANGUAGES as readonly unknown[]).includes(source.language)) settings.language = source.language as WorkspaceSettings['language'];
    return { assistMode: (MODES as readonly unknown[]).includes(entry.assistMode) ? (entry.assistMode as AssistMode) : undefined, settings };
  } catch { return { settings: {} }; }
}

export const loadUi = (): SavedUi => { try { return parseSavedUi(window.localStorage.getItem(KEY)); } catch { return { settings: {} }; } };
export const saveUi = (ui: SavedUi): void => { try { window.localStorage.setItem(KEY, JSON.stringify(ui)); } catch { /* the choices last for this session */ } };

export function mergeSettings(base: WorkspaceSettings, saved: SavedUi['settings'], patch: Partial<WorkspaceSettings> = {}): WorkspaceSettings {
  // Connections in the sample workspace do not reflect the device's authorised destinations.
  return { ...base, ...saved, storageConnectors: [], ...patch };
}
