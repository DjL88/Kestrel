import { expect, test } from '@playwright/test';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';

/**
 * The desktop app is served cross-origin isolated (COOP/COEP in src-tauri/tauri.conf.json), so onnxruntime there runs a
 * model on 2-4 threads (src/core/ortThreads.ts). Built as one single-file worker, a model worker started onnxruntime's
 * thread helpers from its own file; they ran the worker's code, never answered, and every model in a worker (subject
 * finder for Auto pick, Select subject, tap to select, denoise's subject guard) waited for ever at 0% CPU on Windows.
 * This check serves the built app the same way and starts the real model worker on two threads.
 */
const dist = process.env.KESTREL_DIST ?? 'dist';
const standIn = readFileSync('tests/fixtures/stand-in-gate.onnx');

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'The phone apps are not served cross-origin isolated, so they use one thread');
});

// The built files served with the desktop app's isolation headers on every response, workers' own fetches included.
let server: Server;
let origin = '';
const types: Record<string, string> = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.html': 'text/html' };
test.beforeAll(async () => {
  server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)).replace(/^([/\\])+/, '');
    const file = join(dist, path);
    if (path.startsWith('..') || !existsSync(file) || statSync(file).isDirectory()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream',
      'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' });
    createReadStream(file).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

test('a model worker in the built app starts on several threads when the page is cross-origin isolated', async ({ page }) => {
  const worker = readdirSync(join(dist, 'assets')).find((name) => /^modelSessionWorker-.*\.js$/.test(name));
  expect(worker, 'the built app has its model worker').toBeTruthy();
  await page.goto(`${origin}/build-info.json`);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  const outcome = await page.evaluate(async ([url, model]) => {
    const started = new Worker(url, { type: 'module' });
    const bytes = new Uint8Array(model).buffer;
    return await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve('no answer in 30 s'), 30_000);
      started.onerror = (event) => { clearTimeout(timer); resolve(`worker error: ${event.message}`); };
      started.onmessage = (event) => { clearTimeout(timer); resolve(event.data.type === 'ready' ? 'ready' : `error: ${event.data.message}`); };
      started.postMessage({ type: 'init', model: bytes, ort: { threads: 2, executionProviders: ['wasm'] } }, [bytes]);
    });
  }, [`/assets/${worker}`, Array.from(standIn)] as const);
  expect(outcome).toBe('ready');
});
