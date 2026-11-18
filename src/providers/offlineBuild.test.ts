import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { isDesktopBuild, offlineWorkerSource, retiringWorkerSource } from '../../offline-build.ts';

/** Run a worker script against a minimal service-worker global and return what it did. */
async function runRetiringWorker(cacheKeys: string[]) {
  const scope = 'http://tauri.localhost/';
  const listeners: Record<string, (event: { waitUntil(p: Promise<unknown>): void }) => void> = {};
  const log: string[] = [];
  const remaining = new Set(cacheKeys);
  const pending: Promise<unknown>[] = [];
  const self = {
    registration: { scope, unregister: async () => { log.push('unregister'); return true; } },
    addEventListener: (name: string, fn: (event: { waitUntil(p: Promise<unknown>): void }) => void) => { listeners[name] = fn; },
    skipWaiting: () => { log.push('skipWaiting'); },
    clients: {
      claim: async () => { log.push('claim'); },
      matchAll: async () => [{ url: scope, navigate: async (url: string) => { log.push(`reload ${url}`); } }],
    },
  };
  const caches = {
    keys: async () => [...remaining],
    delete: async (key: string) => { remaining.delete(key); log.push(`delete ${key}`); return true; },
  };
  vm.runInNewContext(retiringWorkerSource(), { self, caches, URL });
  const event = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
  listeners.install(event);
  listeners.activate(event);
  await Promise.all(pending);
  return { log, remaining: [...remaining] };
}

test('desktop builds are recognised from the Tauri CLI or an explicit flag, and web builds are not', () => {
  assert.equal(isDesktopBuild({ TAURI_ENV_PLATFORM: 'windows' }), true);
  assert.equal(isDesktopBuild({ KESTREL_DESKTOP_BUILD: '1' }), true);
  assert.equal(isDesktopBuild({}), false);
});

test('the desktop worker removes the stale app cache, keeps user data, unregisters and reloads into the new app', async () => {
  const appShell = 'kestrel:http://tauri.localhost/:0123456789ab';
  const { log, remaining } = await runRetiringWorker([appShell, 'kestrel-species-v1', 'someone-else']);
  assert.deepEqual(remaining.sort(), ['kestrel-species-v1', 'someone-else'], 'species model and unrelated caches survive');
  assert.ok(log.indexOf('skipWaiting') < log.indexOf('claim'), 'takes over from the old worker straight away');
  assert.ok(log.indexOf(`delete ${appShell}`) < log.indexOf('unregister'));
  assert.ok(log.indexOf('unregister') < log.indexOf('reload http://tauri.localhost/'), 'reloads only after removing itself');
});

test('the desktop worker never serves anything from a cache', () => {
  assert.doesNotMatch(retiringWorkerSource(), /fetch/);
});

test('the web worker still caches the app shell under a version that follows the files', () => {
  const one = offlineWorkerSource(['assets/a.js'], []);
  const two = offlineWorkerSource(['assets/b.js'], []);
  assert.match(one, /addEventListener\('fetch'/);
  assert.notEqual(one.match(/cacheName = prefix \+ "(\w+)"/)?.[1], two.match(/cacheName = prefix \+ "(\w+)"/)?.[1]);
});
