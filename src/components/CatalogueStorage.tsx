import { useEffect, useState } from 'react';

type StorageState = 'checking' | 'standard' | 'requesting' | 'persistent' | 'declined' | 'unavailable';

const message: Record<StorageState, string> = {
  checking: 'Checking browser storage…',
  standard: 'The browser may clear this catalogue when it needs storage space.',
  requesting: 'Requesting persistent storage…',
  persistent: 'Persistent storage is on for Kestrel in this browser.',
  declined: 'The browser did not grant persistent storage. Keep a current catalogue backup.',
  unavailable: 'Persistent storage is unavailable in this browser session.',
};

export function CatalogueStorage() {
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
      <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm text-zinc-200">Catalogue storage</summary>
      <div className="space-y-2 px-3 pb-3 text-sm text-zinc-300">
        <p role="status">{message[state]}</p>
        {state !== 'checking' && (
          <p className="text-xs text-zinc-400">Open a project and choose <strong>Back up project</strong> in Workspace options. Keep the backup and your original photos somewhere you can access outside this browser.</p>
        )}
        {(canRequest || state === 'requesting' || state === 'persistent') && (
          <button type="button" aria-disabled={!canRequest} onClick={() => void requestPersistence()}
            className="min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8 aria-disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-sky-300">
            {state === 'persistent' ? 'Persistent storage enabled' : 'Request persistent storage'}
          </button>
        )}
      </div>
    </details>
  );
}
