import assert from 'node:assert/strict';
import test from 'node:test';
import { detectRuntime, originalAccessPolicy } from './runtimeStoragePolicy';

test('Tauri desktop wins over a browser-like or mobile user agent', () => {
  assert.equal(detectRuntime({ tauri: true, tauriPlatform: 'windows', mobileUserAgent: true }), 'desktop');
  assert.equal(detectRuntime({ tauri: true, tauriPlatform: 'macos' }), 'desktop');
  assert.equal(detectRuntime({ tauri: true }), 'desktop');
});
test('native Android and iOS use mobile capabilities', () => {
  assert.equal(detectRuntime({ tauri: true, tauriPlatform: 'android' }), 'mobile');
  assert.equal(detectRuntime({ tauri: true, tauriPlatform: 'ios' }), 'mobile');
  assert.equal(detectRuntime({ tauri: false, mobileUserAgent: true }), 'mobile');
  assert.equal(detectRuntime({ tauri: false }), 'browser');
});
test('desktop local and NAS originals are linked in place, never uploaded', () => {
  for (const location of ['local', 'network'] as const) {
    assert.deepEqual(originalAccessPolicy('desktop', location), {
      mode: 'native-path', retainOriginalInPlace: true, automaticUpload: false,
      canRetrySavedPath: true, requiresUserGrant: false,
    });
  }
});
test('browser and mobile require explicit access grants', () => {
  for (const runtime of ['browser', 'mobile'] as const) {
    for (const location of ['local', 'network'] as const) {
      const policy = originalAccessPolicy(runtime, location);
      assert.equal(policy.mode, 'user-granted-file');
      assert.equal(policy.requiresUserGrant, true);
      assert.equal(policy.automaticUpload, false);
      assert.equal(policy.canRetrySavedPath, false);
    }
  }
});
test('remote originals always require explicit connection and never upload silently', () => {
  for (const runtime of ['desktop', 'mobile', 'browser'] as const) {
    const policy = originalAccessPolicy(runtime, 'remote');
    assert.equal(policy.mode, 'explicit-remote');
    assert.equal(policy.automaticUpload, false);
    assert.equal(policy.requiresUserGrant, true);
  }
});
