import { useEffect, useState } from 'react';
import { canAskBrowser, readBrowserStorage, requestBrowserStorage, type BrowserStorageState } from '../../../core/browserStorage';
import { isDesktopApp } from '../../../providers/desktopShell';
import { welcomeText } from '../../../i18n/areas/welcome';

/**
 * Settings → Storage, web only (PRODUCT-SPEC §3.1, §6): whether the browser has agreed to keep InFlight's storage,
 * a button to ask, and in plain words what file permissions mean and what the browser can forget. The desktop and
 * phone apps keep their data in the app's own folder, so they show nothing here.
 */
export default function BrowserStorageSection() {
  if (isDesktopApp()) return null;
  return <BrowserStorage />;
}

function BrowserStorage() {
  const t = welcomeText.browserStorage;
  const [state, setState] = useState<BrowserStorageState>('checking');

  useEffect(() => {
    let mounted = true;
    void readBrowserStorage(globalThis.navigator?.storage).then((next) => { if (mounted) setState(next); });
    return () => { mounted = false; };
  }, []);

  const ask = async () => {
    if (!canAskBrowser(state)) return;
    setState('requesting');
    setState(await requestBrowserStorage(globalThis.navigator?.storage));
  };

  return (
    <section aria-labelledby="v2-browser-storage-title" data-testid="v2-browser-storage"
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4">
      <h3 id="v2-browser-storage-title" className="text-xs font-semibold text-[var(--text-primary)]">{t.title}</h3>
      <p role="status" aria-live="polite" className="text-xs leading-relaxed text-[var(--text-secondary)]">{t[state]}</p>
      {(canAskBrowser(state) || state === 'requesting' || state === 'persistent') && (
        <button type="button" aria-disabled={!canAskBrowser(state)} onClick={() => void ask()}
          className="min-h-11 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] aria-disabled:cursor-default aria-disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]">
          {state === 'persistent' ? t.kept : t.ask}
        </button>
      )}
      <div>
        <h4 className="text-xs font-semibold text-[var(--text-primary)]">{t.permissionsTitle}</h4>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{t.permissions}</p>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-[var(--text-primary)]">{t.forgetTitle}</h4>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{t.forget}</p>
      </div>
      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{t.backupHint}</p>
    </section>
  );
}
