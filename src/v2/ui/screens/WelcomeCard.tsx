import { useState } from 'react';
import { markWelcomeSeen, welcomeSeen } from '../../../core/firstRun';
import { requestBrowserStorage } from '../../../core/browserStorage';
import { isDesktopApp } from '../../../providers/desktopShell';
import { welcomeText as t } from '../../../i18n/areas/welcome';

const localStore = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/**
 * First run (PRODUCT-SPEC §3.1): three plain facts, shown once on the projects hub and never again after "Got it".
 * It sits in the page rather than over it, so nothing is blocked while it is showing. On the web, "Got it" is also
 * the moment InFlight asks the browser to keep its storage; the answer is shown in Settings → Storage.
 */
export default function WelcomeCard() {
  const [open, setOpen] = useState(() => !welcomeSeen(localStore()));
  if (!open) return null;
  const onWeb = !isDesktopApp();
  const dismiss = () => {
    markWelcomeSeen(localStore());
    setOpen(false);
    if (onWeb) void requestBrowserStorage(globalThis.navigator?.storage);
  };
  return (
    <section aria-labelledby="v2-welcome-title" data-testid="v2-welcome"
      className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 text-[var(--text-primary)]">
      <h2 id="v2-welcome-title" className="text-base font-semibold">{t.welcome.title}</h2>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">{t.welcome.intro}</p>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
        <li>{t.welcome.originals}</li>
        <li>{t.welcome.undo}</li>
        <li>{t.welcome.backup}</li>
      </ul>
      {onWeb && <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">{t.welcome.webNote}</p>}
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={dismiss}
          className="min-h-11 rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-4 text-sm font-semibold text-[var(--text-on-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-accent)]">
          {t.welcome.done}
        </button>
      </div>
    </section>
  );
}
