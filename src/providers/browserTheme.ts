import { THEME_STORAGE_KEY, parseTheme, type ThemeName } from '../core/theme';

export function loadTheme(): ThemeName {
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'default';
  }
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be blocked. The theme still applies for this session.
  }
}
