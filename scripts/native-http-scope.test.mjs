import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const config = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));
const http = config.permissions.find((entry) => typeof entry === 'object' && entry.identifier === 'http:default');

test('native HTTP capability never grants wildcard plaintext hosts', () => {
  assert.ok(http, 'HTTP capability exists');
  const urls = http.allow.map((entry) => entry.url);
  assert.ok(urls.some((url) => url === 'https://*'), 'HTTPS BYO services remain available');
  assert.ok(urls.includes('http://localhost:*'), 'loopback helper access remains available');
  assert.ok(urls.includes('http://127.0.0.1:*'), 'IPv4 loopback helper access remains available');
  for (const url of urls) {
    if (!url.startsWith('http://')) continue;
    assert.match(url, /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\*)?$/, `unsafe plaintext HTTP scope: ${url}`);
  }
});

test('native window retains explicit file picker and offline file access', () => {
  assert.ok(config.permissions.includes('dialog:allow-open'));
  assert.ok(config.permissions.includes('dialog:allow-save'));
  assert.ok(config.permissions.includes('fs:allow-read-file'));
  assert.ok(config.permissions.includes('fs:allow-write-file'));
});

const nativeConfig = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));

function cspDirectives() {
  const csp = nativeConfig.app?.security?.csp;
  assert.equal(typeof csp, 'string', 'production Tauri CSP must not be null');
  const directives = new Map();
  for (const directive of csp.split(';').map((entry) => entry.trim()).filter(Boolean)) {
    const [name, ...sources] = directive.split(/\s+/);
    assert.ok(!directives.has(name), 'duplicate CSP directive: ' + name);
    directives.set(name, sources);
  }
  return directives;
}

test('native CSP denies unrestricted scripts, frames and plugin content', () => {
  const directives = cspDirectives();
  assert.deepEqual(directives.get('default-src'), ["'self'"]);
  assert.deepEqual(directives.get('base-uri'), ["'none'"]);
  assert.deepEqual(directives.get('object-src'), ["'none'"]);
  assert.deepEqual(directives.get('frame-ancestors'), ["'none'"]);
  assert.deepEqual(directives.get('form-action'), ["'none'"]);
  const scripts = directives.get('script-src') ?? [];
  assert.ok(scripts.includes("'self'"));
  assert.ok(scripts.includes("'wasm-unsafe-eval'"), 'offline ONNX/RAW WASM execution remains permitted');
  assert.ok(!scripts.includes("'unsafe-eval'"), 'general JavaScript eval must remain blocked');
  assert.ok(!scripts.includes("'unsafe-inline'"), 'unrestricted inline scripts must remain blocked');
  for (const [name, sources] of directives) {
    assert.ok(!sources.includes('*'), 'wildcard CSP source in ' + name);
  }
});

test('native CSP keeps verified offline image, worker and WASM sources available', () => {
  const directives = cspDirectives();
  const workers = directives.get('worker-src') ?? [];
  assert.ok(workers.includes("'self'"));
  assert.ok(workers.includes('blob:'));
  const images = directives.get('img-src') ?? [];
  for (const source of ["'self'", 'asset:', 'http://asset.localhost', 'data:', 'blob:']) {
    assert.ok(images.includes(source), 'offline image source required: ' + source);
  }
  assert.ok((directives.get('font-src') ?? []).includes('data:'));
  assert.ok((directives.get('style-src') ?? []).includes("'unsafe-inline'"), 'inline adjustment position styles stay usable');
});

test('native CSP allows Tauri IPC and HTTPS BYO without plaintext LAN requests', () => {
  const directives = cspDirectives();
  const connect = directives.get('connect-src') ?? [];
  for (const source of ["'self'", 'ipc:', 'http://ipc.localhost', 'https:', 'http://localhost:*', 'http://127.0.0.1:*']) {
    assert.ok(connect.includes(source), 'connection source required: ' + source);
  }
  assert.ok(!connect.includes('http:'));
  assert.ok(!connect.includes('https://*'));
  assert.ok(!connect.some((source) => /^http:\/\/\*(?::\*)?$/.test(source)));
  assert.ok(!connect.some((source) => /^http:\/\/192\.168\./.test(source)));
  assert.ok(!connect.includes('data:'));
  // CSP still permits HTTPS BYO. Consent and upload prohibition belong to request code, not CSP alone.
});

test('development hot reload is loopback-only and absent from the production CSP', () => {
  const production = cspDirectives();
  const productionConnections = production.get('connect-src') ?? [];
  assert.ok(!productionConnections.some((source) => source.startsWith('ws:') || source.startsWith('wss:')));
  const devCsp = nativeConfig.app?.security?.devCsp;
  assert.equal(typeof devCsp, 'string');
  const devConnect = devCsp.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('connect-src '))?.split(/\s+/).slice(1) ?? [];
  assert.ok(devConnect.includes('ws://localhost:*'));
  assert.ok(devConnect.includes('ws://127.0.0.1:*'));
  assert.ok(!devConnect.includes('ws:'));
  assert.ok(!devConnect.includes('ws://*'));
  assert.ok(!devConnect.includes('wss://*'));
  assert.ok(!devConnect.includes("'unsafe-eval'"));
});
