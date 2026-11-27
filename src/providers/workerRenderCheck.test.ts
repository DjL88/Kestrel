import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECK_EDIT, checkPicture, samePixels } from './workerRenderCheck';
import { isNeutralEdit } from '../core/photoEdits';

test('the check picture is the same every time, and the check edit exercises tone, detail and an early stage', () => {
  assert.ok(samePixels(checkPicture(), checkPicture()));
  assert.equal(checkPicture(192, 128).length, 192 * 128 * 4);
  assert.equal(isNeutralEdit(CHECK_EDIT), false);
  for (const key of ['exposure', 'contrast', 'clarity', 'sharpen', 'dehaze'] as const) assert.ok(CHECK_EDIT[key], key);
});

test('pixels are the same only when every byte is: a single level of difference means the page draws instead', () => {
  const a = checkPicture();
  const b = a.slice();
  assert.equal(samePixels(a, b), true);
  b[1234] = b[1234] === 255 ? 254 : b[1234] + 1;
  assert.equal(samePixels(a, b), false);
  assert.equal(samePixels(a, null), false);
  assert.equal(samePixels(a, a.slice(0, -4)), false);
});
