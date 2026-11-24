import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceWatermarkIfUnchanged } from './watermarkMutation.ts';

const before = { id: 'one', label: 'First', forDark: 'a' };
const after = { ...before, forLight: 'b' };
const other = { id: 'two', label: 'Second', forDark: 'c' };
test('a completed edit preserves a watermark imported while it was running', () => {
  assert.deepEqual(replaceWatermarkIfUnchanged([before, other], before, after), [after, other]);
});
test('a completed edit cannot revive a deleted watermark or overwrite a newer edit', () => {
  const deleted = [other];
  assert.equal(replaceWatermarkIfUnchanged(deleted, before, after), deleted);
  const changed = [{ ...before, forDark: 'new' }, other];
  assert.equal(replaceWatermarkIfUnchanged(changed, before, after), changed);
});
