import { DEFAULT_DISPLAY, THEME_STORAGE_KEY, parseDisplay, parseTheme, type DisplaySettings } from '../core/theme';

const DISPLAY_KEY = 'kestrel-display-v1';

export function loadDisplay(): DisplaySettings {
  try {
    const stored = localStorage.getItem(DISPLAY_KEY);
    if (stored) return parseDisplay(JSON.parse(stored));
    // Migrate the theme-only setting from the previous release.
    return { ...DEFAULT_DISPLAY, theme: parseTheme(localStorage.getItem(THEME_STORAGE_KEY)) };
  } catch {
    return DEFAULT_DISPLAY;
  }
}

export function applyDisplay(settings: DisplaySettings): void {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.textSize = settings.textSize;
  root.dataset.font = settings.font;
  root.dataset.calm = String(settings.calm);
  root.dataset.spacing = settings.spacing;
  try {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be blocked. The settings still apply for this session.
  }
}
