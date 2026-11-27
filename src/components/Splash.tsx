import { useEffect, useRef, useState, type CSSProperties, type ComponentType } from 'react';
import type { AnimationItem } from 'lottie-web';
import splashDark from '../assets/brand/splash/inflight-splash-dark.json';
import splashLight from '../assets/brand/splash/inflight-splash-light.json';
import splashProDark from '../assets/brand/splash/inflight-splash-pro-dark.json';
import splashProLight from '../assets/brand/splash/inflight-splash-pro-light.json';
import { FADE_MS, HOLD_MS, LICENCE_WAIT_MS, STILL_MS, shouldShowSplash } from '../core/splashRules';
import { chooseWelcome, profileFromSession, shouldSkipWelcome, type LaunchProfile, type WelcomeState } from '../core/launchWelcome';
import type { LogoTone } from '../core/brandLogo';
import { BrandLogo, useIsPro, useLogoTone } from './BrandLogo';
import { useLicence, useLicenceKnown } from '../providers/licenceStore';
import {
  launchedBefore, markLaunched, markProfileChecked, priorUseDetected, profileChecked, readLastProject, readProfile, skipChosen, writeProfile,
} from '../providers/launchMemory';
import { requestLaunch, type LaunchIntent } from '../v2/launchIntent';

// The session key keeps its old spelling so a person who already saw the splash this session is not shown it again after updating.
const SEEN_KEY = 'kestrel-splash-v1';

const ANIMATIONS = { dark: splashDark, light: splashLight, proDark: splashProDark, proLight: splashProLight };
/** Surface colours from the brand tokens, so the splash matches the app it hands over to. */
const BACKGROUND: Record<LogoTone, string> = { dark: '#0e1116', light: '#faf7f2' };

/*
 * Where the logo settles when the splash grows into the welcome. Every number below is used both for the rise and for the
 * room the welcome keeps above its content (`--welcome-logo-space`), so the two always agree, on a desktop and on a phone.
 */
/** The Lottie frame: square, as large as fits, up to 34rem. */
const FRAME = 'min(88vmin, 34rem)';
/** How small the logo becomes at the top. */
const RISE_SCALE = 0.62;
/** Where the finished logo sits inside the Lottie frame (measured on its last frame, the same in all four versions). */
const ART_TOP = 0.3;
const ART_BOTTOM = 0.7;
/** The gap above the risen logo. On a phone with a notch or Dynamic Island the logo starts below the status bar (the layer is full screen, so the inset is not applied for us). The gap between the logo and the welcome's heading is LOGO_GAP_PX. */
const LOGO_TOP = 'max(40px, calc(env(safe-area-inset-top, 0px) + 12px))';
const LOGO_GAP_PX = 8;
const round = (n: number) => Number(n.toFixed(4));
/** The frame is centred on the layer; this moves it up so the logo's top lands LOGO_TOP below the layer's top. */
const RISE_TRANSFORM = `translateY(calc(-50% + ${LOGO_TOP} + ${FRAME} * ${round((0.5 - ART_TOP) * RISE_SCALE)})) scale(${RISE_SCALE})`;
/** The height of the risen logo itself. */
const RISEN_LOGO_HEIGHT = `calc(${FRAME} * ${round((ART_BOTTOM - ART_TOP) * RISE_SCALE)})`;
const WELCOME_LOGO_SPACE = `calc(${LOGO_TOP} + ${LOGO_GAP_PX}px + ${FRAME} * ${round((ART_BOTTOM - ART_TOP) * RISE_SCALE)})`;
const RISE_MS = 400;
const WELCOME_FADE_MS = 300;
const WELCOME_DELAY_MS = 150;
/** How long the welcome may still be loading once it is due (animation over, or the still logo shown): then the splash fades. */
const WELCOME_LOAD_GRACE_MS = 4000;

type Phase = 'animating' | 'welcome' | 'leaving';
type WelcomeModule = ComponentType<WelcomeProps> | 'loading' | 'failed';
type WelcomeProps = {
  state: WelcomeState; profile: LaunchProfile | null; lastProject: ReturnType<typeof readLastProject>; isPro: boolean; online: boolean; light: boolean;
  onDone: (intent: LaunchIntent) => void; onSignedOut: () => void;
};

