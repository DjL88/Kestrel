import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTheme } from './themePreference';

test('Auto follows the operating system colour scheme', () => {
  assert.equal(resolveTheme('auto', true), 'dark');
  assert.equal(resolveTheme('auto', false), 'light');
});
test('explicit light/dark overrides the operating system preference', () => {
  for (const systemDark of [true, false]) {
    assert.equal(resolveTheme('light', systemDark), 'light');
    assert.equal(resolveTheme('dark', systemDark), 'dark');
  }
});
