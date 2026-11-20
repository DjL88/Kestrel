import { useEffect, useState } from 'react';
import { isDesktopApp } from '../providers/desktopShell';
import { projectsText as t } from '../i18n/areas/projects';

type StorageState = 'checking' | 'standard' | 'requesting' | 'persistent' | 'declined' | 'unavailable';

export function CatalogueStorage() {
  // Native app data is expected and needs no browser-storage warning on Home.
  if (isDesktopApp()) return null;
  return <BrowserStorage />;
}

function BrowserStorage() {
  const [state, setState] = useState<StorageState>('checking');

  useEffect(() => {
    const storage = navigator.storage;
    if (typeof storage?.persisted !== 'function' || typeof storage.persist !== 'function') {
      setState('unavailable');
      return;
    }
    let mounted = true;
    void storage.persisted().then(
      (persistent) => { if (mounted) setState(persistent ? 'persistent' : 'standard'); },
      () => { if (mounted) setState('unavailable'); },
    );
    return () => { mounted = false; };
  }, []);

  const canRequest = state === 'standard' || state === 'declined';
  async function requestPersistence() {
    if (!canRequest) return;
    setState('requesting');
    try {
      setState(await navigator.storage.persist() ? 'persistent' : 'declined');
    } catch {
      setState('unavailable');
    }
  }

  return (
    <details className="mt-4 rounded-xl border border-white/10 bg-kestrel-raised">
      <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm text-zinc-200">{t.storage.title}</summary>
      <div className="space-y-2 px-3 pb-3 text-sm text-zinc-300">
        <p role="status">{t.storage[state]}</p>
        {state !== 'checking' && (
          <p className="text-xs text-zinc-400">{t.storage.hintStart}<strong>{t.storage.hintStrong}</strong>{t.storage.hintEnd}</p>
        )}
        {(canRequest || state === 'requesting' || state === 'persistent') && (
          <button type="button" aria-disabled={!canRequest} onClick={() => void requestPersistence()}
            className="min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8 aria-disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-sky-300">
            {state === 'persistent' ? t.storage.enabled : t.storage.request}
          </button>
        )}
      </div>
    </details>
  );
}
