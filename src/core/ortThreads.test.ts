import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ORT_SINGLE_THREAD, ortPlanFor, ortThreadCount, readOrtPlan, type OrtHost } from './ortThreads.ts';

const desktop = (over: Partial<OrtHost> = {}): OrtHost => ({ desktop: true, isolated: true, cores: 8, ...over });

describe('ortThreadCount', () => {
  it('keeps today\'s single thread on the web and on phones, isolated or not', () => {
    assert.equal(ortThreadCount({ desktop: false, isolated: false, cores: 16 }), 1);
    assert.equal(ortThreadCount({ desktop: false, isolated: true, cores: 16 }), 1);
  });

  it('keeps one thread on a desktop that lost its isolation headers (dev server, older WebView)', () => {
    assert.equal(ortThreadCount(desktop({ isolated: false })), 1);
  });

  it('gives the isolated desktop app 2 to 4 threads, leaving a core for the interface', () => {
    assert.equal(ortThreadCount(desktop({ cores: 2 })), 1);
    assert.equal(ortThreadCount(desktop({ cores: 3 })), 2);
    assert.equal(ortThreadCount(desktop({ cores: 4 })), 3);
    assert.equal(ortThreadCount(desktop({ cores: 8 })), 4);
    assert.equal(ortThreadCount(desktop({ cores: 32 })), 4);
  });

  it('shares the spare cores between workers so they never oversubscribe the CPU', () => {
    assert.equal(ortThreadCount(desktop({ cores: 8 }), 4), 1);
    assert.equal(ortThreadCount(desktop({ cores: 8 }), 2), 3);
    assert.equal(ortThreadCount(desktop({ cores: 16 }), 2), 4);
    assert.equal(ortThreadCount(desktop({ cores: 2 }), 4), 1);
  });

  it('treats an unknown core count as two cores', () => {
    assert.equal(ortThreadCount(desktop({ cores: Number.NaN })), 1);
    assert.equal(ortThreadCount(desktop({ cores: 0 })), 1);
  });
});

describe('ortPlanFor', () => {
  it('tries WebGPU only on the isolated desktop app with a GPU and the preview switch on, and always falls back to the CPU', () => {
    assert.deepEqual(ortPlanFor(desktop({ webgpu: true, webgpuPreview: true })).executionProviders, ['webgpu', 'wasm']);
    assert.deepEqual(ortPlanFor(desktop({ webgpu: true, webgpuPreview: false })).executionProviders, ['wasm']);
    assert.deepEqual(ortPlanFor(desktop({ webgpu: false, webgpuPreview: true })).executionProviders, ['wasm']);
    assert.deepEqual(ortPlanFor(desktop({ isolated: false, webgpu: true, webgpuPreview: true })).executionProviders, ['wasm']);
    assert.deepEqual(ortPlanFor({ desktop: false, isolated: true, cores: 8, webgpu: true, webgpuPreview: true }), ORT_SINGLE_THREAD);
  });
});

describe('readOrtPlan', () => {
  it('falls back to one CPU thread for a missing or odd plan from the page', () => {
    assert.deepEqual(readOrtPlan(undefined), ORT_SINGLE_THREAD);
    assert.deepEqual(readOrtPlan('fast'), ORT_SINGLE_THREAD);
    assert.deepEqual(readOrtPlan({ threads: 2.5 }), ORT_SINGLE_THREAD);
    assert.deepEqual(readOrtPlan({ threads: 64, executionProviders: ['cuda'] }), { threads: 4, executionProviders: ['wasm'] });
    assert.deepEqual(readOrtPlan({ threads: 3, executionProviders: ['webgpu', 'wasm'] }), { threads: 3, executionProviders: ['webgpu', 'wasm'] });
  });
});

describe('desktop app headers', () => {
  const read = (name: string) => JSON.parse(readFileSync(new URL(`../../src-tauri/${name}`, import.meta.url), 'utf8'));
  it('serves the desktop app cross-origin isolated, so SharedArrayBuffer and WebAssembly threads exist', () => {
    assert.deepEqual(read('tauri.conf.json').app.security.headers, {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
  });
  it('leaves the phone apps as they were (the merge removes the headers there)', () => {
    assert.equal(read('tauri.android.conf.json').app.security.headers, null);
    assert.equal(read('tauri.ios.conf.json').app.security.headers, null);
  });
});
