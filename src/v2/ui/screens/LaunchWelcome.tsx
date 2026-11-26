import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import '../tokens.css';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import type { LastProject, LaunchProfile, WelcomeState } from '../../../core/launchWelcome';
import type { LaunchIntent } from '../../launchIntent';
import { markLaunched, readProfile, setSkipChosen, skipChosen } from '../../../providers/launchMemory';
import { signOutEverywhere } from '../../../providers/accountSignIn';
import LaunchSignInPanel, { buttonClass } from './LaunchSignInPanel';

const t = STRINGS.welcome;

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement | null): HTMLElement[] {
  return root ? [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0) : [];
}

/**
 * Keeps Tab inside the welcome, and keeps every key away from the workspace underneath while it shows. Escape goes to
 * `escapeRef` (the sign-in panel's Back while it is open) whatever has focus, even when a disabled control dropped it.
 */
function useWelcomeKeys(rootRef: RefObject<HTMLElement | null>, escapeRef: RefObject<(() => void) | null>) {
  useEffect(() => {
    // Focus can leave the layer (to the page) when a control is disabled or a click lands on nothing focusable: bring
    // Tab back in, answer Escape, and swallow other keys.
    const guard = (event: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root || root.contains(event.target as Node)) return;
      event.stopPropagation();
      if (event.key === 'Tab') { event.preventDefault(); focusables(root)[0]?.focus(); }
      else if (event.key === 'Escape' && escapeRef.current) { event.preventDefault(); escapeRef.current(); }
    };
    window.addEventListener('keydown', guard, true);
    return () => window.removeEventListener('keydown', guard, true);
  }, [rootRef, escapeRef]);

  return (event: ReactKeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape' && escapeRef.current) { event.preventDefault(); escapeRef.current(); return; }
    if (event.key !== 'Tab') return;
    const items = focusables(rootRef.current);
    if (items.length === 0) { event.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !items.includes(active as HTMLElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || !items.includes(active as HTMLElement))) { event.preventDefault(); first.focus(); }
  };
}

function editedOn(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The last project, read from the local snapshot so it never waits for the catalogue. */
function ProjectCard({ project, highlighted, labelId, onOpen, buttonRef }: {
  project: LastProject; highlighted: boolean; labelId?: string; onOpen: () => void; buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const nameId = useId();
  const when = editedOn(project.editedAt);
  return (
    <button ref={buttonRef} type="button" onClick={onOpen} data-testid="welcome-last-project"
      aria-labelledby={labelId ? `${labelId} ${nameId}` : nameId}
      className={`flex min-h-16 w-full items-center gap-3 rounded-[var(--radius-lg)] border p-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-accent)] ${
        highlighted ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)]' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]'}`}>
      <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--bg-surface-raised)] text-[var(--text-muted)]">
        <BrandIcon name="folder" size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span id={nameId} className="block truncate text-sm font-semibold text-[var(--text-primary)]">{project.name}</span>
        <span className="block text-xs text-[var(--text-muted)]">{STRINGS.hub.photosCount(project.photoCount)}{when ? ` · ${when}` : ''}</span>
      </span>
      <BrandIcon name="chevron-right" size={18} className={`${highlighted ? 'text-[var(--brand-accent)]' : 'text-[var(--text-muted)]'}`} />
    </button>
  );
}

/**
 * The launch welcome that the splash grows into (V2). First launch, welcome back (signed in) and returning guest, plus
 * the sign-in panel. Everything shown is read from this device, so it renders at once and offline. The splash draws
 * the logo above it; `--welcome-logo-space` on the layer reserves its room.
 */
