import { useEffect, useState } from 'react';
import { isDesktopApp } from '../providers/desktopShell';
import { desktopReleasePlatform, publishedDesktopRelease, type DesktopReleaseNotice } from '../core/desktopRelease';

/** Signed installation remains disabled until native update/rollback tests pass. */
export const UPDATER_ENABLED = false;

const PUBLIC_LATEST_RELEASE = 'https://api.github.com/repos/DjL88/Kestrel/releases/latest';
const DISMISSED_RELEASE = 'kestrel.desktop.dismissedRelease.v1';
const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

type Pending =
  | { kind: 'signed'; version: string; install: () => Promise<void> }
  | { kind: 'notice'; release: DesktopReleaseNotice };

async function publishedNotice(installed: string): Promise<DesktopReleaseNotice | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(PUBLIC_LATEST_RELEASE, {
      signal: controller.signal, cache: 'no-store', credentials: 'omit',
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return null;
    return publishedDesktopRelease(await response.json(), installed);
  } finally {
    clearTimeout(timeout);
  }
}

function dismissed(version: string): boolean {
  try { return localStorage.getItem(DISMISSED_RELEASE) === version; } catch { return false; }
}
function rememberDismissal(version: string): void {
  try { localStorage.setItem(DISMISSED_RELEASE, version); } catch { /* Session-only dismissal. */ }
}

/** Announce public stable releases on macOS and Windows; never auto-install. */
export function DesktopUpdate() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isDesktopApp() || !desktopReleasePlatform(navigator.userAgent, navigator.maxTouchPoints)) return;
    let cancelled = false;
    let checking = false;

    async function checkForRelease() {
      if (cancelled || checking) return;
      checking = true;
      try {
        if (UPDATER_ENABLED) {
          const { check } = await import('@tauri-apps/plugin-updater');
          const update = await check();
          if (!update || cancelled || dismissed(update.version)) return;
          setPending({
            kind: 'signed',
            version: update.version,
            install: async () => {
              await update.downloadAndInstall();
              await (await import('@tauri-apps/plugin-process')).relaunch();
            },
          });
        } else {
          // Native version prevents an old cached webview from inventing an update.
          const { getVersion } = await import('@tauri-apps/api/app');
          const release = await publishedNotice(await getVersion());
          if (!cancelled && release && !dismissed(release.version)) {
            setPending({ kind: 'notice', release });
          }
        }
      } catch { /* Offline or unsupported: photo editing continues uninterrupted. */ }
      finally { checking = false; }
    }

    void checkForRelease();
    const timer = window.setInterval(() => void checkForRelease(), CHECK_EVERY_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  if (!pending) return null;
  const version = pending.kind === 'signed' ? pending.version : pending.release.version;

  const later = () => {
    rememberDismissal(version);
    setPending(null);
    setFailed(false);
  };

  const act = async () => {
    setBusy(true);
    setFailed(false);
    try {
      if (pending.kind === 'signed') {
        await pending.install(); // Signature-verified Tauri updater only.
      } else {
        // URL already restricted to this repository's official release page.
        await (await import('@tauri-apps/plugin-opener')).openUrl(pending.release.url);
        later();
      }
    } catch { setFailed(true); }
    finally { setBusy(false); }
  };

  return (
    <div role="status" className="fixed bottom-3 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-xl border border-white/15 bg-kestrel-raised px-4 py-2 text-sm text-zinc-100 shadow-lg">
      <span>{failed
        ? pending.kind === 'signed' ? 'Could not install the update.' : 'Could not open the release page.'
        : pending.kind === 'signed'
          ? 'Kestrel ' + version + ' is ready to install.'
          : 'Kestrel ' + version + ' is available for Mac and Windows.'}</span>
      <button type="button" disabled={busy}
        className="min-h-11 rounded-md bg-kestrel-copper px-3 font-semibold text-zinc-950 disabled:opacity-60"
        onClick={() => { void act(); }}>
        {busy ? 'Opening…' : pending.kind === 'signed' ? 'Install and restart' : 'View release'}
      </button>
      <button type="button" className="min-h-11 rounded-md px-3 text-zinc-300 hover:bg-white/8" onClick={later}>Later</button>
    </div>
  );
}
