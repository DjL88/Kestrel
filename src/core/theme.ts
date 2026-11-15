export const THEMES = ['default', 'night', 'contrast'] as const;
export type ThemeName = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = 'kestrel-theme-v1';

export function parseTheme(value: unknown): ThemeName {
  return THEMES.includes(value as ThemeName) ? (value as ThemeName) : 'default';
}

export const TEXT_SIZES = ['100', '125', '150'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const FONTS = ['brand', 'readable'] as const;
export type FontChoice = (typeof FONTS)[number];

export interface DisplaySettings {
  theme: ThemeName;
  textSize: TextSize;
  font: FontChoice;
  calm: boolean;
}

export const DEFAULT_DISPLAY: DisplaySettings = { theme: 'default', textSize: '100', font: 'brand', calm: false };

export function parseDisplay(value: unknown): DisplaySettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    theme: parseTheme(raw.theme),
    textSize: TEXT_SIZES.includes(raw.textSize as TextSize) ? (raw.textSize as TextSize) : '100',
    font: FONTS.includes(raw.font as FontChoice) ? (raw.font as FontChoice) : 'brand',
    calm: raw.calm === true,
  };
}
