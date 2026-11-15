import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTheme } from './theme';

test('known themes are accepted and anything else falls back to default', () => {
  assert.equal(parseTheme('night'), 'night');
  assert.equal(parseTheme('contrast'), 'contrast');
  assert.equal(parseTheme('default'), 'default');
  assert.equal(parseTheme('neon'), 'default');
  assert.equal(parseTheme(null), 'default');
  assert.equal(parseTheme(undefined), 'default');
});

import { parseDisplay, DEFAULT_DISPLAY } from './theme';

test('display settings validate every field and fall back safely', () => {
  assert.deepEqual(parseDisplay(undefined), DEFAULT_DISPLAY);
  assert.deepEqual(parseDisplay({ theme: 'night', textSize: '150', font: 'readable', calm: true }),
    { theme: 'night', textSize: '150', font: 'readable', calm: true });
  assert.deepEqual(parseDisplay({ theme: 'x', textSize: '999', font: 'comic', calm: 'yes' }), DEFAULT_DISPLAY);
});
