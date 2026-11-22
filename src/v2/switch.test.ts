import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveV2Switch } from './switch.ts';

test('the v2 switch is off by default, on with ?v2, remembered, and off with ?v2=0', () => {
  assert.deepEqual(resolveV2Switch('', null), { enabled: false, remember: null });
  assert.deepEqual(resolveV2Switch('?v2', null), { enabled: true, remember: 'on' });
  assert.deepEqual(resolveV2Switch('?v2=1', null), { enabled: true, remember: 'on' });
  assert.deepEqual(resolveV2Switch('', 'on'), { enabled: true, remember: null });
  assert.deepEqual(resolveV2Switch('?v2=0', 'on'), { enabled: false, remember: 'off' });
});
