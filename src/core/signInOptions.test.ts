import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceFamily, signInOptions, suggestedSignIn } from './signInOptions.ts';

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

test('Microsoft is offered only when the build switches it on, and only on the web for now', () => {
  assert.deepEqual(signInOptions('web', true, false, false, true).map((o) => o.provider), ['google', 'apple', 'microsoft']);
  assert.ok(signInOptions('web', true, false, false, true).every((o) => o.available));
  const desktopMs = signInOptions('desktop', true, true, true, true).find((o) => o.provider === 'microsoft')!;
  assert.equal(desktopMs.available, false);
  assert.match(desktopMs.reason!, /web version/);
  assert.match(signInOptions('web', false, false, false, true)[2]!.reason!, /not set up/);
});

test('the desktop app offers Microsoft through the browser only when its own flag is on', () => {
  const off = signInOptions('desktop', true, true, true, true, false).find((o) => o.provider === 'microsoft')!;
  assert.equal(off.available, false);
  const on = signInOptions('desktop', true, true, true, true, true).find((o) => o.provider === 'microsoft')!;
  assert.equal(on.available, true);
  assert.equal(on.reason, undefined);
  // The desktop flag never switches Microsoft on by itself, nor on the phone apps.
  assert.ok(!signInOptions('desktop', true, true, true, false, true).some((o) => o.provider === 'microsoft'));
  assert.equal(signInOptions('android', true, true, true, true, true).find((o) => o.provider === 'microsoft')!.available, false);
  assert.equal(suggestedSignIn(signInOptions('desktop', true, true, true, true, true), 'windows').suggested!.provider, 'microsoft');
});

test('each device suggests its own sign-in first and keeps the rest under other', () => {
  const web = signInOptions('web', true, false, false, true);
  assert.equal(suggestedSignIn(web, 'windows').suggested!.provider, 'microsoft');
  assert.equal(suggestedSignIn(web, 'android').suggested!.provider, 'google');
  assert.equal(suggestedSignIn(web, 'apple').suggested!.provider, 'apple');
  const { suggested, other } = suggestedSignIn(web, 'windows');
  assert.deepEqual(other.map((o) => o.provider), ['google', 'apple']);
  assert.ok(!other.includes(suggested!));
  // Windows desktop app: Microsoft cannot open there yet, so the first working one is suggested and Microsoft stays listed.
  const desktop = suggestedSignIn(signInOptions('desktop', true, true, true, true), 'windows');
  assert.equal(desktop.suggested!.provider, 'google');
  assert.ok(desktop.other.some((o) => o.provider === 'microsoft' && !o.available));
  // Without Microsoft switched on, Windows falls back to Google.
  assert.equal(suggestedSignIn(signInOptions('web', true), 'windows').suggested!.provider, 'google');
  assert.equal(suggestedSignIn(signInOptions('web', false), 'apple').suggested, null);
});

test('device family comes from the user agent', () => {
  assert.equal(deviceFamily('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'windows');
  assert.equal(deviceFamily('Mozilla/5.0 (Linux; Android 14; Pixel 8)'), 'android');
  assert.equal(deviceFamily('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)'), 'apple');
  assert.equal(deviceFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'apple');
  assert.equal(deviceFamily('Mozilla/5.0 (X11; Linux x86_64)'), 'other');
});
