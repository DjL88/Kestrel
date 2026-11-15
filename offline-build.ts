import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

export function offlineBuild(): Plugin {
  return {
    name: 'kestrel-offline',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((name) => name.startsWith('assets/')).sort();
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      this.emitFile({
        type: 'asset',
        fileName: 'offline.js',
        source: `
const prefix = 'kestrel:' + self.registration.scope + ':';
const cacheName = prefix + ${JSON.stringify(version)};
const root = new URL('./', self.registration.scope).href;
const assets = new Set(${JSON.stringify(files)}.map(path => new URL(path, root).href));

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
