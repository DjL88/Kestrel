export const THEMES = ['default', 'night', 'contrast'] as const;
export type ThemeName = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = 'kestrel-theme-v1';

export function parseTheme(value: unknown): ThemeName {
  return THEMES.includes(value as ThemeName) ? (value as ThemeName) : 'night';
}

export const TEXT_SIZES = ['100', '125', '150'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const FONTS = ['brand', 'readable'] as const;
export type FontChoice = (typeof FONTS)[number];

export const SPACINGS = ['normal', 'roomy'] as const;
export type SpacingChoice = (typeof SPACINGS)[number];

export const DENSITIES = ['comfortable', 'compact'] as const;
export type DensityChoice = (typeof DENSITIES)[number];

export interface DisplaySettings {
  theme: ThemeName;
  textSize: TextSize;
  font: FontChoice;
  calm: boolean;
  /** 'roomy' widens letter, word and paragraph spacing (within WCAG 1.4.12) for easier reading. */
  spacing: SpacingChoice;
  /** 'compact' scales buttons, rows and gaps to 80% on a desktop mouse; text size is untouched. Touch screens are never shrunk. */
  density: DensityChoice;
}

export const DEFAULT_DISPLAY: DisplaySettings = { theme: 'night', textSize: '100', font: 'brand', calm: false, spacing: 'normal', density: 'comfortable' };

/**
 * One tap that turns on the existing comfort options together: the softer theme, the easy-to-read font, larger text,
 * roomier spacing and no movement. It is a convenience over settings that stay individually changeable, and it makes
 * no clinical claim. People differ, so every part can still be changed afterwards.
 */
export const CALM_AND_CLEAR: DisplaySettings = { theme: 'night', textSize: '125', font: 'readable', calm: true, spacing: 'roomy', density: 'comfortable' };

export function isCalmAndClear(settings: DisplaySettings): boolean {
  return (Object.keys(CALM_AND_CLEAR) as Array<keyof DisplaySettings>).every((key) => settings[key] === CALM_AND_CLEAR[key]);
}

export function parseDisplay(value: unknown): DisplaySettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    theme: parseTheme(raw.theme),
    textSize: TEXT_SIZES.includes(raw.textSize as TextSize) ? (raw.textSize as TextSize) : '100',
    font: FONTS.includes(raw.font as FontChoice) ? (raw.font as FontChoice) : 'brand',
    calm: raw.calm === true,
    spacing: SPACINGS.includes(raw.spacing as SpacingChoice) ? (raw.spacing as SpacingChoice) : 'normal',
    density: DENSITIES.includes(raw.density as DensityChoice) ? (raw.density as DensityChoice) : 'comfortable',
  };
}
