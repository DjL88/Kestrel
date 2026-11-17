import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRawExtension } from './rawDevelop';

test('accepts Nikon and other native RAW extensions case-insensitively', () => {
  for (const extension of ['NEF', 'nrw', 'Cr3', 'arw', 'raf', 'dng', 'orf', 'rw2', 'pef', 'srw', '3fr']) {
    assert.equal(validateRawExtension(extension), extension.toLowerCase());
  }
});

test('rejects unsupported and path-like extensions rather than treating them as NEF', () => {
  for (const extension of ['', 'jpg', 'jpeg', 'tiff', 'unknown', '../nef', 'nef/../../tmp', '.nef', 'nef\\\\', 'n-e-f', 'nef\\u0000']) {
    assert.throws(() => validateRawExtension(extension), /not supported/);
  }
});

test('rejects misleadingly long suffixes rather than truncating them', () => {
  for (const extension of ['nefgarbage', 'cr3backup', 'NEF.jpeg']) {
    assert.throws(() => validateRawExtension(extension), /not supported/);
  }
});