function shouldShow(): boolean {
  let alreadyShown = false;
  try { alreadyShown = sessionStorage.getItem(SEEN_KEY) === '1'; } catch { /* Without storage it simply shows each time. */ }
  return shouldShowSplash({ automated: navigator.webdriver === true, alreadyShown, forced: new URLSearchParams(location.search).has('splash') });
}

/**
 * Whether this device was used before, read when this module loads: that is before main.tsx saves the display settings
 * (`kestrel-display-v1`, written at every launch) and before the workspace writes keys of its own, either of which would
 * make a first launch look like a returning one.
 */
const PRIOR_USE_AT_LAUNCH = priorUseDetected();

/** What this device remembers, read once at launch. */
function readMemory() {
  const lastProject = readLastProject();
  return { profile: readProfile(), launchedBefore: launchedBefore(), hasProjects: lastProject !== null || PRIOR_USE_AT_LAUNCH, lastProject, skipChosen: skipChosen() };
}

/** After the layer closes: when no profile is remembered, ask the sign-in service once, quietly, whether a session is kept. */
async function quietProfileCheck() {
  try {
    if (readProfile() !== null || profileChecked()) return;
    const { firebaseAuth } = await import('../providers/firebaseAuth');
    const session = await firebaseAuth.current();
    if (session) writeProfile(profileFromSession(session), true);
    markProfileChecked();
  } catch { /* Never in the way: it is tried again next launch. */ }
}

function useOnline(active: boolean): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    if (!active) return;
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, [active]);
  return online;
}

/**
 * The launch animation from the InFlight brand pack (Lottie, 3 s): the chevron holds, the bird opens its wings, the wordmark follows.
 * Light and dark versions follow the display theme, and the Pro version shows only for a verified Pro licence.
 * It starts with the right one: while a licence kept on this device is still being read (a moment, at most LICENCE_WAIT_MS)
 * it shows only the background, so a Pro user never sees the standard logo first.
 *
 * Then it grows into the launch welcome: the finished logo rises and shrinks to the top and the welcome fades in beneath
 * it, on the same layer, until the person chooses where to go. A tap or key during the animation jumps to its last frame
 * and the welcome. A returning guest who chose to skip the welcome gets the animation alone, held a moment, then a fade.
 * With reduced motion there is no animation: the still logo sits at the top and the welcome shows at once.
 * While the layer is open no key reaches the workspace underneath. The player and the welcome are loaded on demand.
 */
