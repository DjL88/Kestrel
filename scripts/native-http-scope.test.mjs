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
