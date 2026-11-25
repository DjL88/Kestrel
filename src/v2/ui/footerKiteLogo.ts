import type { ThemeMode } from './contract';

/**
 * The brand pack's kite marks (assets/brand/mark): the red kite for Free, the silver kite for verified Pro, each in its
 * light and dark version. Bundled from the pack's own files, so they move with a base path. Never recolour with CSS.
 */
const KITES = {
  standard: {
    dark: new URL('../../assets/brand/mark/inflight-kite-dark.svg', import.meta.url).href,
    light: new URL('../../assets/brand/mark/inflight-kite-light.svg', import.meta.url).href,
  },
  pro: {
    dark: new URL('../../assets/brand/mark/inflight-kite-pro-dark.svg', import.meta.url).href,
    light: new URL('../../assets/brand/mark/inflight-kite-pro-light.svg', import.meta.url).href,
  },
} as const;

/** `pro` must come from the verified licence (useIsPro), never from a setting. */
export function footerKiteLogo(theme: ThemeMode, pro: boolean): string {
  return KITES[pro ? 'pro' : 'standard'][theme === 'dark' ? 'dark' : 'light'];
}
