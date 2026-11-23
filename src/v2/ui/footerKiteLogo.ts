import type { ThemeMode } from './contract';

/** Official, owner-supplied InFlight red-kite marks. Never recolour with CSS. */
export function footerKiteLogo(theme: ThemeMode, _pro: boolean): string {
  const suffix = theme === 'dark' ? 'dark' : 'light';
  return `/v2-logos/red-kite-${suffix}.svg`;
}
