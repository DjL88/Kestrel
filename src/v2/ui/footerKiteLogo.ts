import type { ThemeMode } from './contract';

/** Official, owner-supplied InFlight red-kite marks. Never recolour with CSS. */
export function footerKiteLogo(theme: ThemeMode, pro: boolean): string {
  const suffix = theme === 'dark' ? 'dark' : 'light';
  return `/v2-logos/inflight-kite-${pro ? 'pro-' : ''}${suffix}.svg`;
}
