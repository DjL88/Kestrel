import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

export function offlineBuild(): Plugin {
  return {
    name: 'kestrel-offline',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const all = Object.keys(bundle).filter((name) => name.startsWith('assets/')).sort();
      // The WebAssembly runtime is large and only needed for subject detection, so it is cached when first used.
      const lazy = all.filter((name) => /ort-wasm.*\.wasm$/.test(name));
      const files = all.filter((name) => !lazy.includes(name));
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      this.emitFile({
        type: 'asset',
        fileName: 'offline.js',
        source: `
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
`,
      });
    },
  };
}
