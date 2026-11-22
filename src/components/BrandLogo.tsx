import { useSyncExternalStore } from 'react';
import { useLicence } from '../providers/licenceStore';
import { logoToneFor, type LogoTone } from '../core/brandLogo';
import horizontalDark from '../assets/brand/logo/inflight-logo-horizontal-dark.svg';
import horizontalLight from '../assets/brand/logo/inflight-logo-horizontal-light.svg';
import stackedDark from '../assets/brand/logo/inflight-logo-stacked-dark.svg';
import stackedLight from '../assets/brand/logo/inflight-logo-stacked-light.svg';
import chevronDark from '../assets/brand/logo/inflight-chevron-dark.svg';
import chevronLight from '../assets/brand/logo/inflight-chevron-light.svg';
import proHorizontalDark from '../assets/brand/pro/inflight-pro-horizontal-dark.svg';
import proHorizontalLight from '../assets/brand/pro/inflight-pro-horizontal-light.svg';
import proStackedDark from '../assets/brand/pro/inflight-pro-stacked-dark.svg';
import proStackedLight from '../assets/brand/pro/inflight-pro-stacked-light.svg';
import proChevronDark from '../assets/brand/chevron-pro/inflight-chevron-pro-dark.svg';
import proChevronLight from '../assets/brand/chevron-pro/inflight-chevron-pro-light.svg';

export type LogoKind = 'horizontal' | 'stacked' | 'chevron';

const FILES: Record<LogoKind, { standard: Record<LogoTone, string>; pro: Record<LogoTone, string> }> = {
  horizontal: { standard: { light: horizontalLight, dark: horizontalDark }, pro: { light: proHorizontalLight, dark: proHorizontalDark } },
  stacked: { standard: { light: stackedLight, dark: stackedDark }, pro: { light: proStackedLight, dark: proStackedDark } },
  chevron: { standard: { light: chevronLight, dark: chevronDark }, pro: { light: proChevronLight, dark: proChevronDark } },
};

function subscribeTheme(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
const currentTone = () => logoToneFor(document.documentElement.dataset.theme);

export function useLogoTone(): LogoTone {
  return useSyncExternalStore(subscribeTheme, currentTone, () => 'dark');
}

/** Pro only when a verified licence or account grant says so (the same signal that unlocks the Pro tools), never from a setting. */
export function useIsPro(): boolean {
  const licence = useLicence();
  return (licence.status === 'valid' || licence.status === 'account') && licence.access.pro;
}

/**
 * The one place the InFlight logo is drawn. Horizontal in headers, stacked on the home page and About, chevron where the
 * space is under 64 px. It is the product's name, so it carries the accessible name; pass `decorative` when the name is written beside it.
 */
export function BrandLogo({ kind, className = '', decorative = false, pro }: { kind: LogoKind; className?: string; decorative?: boolean; pro?: boolean }) {
  const tone = useLogoTone();
  const licensed = useIsPro();
  const files = FILES[kind][(pro ?? licensed) ? 'pro' : 'standard'];
  return <img src={files[tone]} alt={decorative ? '' : 'InFlight'} data-testid={`brand-logo-${kind}`} draggable={false} className={`select-none ${className}`} />;
}

/**
 * The header mark. From the medium breakpoint up the full horizontal logo sits in the middle of the bar, tall enough that its
 * wordmark reads at the size of the text beside it; it ignores the pointer so the controls under it stay clickable.
 * On a phone, where the bar is full, the chevron sits at the start instead.
 */
export function HeaderLogo() {
  return (
    <>
      <span className="pointer-events-none absolute inset-x-0 top-1/2 z-0 hidden -translate-y-1/2 justify-center md:flex">
        <BrandLogo kind="horizontal" className="h-9 w-auto" />
      </span>
      <BrandLogo kind="chevron" className="h-7 w-auto shrink-0 md:hidden" />
    </>
  );
}
