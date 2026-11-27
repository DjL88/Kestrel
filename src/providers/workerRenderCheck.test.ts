import assert from 'node:assert/strict';
import test from 'node:test';
import { samePixels } from './workerRenderCheck';

const picture = () => Uint8ClampedArray.from({ length: 192 * 128 * 4 }, (_, i) => (i * 37) % 251);

test('pixels are the same only when every byte is: a single level of difference means the page draws instead', () => {
  const a = picture();
  const b = a.slice();
  assert.equal(samePixels(a, b), true);
  b[1234] = b[1234] === 255 ? 254 : b[1234] + 1;
  assert.equal(samePixels(a, b), false);
  assert.equal(samePixels(a, null), false);
  assert.equal(samePixels(a, a.slice(0, -4)), false);
});

test('an edit\'s signature names the settings it uses, not their values', async () => {
  const { renderSignature } = await import('./workerRenderCheck');
  const a = renderSignature({ exposure: 0.4, warmth: 0, colour: -0.1, contrast: 0.2 } as never);
  assert.equal(a, renderSignature({ exposure: -1, warmth: 0, colour: 0.3, contrast: 0.05 } as never));
  assert.notEqual(a, renderSignature({ exposure: 0.4, warmth: 0, colour: -0.1, contrast: 0.2, dehaze: 0.2 } as never), 'a new part of the maths is a new signature');
  assert.equal(renderSignature({ exposure: 0, warmth: 0, colour: 0, masks: [] } as never), '', 'neutral settings and empty lists do not count');
});

test('the worker is trusted with a kind of edit only after it matched, and a mismatch is never overturned', async () => {
  const { recordWorkerVerdict, workerVerdict } = await import('./workerRenderCheck');
  assert.equal(workerVerdict('contrast,exposure,test-a'), undefined);
  recordWorkerVerdict('contrast,exposure,test-a', true);
  assert.equal(workerVerdict('contrast,exposure,test-a'), true);
  recordWorkerVerdict('dehaze,test-b', false);
  recordWorkerVerdict('dehaze,test-b', true);
  assert.equal(workerVerdict('dehaze,test-b'), false);
});
