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