export function Splash() {
  const [open, setOpen] = useState(shouldShow);
  const [phase, setPhaseState] = useState<Phase>('animating');
  const phaseRef = useRef<Phase>('animating');
  const setPhase = (next: Phase) => { phaseRef.current = next; setPhaseState(next); };
  const [played, setPlayed] = useState(false);
  const tone = useLogoTone();
  const pro = useIsPro();
  const licence = useLicence();
  const licenceKnown = useLicenceKnown();
  const [waitedForLicence, setWaitedForLicence] = useState(false);
  const logoReady = licenceKnown || waitedForLicence;
  const host = useRef<HTMLDivElement>(null);
  const item = useRef<AnimationItem | undefined>(undefined);
  const welcomeBox = useRef<HTMLDivElement>(null);
  const reduced = useRef(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false).current;
  const online = useOnline(open);

  // The welcome's choice of screen. The licence is read live until the welcome shows, then fixed.
  const memory = useState(readMemory)[0];
  const liveState = chooseWelcome({ profile: memory.profile, accountInLicence: licence.status === 'account', launchedBefore: memory.launchedBefore, hasProjects: memory.hasProjects });
  const skip = shouldSkipWelcome(liveState, memory.skipChosen);
  const [shown, setShown] = useState<{ state: WelcomeState; profile: LaunchProfile | null; key: number } | null>(null);
  const [Welcome, setWelcome] = useState<WelcomeModule>('loading');
  const [faded, setFaded] = useState(false);
  // The risen logo floats above the welcome; once its content scrolls, the logo steps aside so it never covers text.
  const [scrolled, setScrolled] = useState(false);
  // Read by the handlers below, which are set up once.
  const latest = useRef({ skip, Welcome, liveState });
  latest.current = { skip, Welcome, liveState };

  const showWelcome = () => {
    item.current?.goToAndStop(item.current.totalFrames - 1, true);
    setShown((was) => was ?? { state: latest.current.liveState, profile: memory.profile, key: 0 });
    setPhase('welcome');
  };
  /** The animation ended (played) or was cut short (skipped). */
  const finish = useRef<(how: 'played' | 'skipped') => void>(() => undefined);
  const hold = useRef(0);
  finish.current = (how) => {
    if (phaseRef.current !== 'animating') return;
    if (latest.current.skip || latest.current.Welcome === 'failed') {
      if (how === 'skipped') setPhase('leaving');
      else if (!hold.current) hold.current = window.setTimeout(() => setPhase('leaving'), HOLD_MS);
      return;
    }
    window.clearTimeout(hold.current);
    showWelcome();
  };

  useEffect(() => { if (open) { try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* Not remembered. */ } } }, [open]);
  useEffect(() => () => window.clearTimeout(hold.current), []);

  // Load the welcome while the animation plays. If it cannot load, the splash fades as it always did.
  useEffect(() => {
    if (!open) return;
    let live = true;
    import('../v2/ui/screens/LaunchWelcome')
      .then((module) => { if (live && latest.current.Welcome !== 'failed') setWelcome(() => module.default); }) // too late once given up
      .catch(() => { if (live) setWelcome('failed'); });
    return () => { live = false; };
  }, []); // Once, at launch.
  useEffect(() => { if (phase === 'welcome' && Welcome === 'failed') setPhase('leaving'); }, [phase, Welcome]);
  // A welcome that is due but still loading (a slow or stalled download) is given up after a moment, so the layer never
  // sits there with only the logo, holding every key.
  useEffect(() => {
    if (phase !== 'welcome' || Welcome !== 'loading') return;
    const giveUp = window.setTimeout(() => setWelcome('failed'), WELCOME_LOAD_GRACE_MS);
    return () => window.clearTimeout(giveUp);
  }, [phase, Welcome]);

  // Wait for the stored licence, but never for long.
  useEffect(() => {
    if (!open || logoReady) return;
    const giveUp = window.setTimeout(() => setWaitedForLicence(true), LICENCE_WAIT_MS);
    return () => window.clearTimeout(giveUp);
  }, [open, logoReady]);

  // Reduced motion: the welcome at once under the still logo, or, for a guest who skips it, the still logo held briefly.
  useEffect(() => {
    if (!open || !reduced || !logoReady || phaseRef.current !== 'animating') return;
    if (!skip && Welcome !== 'failed') { showWelcome(); return; }
    const leave = window.setTimeout(() => setPhase('leaving'), STILL_MS);
    return () => window.clearTimeout(leave);
  }, [open, reduced, logoReady, skip, Welcome]);

  // Otherwise play the animation. A new logo (theme or Pro) after the welcome shows is drawn at its last frame.
  useEffect(() => {
    if (!open || reduced || !logoReady || !host.current) return;
    let cancelled = false;
    const data = ANIMATIONS[pro ? (tone === 'light' ? 'proLight' : 'proDark') : tone];
    import('lottie-web/build/player/lottie_light').then(({ default: lottie }) => {
      if (cancelled || !host.current) return;
      const still = phaseRef.current !== 'animating';
      const animation = lottie.loadAnimation({ container: host.current, renderer: 'svg', loop: false, autoplay: !still, animationData: structuredClone(data) });
      item.current = animation;
      if (still) animation.goToAndStop(animation.totalFrames - 1, true);
      setPlayed(true);
      animation.addEventListener('complete', () => finish.current('played'));
    }).catch(() => { if (!cancelled) finish.current('skipped'); }); // If the player cannot load, never hold the app back.
    return () => { cancelled = true; item.current?.destroy(); item.current = undefined; };
  }, [open, reduced, logoReady, tone, pro]);

  // The welcome fades in a moment after the logo starts to rise.
  useEffect(() => {
    if (!shown || typeof Welcome !== 'function' || faded) return;
    const frame = window.requestAnimationFrame(() => setFaded(true));
    return () => window.cancelAnimationFrame(frame);
  }, [shown, Welcome, faded]);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const done = window.setTimeout(() => setOpen(false), reduced ? 0 : FADE_MS);
    return () => window.clearTimeout(done);
  }, [phase, reduced]);

  // Once the layer has gone, however it closed (a choice, a skip, or the fade when the welcome could not load): this
  // device has launched, and the quiet check for a kept sign-in.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open || !wasOpen.current) return;
    wasOpen.current = false;
    markLaunched();
    void quietProfileCheck();
  }, [open]);

  // While the layer is up, the workspace underneath is inert: no screen reader, Tab or click reaches it. That is every
  // element beside the layer in the page root, and anything the workspace puts straight into <body> (its dialogs and
  // notices), found by place rather than by any V2 name. Only what this set made inert is released again.
  const layer = useRef<HTMLDivElement>(null);
  const covering = open && phase !== 'leaving';
  useEffect(() => {
    const own = layer.current;
    const pageRoot = own?.parentElement;
    if (!covering || !own || !pageRoot) return;
    const made = new Set<Element>();
    const cover = () => {
      const others = [...pageRoot.children, ...document.body.children]
        .filter((el) => !el.contains(own) && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE');
      for (const el of others) {
        if (made.has(el) || el.hasAttribute('inert')) continue;
        el.setAttribute('inert', '');
        made.add(el);
      }
    };
    cover();
    const watch = new MutationObserver(cover);
    watch.observe(pageRoot, { childList: true });
    if (pageRoot !== document.body) watch.observe(document.body, { childList: true });
    return () => {
      watch.disconnect();
      made.forEach((el) => el.removeAttribute('inert'));
    };
  }, [covering]);

  // No key reaches the workspace while the layer is open. This listens first (capture, on window, set up before the
  // workspace mounts). During the animation any key or tap jumps to the welcome and the key is used up. While the welcome
  // shows it answers its own keys; any other key stops here (the welcome's own guard, also on window, still sees it).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const now = phaseRef.current;
      const welcomeHere = now === 'welcome' && welcomeBox.current?.firstElementChild;
      if (welcomeHere && welcomeBox.current?.contains(event.target as Node)) return;
      if (welcomeHere) { event.stopPropagation(); return; }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (now === 'animating') finish.current('skipped');
    };
    const onPointer = () => { if (phaseRef.current === 'animating') finish.current('skipped'); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onPointer, true); };
  }, [open]);

  if (!open) return null;
  const risen = shown !== null;
  const onDone = (intent: LaunchIntent) => {
    if (phaseRef.current !== 'welcome') return;
    requestLaunch(intent);
    markLaunched();
    setPhase('leaving');
  };
  const onSignedOut = () => setShown((was) => ({ state: 'guest', profile: null, key: (was?.key ?? 0) + 1 }));
  const welcomeStyle = {
    '--welcome-logo-space': WELCOME_LOGO_SPACE,
    opacity: reduced || faded ? 1 : 0,
    transition: reduced ? undefined : `opacity ${WELCOME_FADE_MS}ms ease-out ${WELCOME_DELAY_MS}ms`,
  } as CSSProperties;

  return (
    <div ref={layer} data-testid="splash" aria-hidden={risen ? undefined : 'true'} className="fixed inset-0 z-[1000]"
      style={{ backgroundColor: BACKGROUND[tone], opacity: phase === 'leaving' ? 0 : 1, pointerEvents: phase === 'leaving' ? 'none' : undefined, transition: reduced ? undefined : `opacity ${FADE_MS}ms ease-out` }}>
      {risen && typeof Welcome === 'function' && (
        <div ref={welcomeBox} className="absolute inset-0" style={welcomeStyle}
          onScrollCapture={(event) => setScrolled((event.target as HTMLElement).scrollTop > 4)}>
          <Welcome key={shown.key} state={shown.state} profile={shown.profile} lastProject={memory.lastProject} isPro={pro} online={online}
            light={tone === 'light'} onDone={onDone} onSignedOut={onSignedOut} />
        </div>
      )}
      {reduced ? (
        risen ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 flex justify-center" style={{ top: LOGO_TOP, height: RISEN_LOGO_HEIGHT, opacity: scrolled ? 0 : 1 }}>
            {logoReady && <BrandLogo kind="stacked" decorative className="h-full w-auto" />}
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            {logoReady && <BrandLogo kind="stacked" decorative className="h-auto w-[min(60vmin,16rem)]" />}
          </div>
        )
      ) : (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center"
          style={{ transform: risen ? RISE_TRANSFORM : undefined, opacity: risen && scrolled ? 0 : 1, transition: `transform ${RISE_MS}ms ease-out, opacity 150ms ease-out` }}>
          <div ref={host} data-testid="splash-animation" data-played={played} style={{ width: FRAME, height: FRAME }} />
        </div>
      )}
    </div>
  );
}
