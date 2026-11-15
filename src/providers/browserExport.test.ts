import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoShootState } from '../core/cullingEngine';
import { EXPORT_PROFILES } from '../core/exportProfiles';
import { renderExport } from './browserExport';

test('cancelling an export skips unused canvas work and discards an encoded result', async (t) => {
  const controller = new AbortController();
  const context = {
    resetTransform() {}, clearRect() {}, scale() {}, translate() {}, rotate() {}, drawImage() {},
  };
  let allocated = 0;
  let encodes = 0;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob(callback: (value: Blob) => void) {
      encodes += 1;
      controller.abort();
      callback(new Blob(['synthetic'], { type: 'image/png' }));
    },
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement() { allocated += 1; return canvas; } },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  const source = { naturalWidth: 640, naturalHeight: 480 } as HTMLImageElement;
  const frame = createDemoShootState(1).frames[0];
  const profile = EXPORT_PROFILES.find(({ id }) => id === 'master')!;
  const now = new Date();
  await assert.rejects(renderExport(source, frame, profile, now, AbortSignal.abort()), { name: 'AbortError' });
  assert.equal(allocated, 0);
  await assert.rejects(renderExport(source, frame, profile, now, controller.signal), { name: 'AbortError' });
  assert.equal(encodes, 1);
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
});
