import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveV2Switch } from './switch.ts';

test('V2 is on by default, ?v2=0 opens the previous app and is remembered, ?v2 switches back', () => {
  assert.deepEqual(resolveV2Switch('', null), { enabled: true, remember: null });
  assert.deepEqual(resolveV2Switch('', 'off'), { enabled: false, remember: null });
  assert.deepEqual(resolveV2Switch('?v2', null), { enabled: true, remember: 'on' });
  assert.deepEqual(resolveV2Switch('?v2=1', null), { enabled: true, remember: 'on' });
  assert.deepEqual(resolveV2Switch('', 'on'), { enabled: true, remember: null });
  assert.deepEqual(resolveV2Switch('?v2=0', 'on'), { enabled: false, remember: 'off' });
});
