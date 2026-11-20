import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseExportDestination, exportDestinationFormats } from './exportWizardChoice';
import { EXPORT_FORMATS } from './exportFormats';

test('one-size destinations go straight to review without an empty size step', () => {
  for (const id of ['master', 'full-jpeg', 'before-after']) {
    assert.deepEqual(chooseExportDestination(id), { selectedFormat: id, page: 'review' }, id);
    assert.deepEqual(exportDestinationFormats(id).map(format => format.id), [id]);
  }
});

test('social destinations with several sizes still offer the size selector', () => {
  assert.deepEqual(chooseExportDestination('instagram'), { selectedFormat: null, page: 'size' });
  assert.deepEqual(chooseExportDestination('facebook'), { selectedFormat: null, page: 'size' });
  assert.equal(exportDestinationFormats('instagram').length >= 2, true);
});

test('custom size stays editable rather than choosing a phantom format', () => {
  assert.deepEqual(chooseExportDestination('custom'), { selectedFormat: null, page: 'size' });
  assert.deepEqual(exportDestinationFormats('custom'), []);
});

test('a future single fixed-shape social format chooses an editable crop first', () => {
  const lone = [{ ...EXPORT_FORMATS.find(format => format.id === 'ig-45')!, platform: 'instagram' as const }];
  assert.deepEqual(chooseExportDestination('instagram', lone), { selectedFormat: 'ig-45', page: 'position' });
});

test('an arbitrary or missing destination never silently submits', () => {
  assert.deepEqual(chooseExportDestination('unknown'), { selectedFormat: null, page: 'size' });
  assert.deepEqual(chooseExportDestination('master', []), { selectedFormat: null, page: 'size' });
});
