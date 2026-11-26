import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopReleasePlatform, newerRelease } from './desktopRelease';

test('only a newer stable version produces a release notice', () => {
  assert.equal(newerRelease('v26.11.3', '26.11.2'), true);
  assert.equal(newerRelease('26.12.0', '26.11.999'), true);
  assert.equal(newerRelease('v26.11.2', '26.11.2'), false);
  assert.equal(newerRelease('26.11.1', '26.11.2'), false);
  assert.equal(newerRelease('26.11.2-beta.1', '26.11.1'), false);
  assert.equal(newerRelease('not a version', '26.11.1'), false);
});

test('phone and iPad store builds never receive a desktop release banner', () => {
  assert.equal(desktopReleasePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'macos');
  assert.equal(desktopReleasePlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'windows');
  assert.equal(desktopReleasePlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)'), null);
  assert.equal(desktopReleasePlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)'), null);
  assert.equal(desktopReleasePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15', 5), null);
  assert.equal(desktopReleasePlatform('Mozilla/5.0 (X11; Linux x86_64)'), null);
});
