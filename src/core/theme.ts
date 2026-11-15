export const THEMES = ['default', 'night', 'contrast'] as const;
export type ThemeName = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = 'kestrel-theme-v1';

export function parseTheme(value: unknown): ThemeName {
  return THEMES.includes(value as ThemeName) ? (value as ThemeName) : 'default';
}
