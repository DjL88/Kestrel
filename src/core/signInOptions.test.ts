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

test('configured native users are told about the email alternative without claiming native OAuth works', () => {
  for (const platform of ['desktop', 'ios', 'android'] as const) {
    assert.ok(signInOptions(platform, true).every((o) => !o.available && o.reason?.includes('email and password')));
  }
});

test('the desktop app offers each provider through the browser when the build has what it needs, and says why not otherwise', () => {
  const [google, apple] = signInOptions('desktop', true, true);
  assert.equal(google!.available, true);
  assert.equal(google!.reason, undefined);
  assert.equal(apple!.available, false);
  assert.match(apple!.reason!, /Apple sign-in is not set up in this build/);
  assert.ok(signInOptions('desktop', true, true, true).every((o) => o.available && !o.reason));
  const [googleOff, appleOn] = signInOptions('desktop', true, false, true);
  assert.equal(appleOn!.available, true);
  assert.match(googleOff!.reason!, /Google sign-in is not set up in this build/);
  assert.ok(signInOptions('android', true, true, true).every((o) => !o.available));
  assert.ok(signInOptions('ios', true, true).every((o) => !o.available));
  assert.ok(signInOptions('desktop', false, true).every((o) => !o.available && /not set up/.test(o.reason!)));
});
