import assert from 'node:assert/strict';
import { test } from 'node:test';
import { logoToneFor } from './brandLogo';

test('logos follow the theme: light files only on a light theme, dark on every dark theme and when nothing is set', () => {
  assert.equal(logoToneFor('light'), 'light');
  for (const theme of ['default', 'night', 'contrast', undefined, '']) assert.equal(logoToneFor(theme), 'dark');
});
