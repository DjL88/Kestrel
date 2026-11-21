import assert from 'node:assert/strict';
import test from 'node:test';
import { signInOptions } from './signInOptions.ts';

test('Google and Apple are always offered together', () => {
  for (const platform of ['web', 'desktop', 'ios', 'android'] as const) {
    assert.deepEqual(signInOptions(platform, true).map((o) => o.provider), ['google', 'apple']);
  }
});

test('sign-in is available only on the configured web build, and says why otherwise', () => {
  assert.ok(signInOptions('web', true).every((o) => o.available && !o.reason));
  assert.match(signInOptions('web', false)[0]!.reason!, /not set up/);
  assert.match(signInOptions('desktop', true)[0]!.reason!, /not built yet/);
});
