import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

/**
 * Is this build for the desktop app? The Tauri CLI sets TAURI_ENV_PLATFORM while it runs `npm run build`
 * (beforeBuildCommand), for local builds and CI alike; KESTREL_DESKTOP_BUILD is an explicit override.
 */
export function isDesktopBuild(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.TAURI_ENV_PLATFORM) || env.KESTREL_DESKTOP_BUILD === '1';
}

/** The web/PWA offline worker: caches the app shell so the site opens without a network after the first visit. */
export function offlineWorkerSource(files: string[], lazy: string[]): string {
  const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
  return `
const prefix = 'kestrel:' + self.registration.scope + ':';
const cacheName = prefix + ${JSON.stringify(version)};
const root = new URL('./', self.registration.scope).href;
const assets = new Set(${JSON.stringify(files)}.map(path => new URL(path, root).href));
const lazy = new Set(${JSON.stringify(lazy)}.map(path => new URL(path, root).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll([root, ...assets])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(prefix) && key !== cacheName).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (lazy.has(request.url)) {
    event.respondWith(caches.open(cacheName).then(cache => cache.match(request.url).then(cached => cached ||
      fetch(request).then(response => { if (response.ok) cache.put(request.url, response.clone()); return response; }))));
    return;
  }
  const navigation = request.mode === 'navigate' && url.origin + url.pathname === root;
  if (!navigation && !assets.has(request.url)) return;
  event.respondWith(caches.open(cacheName)
    .then(cache => cache.match(navigation ? root : request.url, { ignoreVary: true }))
    .then(cached => cached || fetch(request)));
});
`;
}

/**
 * The desktop app bundles its own files, so it must never be served from an offline cache. Older Windows installers
 * registered the web worker above inside WebView2 (http://tauri.localhost), and WebView2 keeps it between installs, so
 * a new installer kept opening the OLD app from that cache. That is why Windows looked behind the Mac, where the
 * tauri:// scheme never allowed a worker.
 *
 * The browser re-checks offline.js on every launch. A desktop build ships this replacement: it takes over at once,
 * deletes only Kestrel's app-shell caches (never IndexedDB, catalogues, settings or the species model, which use other
 * stores and names), unregisters itself and reloads the window, so the first launch of a new installer shows the new app.
 */
export function retiringWorkerSource(): string {
  return `
const prefix = 'kestrel:' + self.registration.scope + ':';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(prefix)).map(key => caches.delete(key)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    await Promise.all(windows.map(client => client.navigate(client.url).catch(() => undefined)));
  })());
});
`;
}

export function offlineBuild(desktop = isDesktopBuild()): Plugin {
  return {
    name: 'kestrel-offline',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      if (desktop) {
        this.emitFile({ type: 'asset', fileName: 'offline.js', source: retiringWorkerSource() });
        return;
      }
      const all = Object.keys(bundle).filter((name) => name.startsWith('assets/')).sort();
      // The WebAssembly runtime is large and only needed for subject detection, so it is cached when first used.
      const lazy = all.filter((name) => /ort-wasm.*\.wasm$/.test(name));
      const files = all.filter((name) => !lazy.includes(name));
      this.emitFile({ type: 'asset', fileName: 'offline.js', source: offlineWorkerSource(files, lazy) });
    },
  };
}
