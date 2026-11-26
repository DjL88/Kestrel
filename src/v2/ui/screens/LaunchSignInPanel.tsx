import { useEffect, useId, useRef, useState, type FormEvent, type MutableRefObject } from 'react';
import { STRINGS } from '../strings';
import { availableProviders, continueWithEmail, createWithEmail, KEEP_SESSION_FAILED, signInWithProvider, type EmailResult, type LicenceLink, type SocialProvider } from '../../../providers/accountSignIn';
import { firebaseAuth, signInPlatform } from '../../../providers/firebaseAuth';
import { linkingProblemText, methodName } from '../../../components/SignInMethodsPanel';
import { SignInMark } from '../../../components/SignInMark';
import { projectsText } from '../../../i18n/areas/projects';

const t = STRINGS.welcome;

/** What the welcome shows under the greeting after signing in: the licence outcome, then any way in added or key moved. */
export function outcomeLine({ outcome, linked, attached }: LicenceLink): string {
  const links = projectsText.accountLinks;
  return [
    t.outcome[outcome],
    linked ? links.added(methodName(linked)) : '',
    attached === 'attached' ? links.keyAttached : attached === 'other' ? links.keyOther : '',
  ].filter(Boolean).join(' ');
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** The shared module words one failure in English; the welcome shows it in the person's language. */
const errorText = (message: string) => (message === KEEP_SESSION_FAILED ? t.keepSessionFailed : message);

/** Apple's mark, one colour, drawn in the button's text colour. */
function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true" focusable="false" className="shrink-0">
      <path fill="currentColor" d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2.1-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.7-1-2.7-4.1zM13.9 5c.7-.9 1.2-2 1-3.2-1 0-2.2.7-3 1.5-.6.7-1.2 1.9-1 3.1 1.1.1 2.3-.6 3-1.4z" />
    </svg>
  );
}

/** Google's four-colour "G". */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true" focusable="false" className="shrink-0">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1C3.4 21.4 7.4 24 12 24z" />
      <path fill="#FBBC05" d="M5.4 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.6.4-2.4V6.5h-4C.5 8.2 0 10 0 12s.5 3.8 1.4 5.5l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C18 1.2 15.2 0 12 0 7.4 0 3.4 2.6 1.4 6.5l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
    </svg>
  );
}

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-accent)]';
const base = `inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
export const buttonClass = {
  primary: `${base} border-transparent bg-[var(--brand-accent)] text-[var(--text-on-accent)] enabled:hover:bg-[var(--brand-accent-hover)]`,
  secondary: `${base} border-[var(--border-default)] bg-transparent text-[var(--text-primary)] enabled:hover:bg-[var(--bg-surface-hover)]`,
  // Each provider's own button rules: Apple black with a white mark, Google white with its four-colour mark, Microsoft
  // white with its four squares, a #8C8C8C border and #5E5E5E text.
  apple: `${base} border-[#444] bg-black text-white`,
  google: `${base} border-[#747775] bg-white text-[#1f1f1f]`,
  microsoft: `${base} border-[#8C8C8C] bg-white text-[#5E5E5E]`,
  link: `inline-flex min-h-11 items-center justify-center px-2 text-sm text-[var(--text-secondary)] underline underline-offset-4 enabled:hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`,
};

const fieldClass = 'min-h-11 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)] disabled:opacity-50';

type Step = 'choose' | 'email' | 'offer';

/**
 * The welcome's sign-in panel (sign in is also sign up): Apple and Google side by side (and Microsoft where the build
 * offers it), the device's suggested one first, then email under a divider.
 * It runs the same shared sign-in as Settings. Back (or Escape, which the welcome handles whatever has focus, through
 * `backRef`) steps back one level; from the first level it closes. Offline, every way in is disabled and the panel
 * says sign-in needs a connection.
 */
