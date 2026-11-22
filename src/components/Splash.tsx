import { useEffect, useRef, useState } from 'react';
import type { AnimationItem } from 'lottie-web';
import splashDark from '../assets/brand/splash/inflight-splash-dark.json';
import splashLight from '../assets/brand/splash/inflight-splash-light.json';
import splashProDark from '../assets/brand/splash/inflight-splash-pro-dark.json';
import splashProLight from '../assets/brand/splash/inflight-splash-pro-light.json';
import { FADE_MS, HOLD_MS, STILL_MS, shouldShowSplash } from '../core/splashRules';
import type { LogoTone } from '../core/brandLogo';
import { BrandLogo, useIsPro, useLogoTone } from './BrandLogo';

// The session key keeps its old spelling so a person who already saw the splash this session is not shown it again after updating.
const SEEN_KEY = 'kestrel-splash-v1';

const ANIMATIONS = { dark: splashDark, light: splashLight, proDark: splashProDark, proLight: splashProLight };
/** Surface colours from the brand tokens, so the splash matches the app it hands over to. */
const BACKGROUND: Record<LogoTone, string> = { dark: '#0e1116', light: '#faf7f2' };

function shouldShow(): boolean {
  let alreadyShown = false;
  try { alreadyShown = sessionStorage.getItem(SEEN_KEY) === '1'; } catch { /* Without storage it simply shows each time. */ }
  return shouldShowSplash({ automated: navigator.webdriver === true, alreadyShown, forced: new URLSearchParams(location.search).has('splash') });
}

/**
 * The launch animation from the InFlight brand pack (Lottie, 3 s): the chevron holds, the bird opens its wings, the wordmark follows.
 * Light and dark versions follow the display theme, and the Pro version shows only for a verified Pro licence.
 * A tap or key skips it. With reduced motion there is no animation, only the still stacked logo for a moment.
 * The player is loaded on demand so it is not part of the first paint.
 */
export function Splash() {
  const [open, setOpen] = useState(shouldShow);
  const [leaving, setLeaving] = useState(false);
  const [played, setPlayed] = useState(false);
  const tone = useLogoTone();
  const pro = useIsPro();
  const host = useRef<HTMLDivElement>(null);
  const reduced = useRef(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false).current;

  useEffect(() => { if (open) { try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* Not remembered. */ } } }, [open]);

  // Reduced motion: the still logo, held briefly.
  useEffect(() => {
    if (!open || !reduced) return;
    const leave = window.setTimeout(() => setLeaving(true), STILL_MS);
    return () => window.clearTimeout(leave);
  }, [open, reduced]);

  // Otherwise play the animation, hold the finished logo for a moment, then fade away.
  useEffect(() => {
    if (!open || reduced || !host.current) return;
    let cancelled = false;
    let item: AnimationItem | undefined;
    let hold = 0;
    const data = ANIMATIONS[pro ? (tone === 'light' ? 'proLight' : 'proDark') : tone];
    import('lottie-web/build/player/lottie_light').then(({ default: lottie }) => {
      if (cancelled || !host.current) return;
      item = lottie.loadAnimation({ container: host.current, renderer: 'svg', loop: false, autoplay: true, animationData: structuredClone(data) });
      setPlayed(true);
      item.addEventListener('complete', () => { hold = window.setTimeout(() => setLeaving(true), HOLD_MS); });
    }).catch(() => { if (!cancelled) setLeaving(true); }); // If the player cannot load, never hold the app back.
    return () => { cancelled = true; window.clearTimeout(hold); item?.destroy(); };
  }, [open, reduced, tone, pro]);

  useEffect(() => {
    if (!leaving) return;
    const done = window.setTimeout(() => setOpen(false), reduced ? 0 : FADE_MS);
    return () => window.clearTimeout(done);
  }, [leaving, reduced]);

  // Any tap or key skips it.
  useEffect(() => {
    if (!open) return;
    const skip = () => setLeaving(true);
    window.addEventListener('pointerdown', skip, { once: true });
    window.addEventListener('keydown', skip, { once: true });
    return () => { window.removeEventListener('pointerdown', skip); window.removeEventListener('keydown', skip); };
  }, [open]);

  if (!open) return null;
  return (
    <div data-testid="splash" aria-hidden="true" className="fixed inset-0 z-[1000] grid place-items-center"
      style={{ backgroundColor: BACKGROUND[tone], opacity: leaving ? 0 : 1, transition: reduced ? undefined : `opacity ${FADE_MS}ms ease-out` }}>
      {reduced
        ? <BrandLogo kind="stacked" decorative className="h-auto w-[min(60vmin,16rem)]" />
        : <div ref={host} data-testid="splash-animation" data-played={played} className="h-[min(88vmin,34rem)] w-[min(88vmin,34rem)]" />}
    </div>
  );
}
