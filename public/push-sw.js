/*
 * InFlight push alerts (G20). Registered only after the person turned alerts on (src/providers/webPush.ts), under its own
 * scope so the offline worker is never replaced. It loads no other script and stores nothing: it shows the words the
 * server sent (names and counts only) and, when tapped, opens InFlight at that notice.
 */
const ID = /^[A-Za-z0-9_-]{1,96}$/;
const appUrl = () => new URL('..', self.registration.scope).href;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const data = payload.data || {};
  const note = payload.notification || {};
  const title = String(data.title || note.title || 'InFlight').slice(0, 120);
  const body = String(data.body || note.body || '').slice(0, 240);
  const projectId = ID.test(String(data.projectId || '')) ? String(data.projectId) : '';
  const photoId = ID.test(String(data.photoId || '')) ? String(data.photoId) : '';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    // Several notices about one project replace each other instead of piling up.
    tag: projectId ? `inflight-${projectId}` : 'inflight',
    renotify: false,
    data: { projectId, photoId },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { projectId, photoId } = event.notification.data || {};
  event.waitUntil((async () => {
    const base = appUrl();
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => w.url.startsWith(base));
    if (open) {
      await open.focus();
      if (projectId) open.postMessage({ type: 'inflight-push-open', projectId, photoId: photoId || null });
      return;
    }
    await self.clients.openWindow(base);
  })());
});