export default function LaunchWelcome({ state, profile, lastProject, isPro, online, light, onDone, onSignedOut }: {
  state: WelcomeState;
  profile: LaunchProfile | null;
  lastProject: LastProject | null;
  isPro: boolean;
  online: boolean;
  light: boolean;
  onDone: (intent: LaunchIntent) => void;
  onSignedOut: () => void;
}) {
  const [view, setView] = useState<WelcomeState>(state);
  const [who, setWho] = useState<LaunchProfile | null>(profile);
  const [proNow, setProNow] = useState(isPro);
  const [signingIn, setSigningIn] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [skip, setSkip] = useState(() => skipChosen());
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const signInRef = useRef<HTMLButtonElement>(null);
  const returnToSignIn = useRef(false);
  const pickUpId = useId();
  const skipId = useId();
  const panelBack = useRef<(() => void) | null>(null);
  const onKeyDown = useWelcomeKeys(rootRef, panelBack);

  useEffect(() => { setProNow((was) => was || isPro); }, [isPro]);

  // Focus starts on the primary action, and comes back to Sign in when the panel closes.
  useEffect(() => {
    if (signingIn) return;
    const target = returnToSignIn.current ? signInRef.current : primaryRef.current;
    returnToSignIn.current = false;
    (target ?? primaryRef.current)?.focus();
  }, [signingIn, view]);

  const openProject = () => { if (lastProject) onDone({ kind: 'project', id: lastProject.id }); };
  const goToProjects = () => onDone({ kind: 'projects' });
  const continueAsGuest = () => { markLaunched(); onDone({ kind: 'projects' }); };

  const closePanel = () => { returnToSignIn.current = true; setSigningIn(false); };
  const signedIn = (note: string, pro: boolean) => {
    setWho(readProfile());
    if (pro) setProNow(true);
    setOutcome(note);
    setSigningIn(false);
    setView('signedIn');
  };

  async function notYou() {
    if (busy) return;
    setBusy(true);
    try {
      await signOutEverywhere();
      onSignedOut();
    } catch (error) {
      setOutcome(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const name = who?.displayName ?? null;
  const title = signingIn ? t.signInOrCreate : view === 'first' ? t.firstTitle : view === 'signedIn' && name ? t.welcomeBackName(name) : t.welcomeBack;

  return (
    <main ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown} data-testid="launch-welcome" data-welcome-state={view}
      data-v2-theme={light ? 'light' : 'dark'}
      className="inflight-v2 flex h-full w-full flex-col items-center overflow-y-auto px-[22px] pb-6 pt-[var(--welcome-logo-space,168px)] font-[family-name:var(--font-sans)] text-[var(--text-primary)] outline-none">
      <div className="flex w-full max-w-[20rem] flex-1 flex-col items-center">
        {view === 'signedIn' && !signingIn && who?.initial && (
          <span aria-hidden="true" className="mt-2 grid h-14 w-14 place-items-center rounded-full border border-[var(--border-default)] bg-[var(--brand-accent-soft)] text-[22px] font-semibold text-[var(--brand-accent)]">
            {who.initial}
          </span>
        )}
        <h1 className="mt-3 text-center text-[21px] font-semibold tracking-tight">{title}</h1>

        {!signingIn && view === 'first' && <p className="mt-1.5 max-w-[30ch] text-center text-sm text-[var(--text-secondary)]">{t.firstBody}</p>}
        {!signingIn && view === 'guest' && <p className="mt-1.5 max-w-[30ch] text-center text-sm text-[var(--text-secondary)]">{t.guestBody}</p>}
        {!signingIn && view === 'signedIn' && proNow && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] px-2.5 py-0.5 text-xs text-[var(--text-secondary)]" data-testid="welcome-pro">
            <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-[var(--semantic-success)]" />{t.proConfirmed}
          </p>
        )}
        {!signingIn && view === 'signedIn' && (
          <p role="status" aria-live="polite" className="mt-2 max-w-[34ch] text-center text-sm text-[var(--text-secondary)]" data-testid="welcome-outcome">{outcome}</p>
        )}

        {!signingIn && view === 'guest' && lastProject && (
          <div className="mt-4 w-full"><ProjectCard project={lastProject} highlighted={false} onOpen={openProject} /></div>
        )}

        <div className="min-h-6 flex-1" />

        {signingIn ? (
          <LaunchSignInPanel online={online} onClose={closePanel} onSignedIn={signedIn} backRef={panelBack} />
        ) : view === 'signedIn' ? (
          <div className="flex w-full flex-col items-center gap-3">
            {lastProject && (
              <>
                <span id={pickUpId} className="self-start text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">{t.pickUp}</span>
                <ProjectCard project={lastProject} highlighted labelId={pickUpId} onOpen={openProject} buttonRef={primaryRef} />
              </>
            )}
            <button ref={lastProject ? undefined : primaryRef} type="button" onClick={goToProjects}
              className={lastProject ? buttonClass.secondary : buttonClass.primary}>{t.goToProjects}</button>
            <button type="button" disabled={busy} onClick={() => void notYou()} className={buttonClass.link}>{t.notYou}</button>
          </div>
        ) : (
          <div className="flex w-full flex-col items-center gap-2.5">
            <button ref={primaryRef} type="button" onClick={continueAsGuest} className={buttonClass.primary}>{t.continueGuest}</button>
            <button ref={signInRef} type="button" onClick={() => { setOutcome(''); setSigningIn(true); }} className={buttonClass.secondary}>{t.signIn}</button>
            {view === 'first' && <p className="mt-1.5 text-center text-xs text-[var(--text-muted)]">{t.offlineNote}</p>}
            {view === 'guest' && (
              <label htmlFor={skipId} className="flex min-h-11 cursor-pointer items-center gap-3 self-start text-sm text-[var(--text-secondary)]">
                <input id={skipId} type="checkbox" checked={skip} className="h-5 w-5 shrink-0 accent-[var(--brand-accent)]"
                  onChange={(event) => { setSkip(event.target.checked); setSkipChosen(event.target.checked); }} />
                {t.skipNextTime}
              </label>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
