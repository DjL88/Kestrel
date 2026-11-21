import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTheme } from './theme';

test('known themes are accepted and unknown values use softer night default', () => {
  assert.equal(parseTheme('night'), 'night');
  assert.equal(parseTheme('contrast'), 'contrast');
  assert.equal(parseTheme('default'), 'default');
  assert.equal(parseTheme('neon'), 'night');
  assert.equal(parseTheme(null), 'night');
  assert.equal(parseTheme(undefined), 'night');
});

import { parseDisplay, DEFAULT_DISPLAY, CALM_AND_CLEAR, isCalmAndClear } from './theme';

test('display settings validate every field and fall back safely', () => {
  assert.deepEqual(parseDisplay(undefined), DEFAULT_DISPLAY);
  assert.deepEqual(parseDisplay({ theme: 'night', textSize: '150', font: 'readable', calm: true, spacing: 'roomy' }),
    { theme: 'night', textSize: '150', font: 'readable', calm: true, spacing: 'roomy' });
  assert.deepEqual(parseDisplay({ theme: 'x', textSize: '999', font: 'comic', calm: 'yes' }), DEFAULT_DISPLAY);
});

test('older saved settings without spacing still load, with standard spacing', () => {
  assert.equal(parseDisplay({ theme: 'night', textSize: '125', font: 'readable', calm: true }).spacing, 'normal');
  assert.equal(parseDisplay({ spacing: 'huge' }).spacing, 'normal');
});

test('Calm and clear is recognised only when every part of it is on', () => {
  assert.equal(isCalmAndClear(CALM_AND_CLEAR), true);
  assert.equal(isCalmAndClear(DEFAULT_DISPLAY), false);
  assert.equal(isCalmAndClear({ ...CALM_AND_CLEAR, textSize: '150' }), false, 'changing one part leaves the preset');
  assert.equal(isCalmAndClear({ ...CALM_AND_CLEAR, spacing: 'normal' }), false);
});
