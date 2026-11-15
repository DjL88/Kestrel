import assert from 'node:assert/strict';
import test from 'node:test';
import { isSupportedPhotoFilename } from '../providers/localShootLoader';

test('Nikon NRW and NEF are accepted for both file and folder import filtering', () => {
  for (const name of ['DSC_0001.NRW', 'DSC_0002.nrw', 'Z8_0001.NEF', 'Z5II_0002.nef']) {
    assert.equal(isSupportedPhotoFilename(name), true, name);
  }
});

test('unsupported and deceptive filenames remain excluded', () => {
  for (const name of ['DSC_0001.NRW.exe', 'DSC_0001', '.nrw.bak', 'DSC_0001.cr3']) {
    assert.equal(isSupportedPhotoFilename(name), false, name);
  }
});
