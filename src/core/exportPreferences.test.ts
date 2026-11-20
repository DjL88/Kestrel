import assert from 'node:assert/strict';
import test from 'node:test';
import { readExportPreferences, readExportPresets } from './exportPreferences';

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

test('named presets retain unique standard formats and discard duplicate names', () => {
  const presets = readExportPresets({ getItem: () => JSON.stringify([
    { name: ' Delivery ', formats: ['master', 'unknown', 'master'], overrides: { master: { quality: 0.9 } } },
    { name: 'delivery', formats: ['master'] },
    { name: 'Invalid', formats: ['unknown'] },
  ]) });
  assert.equal(presets.length, 1);
  assert.equal(presets[0].name, 'Delivery');
  assert.deepEqual(presets[0].formats, ['master']);
  assert.equal(presets[0].overrides.master.quality, 0.9);
});
