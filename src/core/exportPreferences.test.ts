import assert from 'node:assert/strict';
import test from 'node:test';
import { readExportPreferences } from './exportPreferences';

test('restores supported export options and discards invalid values', () => {
  const options = readExportPreferences({ getItem: () => JSON.stringify({
    fits: { master: 'keep', unknown: 'fill' },
    overrides: { master: { prefix: 'bird_', quality: 2 } },
    turned: { master: true }, bars: 'blur',
  }) });
  assert.deepEqual(options, {
    fits: { master: 'keep' }, overrides: { master: { prefix: 'bird_' } },
    turned: { master: true }, bars: 'blur',
  });
});

test('broken storage leaves export defaults available', () => {
  assert.equal(readExportPreferences({ getItem: () => '{' }).bars, 'white');
});
