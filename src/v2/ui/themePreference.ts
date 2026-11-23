import type { ThemeMode } from './contract';

/** Explicit user choice wins; Auto tracks the browser/OS dark-mode preference. */
export function resolveTheme(preference: ThemeMode | 'auto', systemDark: boolean): ThemeMode {
  return preference === 'auto' ? (systemDark ? 'dark' : 'light') : preference;
}