export default function LaunchSignInPanel({ online, onClose, onSignedIn, backRef }: {
  online: boolean;
  onClose: () => void;
  /** Set to the panel's Back, so the welcome's Escape steps back from anywhere in the layer. */
  backRef: MutableRefObject<(() => void) | null>;
  /** Signed in or account created. `note` is the line to show under the greeting; `pro` when Pro is now on. */
  onSignedIn: (note: string, pro: boolean) => void;
}) {
  const [providers] = useState(() => availableProviders());
  const [keep, setKeep] = useState(true);
  const [step, setStep] = useState<Step>('choose');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  /** Bumped after every attempt that did not sign in, so focus comes back even when the step stays the same. */
  const [attempt, setAttempt] = useState(0);
  /** The `data-focus-key` of the control to focus next: the one that started the attempt, or the password to retype. */
  const focusKey = useRef<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const ids = { keep: useId(), email: useId(), password: useId(), note: useId() };
  const showKeep = signInPlatform() === 'web';
  const keepChoice = showKeep ? keep : true;
  const disabled = !online || busy;
  // The device's suggested way in comes first (as in Settings). With three, it has the first row to itself and the
  // other two share the second; with one or two, they share one row. Tab order follows the reading order.
  const social = providers.filter((p): p is SocialProvider => p !== 'email');
  const rows = social.length > 2 ? [social.slice(0, 1), social.slice(1)] : [social];

  // Controls are disabled while an attempt runs, so focus falls to the page. After each step change or failed attempt
  // it goes back to the control that started it (or the password to retype), else the step's first control. Offline
  // the ways in are disabled, so the first control that can take focus (Back at worst) gets it.
  useEffect(() => {
    if (busy) return; // the controls are disabled until the attempt ends
    const panel = panelRef.current;
    const wanted = focusKey.current;
    focusKey.current = null;
    const target = (wanted ? panel?.querySelector<HTMLElement>(`[data-focus-key="${wanted}"]:not(:disabled)`) : null)
      ?? panel?.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)')
      ?? panel?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)');
    target?.focus();
  }, [step, attempt, busy]);

  const back = () => {
    if (busy) return;
    setNote('');
    if (step === 'offer') setStep('email');
    else if (step === 'email') { focusKey.current = 'email-entry'; setStep('choose'); }
    else onClose();
  };
  backRef.current = back;
  useEffect(() => () => { backRef.current = null; }, [backRef]);

  async function run(origin: string, work: () => Promise<void>) {
    if (disabled) return;
    focusKey.current = origin;
    setBusy(true);
    setNote('');
    try { await work(); } catch (error) { setNote(errorText(messageOf(error))); } finally {
      setBusy(false);
      setAttempt((n) => n + 1);
    }
  }

  const handleEmail = (result: EmailResult) => {
    switch (result.kind) {
      case 'signed-in': onSignedIn(outcomeLine(result.licence), result.licence.outcome === 'pro'); return;
      case 'created': onSignedIn(t.created, false); return;
      case 'offer-create': setStep('offer'); return;
      case 'wrong-password': focusKey.current = 'password'; setPassword(''); setStep('email'); setNote(t.wrongPassword); return;
      case 'linking': setNote(linkingProblemText(result.problem)); return;
      case 'error': setNote(errorText(result.message)); return;
    }
  };

  const withProvider = (provider: SocialProvider) => run(provider, async () => {
    const result = await signInWithProvider(provider, keepChoice);
    if (result.kind === 'signed-in') onSignedIn(outcomeLine(result.licence), result.licence.outcome === 'pro');
    else if (result.kind === 'verify-email') onSignedIn(t.confirmEmail, false);
    else setNote(result.kind === 'linking' ? linkingProblemText(result.problem) : errorText(result.message));
  });

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    void run('submit', async () => handleEmail(await continueWithEmail(email, password, keepChoice)));
  };

  const create = () => run('create', async () => handleEmail(await createWithEmail(email, password, keepChoice)));

  // The same neutral words as Settings: they never say whether the email has an account.
  const forgot = () => {
    if (email.trim()) void run('forgot', async () => { await firebaseAuth.sendPasswordReset(email); setNote(t.resetSent); });
  };

  const tryAgain = () => { setPassword(''); setNote(''); setStep('email'); };

  return (
    <div ref={panelRef} aria-busy={busy || undefined} data-testid="welcome-sign-in" className="flex w-full flex-col gap-3">
      {!online && <p className="text-center text-sm text-[var(--text-secondary)]" data-testid="welcome-offline-sign-in">{t.offlineSignIn}</p>}

      {step === 'choose' && (
        <>
          {showKeep && (
            <label htmlFor={ids.keep} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-[var(--text-secondary)]">
              <input id={ids.keep} type="checkbox" checked={keep} disabled={disabled} onChange={(event) => setKeep(event.target.checked)}
                className="h-5 w-5 shrink-0 accent-[var(--brand-accent)]" />
              {t.keepSignedIn}
            </label>
          )}
          {social.length > 0 && (
            <div className="flex w-full flex-col gap-2" data-testid="welcome-providers">
              {rows.map((row, rowIndex) => (
                <div key={row.join('-')} className="flex w-full gap-2">
                  {row.map((provider, index) => (
                    <button key={provider} type="button" disabled={disabled} onClick={() => void withProvider(provider)}
                      aria-label={provider === 'apple' ? t.withApple : provider === 'microsoft' ? t.withMicrosoft : t.withGoogle}
                      data-focus-key={provider} data-autofocus={rowIndex === 0 && index === 0 ? true : undefined}
                      className={`${buttonClass[provider]} flex-1`}>
                      {provider === 'apple' ? <AppleMark /> : provider === 'microsoft' ? <SignInMark provider="microsoft" className="h-[18px] w-[18px] shrink-0" /> : <GoogleMark />}
                      {projectsText.accountLinks[provider]}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
          {social.length > 0 && (
            <div className="flex items-center gap-2 py-1 text-xs text-[var(--text-muted)]">
              <span aria-hidden="true" className="h-px flex-1 bg-[var(--border-subtle)]" />
              {t.or}
              <span aria-hidden="true" className="h-px flex-1 bg-[var(--border-subtle)]" />
            </div>
          )}
          <button type="button" disabled={disabled} onClick={() => { setNote(''); setStep('email'); }}
            data-focus-key="email-entry" data-autofocus={social.length === 0 ? true : undefined} className={buttonClass.secondary}>
            {t.withEmail}
          </button>
        </>
      )}

      {step === 'email' && (
        <form onSubmit={submitEmail} className="flex w-full flex-col gap-3" noValidate>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.email} className="text-xs text-[var(--text-secondary)]">{t.email}</label>
            <input id={ids.email} type="email" autoComplete="email" inputMode="email" required value={email} disabled={busy}
              onChange={(event) => setEmail(event.target.value)} data-autofocus className={fieldClass} aria-describedby={note ? ids.note : undefined} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.password} className="text-xs text-[var(--text-secondary)]">{t.password}</label>
            <input id={ids.password} type="password" autoComplete="current-password" required value={password} disabled={busy}
              onChange={(event) => setPassword(event.target.value)} data-focus-key="password" className={fieldClass} aria-describedby={note ? ids.note : undefined} />
          </div>
          <button type="submit" data-focus-key="submit" disabled={disabled || !email.trim() || !password} className={buttonClass.primary}>{t.withEmail}</button>
          <button type="button" disabled={disabled || !email.trim()} onClick={forgot} data-focus-key="forgot" className={`${buttonClass.link} self-center`}>{t.forgotPassword}</button>
        </form>
      )}

      {step === 'offer' && (
        <div className="flex w-full flex-col gap-3">
          <p className="text-sm text-[var(--text-primary)]">{t.offerCreate(email.trim())}</p>
          <button type="button" disabled={disabled} onClick={() => void create()} data-focus-key="create" data-autofocus className={buttonClass.primary}>{t.createAccount}</button>
          <button type="button" disabled={busy} onClick={tryAgain} className={buttonClass.secondary}>{t.tryAgain}</button>
        </div>
      )}

      <p id={ids.note} role="status" aria-live="polite" className="min-h-5 text-center text-sm text-[var(--text-secondary)]" data-testid="welcome-sign-in-note">{note}</p>

      <button type="button" disabled={busy} onClick={back} className={`${buttonClass.link} self-center`}>{t.back}</button>
    </div>
  );
}
