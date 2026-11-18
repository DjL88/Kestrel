import { useEffect, useState } from 'react';
import { desktopReleasePlatform, publishedDesktopRelease, type DesktopReleaseNotice } from '../core/desktopRelease';
import { isDesktopApp } from '../providers/desktopShell';

/** Off until signing, update and rollback have been tested on real machines. Switch on in the release that first ships updates. */
export const UPDATER_ENABLED = false;
const INSTALLED_VERSION = '26.11.2';
const RELEASE_API = 'https://api.github.com/repos/DjL88/Kestrel/releases/latest';

type Pending = { version: string; install: () => Promise<void> };

/** Tells the person, once, when a newer desktop version is ready. It never installs without a tap. */
export function DesktopUpdate() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<DesktopReleaseNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isDesktopApp()) return;
    let cancelled = false;
    void (async () => {
      if (UPDATER_ENABLED) {
        try {
          const { check } = await import('@tauri-apps/plugin-updater');
          const update = await check();
          if (update && !cancelled) {
            setPending({
              version: update.version,
              install: async () => {
                await update.downloadAndInstall();
                await (await import('@tauri-apps/plugin-process')).relaunch();
              },
            });
            return;
          }
        } catch { /* Fall through to safe public notice check below. */ }
      }
      if (!desktopReleasePlatform(navigator.userAgent, navigator.maxTouchPoints)) return;
      try {
        const res = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
        if (!res.ok || cancelled) return;
        const checked = publishedDesktopRelease(await res.json(), INSTALLED_VERSION);
        if (checked && !cancelled) setNotice(checked);
      } catch { /* Offline or unavailable: stay quiet. */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (pending) {
    return (
      <div role="status" className="fixed bottom-3 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-xl border border-white/15 bg-kestrel-raised px-4 py-2 text-sm text-zinc-100 shadow-lg">
        <span>{failed ? 'The update did not install. Try again later.' : `Kestrel ${pending.version} is ready.`}</span>
        {!failed && (
          <button type="button" disabled={busy} className="min-h-11 rounded-md bg-orange-500 px-3 font-medium text-black disabled:opacity-60"
            onClick={() => { setBusy(true); pending.install().catch(() => { setFailed(true); setBusy(false); }); }}>
            {busy ? 'Installing…' : 'Install and restart'}
          </button>
        )}
        <button type="button" className="min-h-11 rounded-md px-3 text-zinc-300 hover:bg-white/8" onClick={() => setPending(null)}>Later</button>
      </div>
    );
  }

  if (!notice) return null;
  return (
    <div role="status" className="fixed bottom-3 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-xl border border-white/15 bg-kestrel-raised px-4 py-2 text-sm text-zinc-100 shadow-lg">
      <span>Kestrel {notice.version} is available.</span>
      <a href={notice.url} target="_blank" rel="noreferrer" className="min-h-11 inline-flex items-center rounded-md bg-kestrel-copper px-3 font-semibold text-zinc-950 hover:bg-kestrel-copper-hover!">
        Release notes
      </a>
      <button type="button" className="min-h-11 rounded-md px-3 text-zinc-300 hover:bg-white/8" onClick={() => setNotice(null)}>Later</button>
    </div>
  );
}
