import { useEffect, useState } from 'react';
import { isDesktopApp } from '../providers/desktopShell';
import { libraryText as t } from '../i18n/areas/library';

/**
 * On only in desktop releases built by release.yml with the update key, which also ship signed update files
 * (scripts/release-signing.mjs sets VITE_KESTREL_UPDATER). Local, PR and unsigned builds never check.
 * The plugin refuses any update whose signature does not match the public key in tauri.conf.json.
 */
export const UPDATER_ENABLED = import.meta.env.VITE_KESTREL_UPDATER === '1';

type Pending = { version: string; install: () => Promise<void> };

/** Tells the person, once, when a newer desktop version is ready. It never installs without a tap. */
export function DesktopUpdate() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!UPDATER_ENABLED || !isDesktopApp()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (!update || cancelled) return;
        setPending({
          version: update.version,
          install: async () => {
            await update.downloadAndInstall();
            await (await import('@tauri-apps/plugin-process')).relaunch();
          },
        });
      } catch { /* Offline or no release yet: stay quiet. */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!pending) return null;
  return (
    <div role="status" className="fixed bottom-3 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-xl border border-white/15 bg-kestrel-raised px-4 py-2 text-sm text-zinc-100 shadow-lg">
      <span>{failed ? t.update.failed : t.update.ready(pending.version)}</span>
      {!failed && (
        <button type="button" disabled={busy} className="min-h-11 rounded-md bg-orange-500 px-3 font-medium text-black disabled:opacity-60"
          onClick={() => { setBusy(true); pending.install().catch(() => { setFailed(true); setBusy(false); }); }}>
          {busy ? t.update.installing : t.update.install}
        </button>
      )}
      <button type="button" className="min-h-11 rounded-md px-3 text-zinc-300 hover:bg-white/8" onClick={() => setPending(null)}>{t.update.later}</button>
    </div>
  );
}
