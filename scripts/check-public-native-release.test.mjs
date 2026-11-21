import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectNativeRelease } from './check-public-native-release.mjs';

const safe = () => ({
  config: { app: { security: { csp: "default-src 'self'; object-src 'none'" } }, bundle: { createUpdaterArtifacts: false } },
  caps: { permissions: ['core:default','dialog:allow-open','fs:allow-appdata-read-recursive'] },
});

test('public gate accepts narrowly scoped static baseline', () => {
  const {config,caps} = safe();
  assert.deepEqual(inspectNativeRelease(config,caps), []);
});
test('public gate rejects null CSP and unrestricted network/file privileges', () => {
  const {config,caps} = safe();
  config.app.security.csp = null;
  caps.permissions.push('fs:allow-remove', {identifier:'http:default',allow:[{url:'https://*'},{url:'http://*:*'}]});
  const failures = inspectNativeRelease(config,caps).join('\n');
  assert.match(failures,/CSP is unset/);
  assert.match(failures,/Unscoped filesystem/);
  assert.match(failures,/Unrestricted native HTTP/);
  assert.match(failures,/Plain HTTP/);
});
test('explicit NAS HTTP exception still needs manual security review', () => {
  const {config,caps} = safe();
  caps.permissions.push({identifier:'http:default',allow:[{url:'http://192.168.1.20:5005'}]});
  assert.match(inspectNativeRelease(config,caps).join('\n'),/LAN\/NAS threat review/);
});
