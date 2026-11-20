import assert from 'node:assert/strict';
import test from 'node:test';
import { canShowNeutralRaster } from './neutralRasterDisplay';
import { DEFAULT_EDIT } from './photoEdits';
import { DEFAULT_FRAMING } from './photoFraming';

test('neutral unframed photos can bypass the preview canvas', () => {
  assert.equal(canShowNeutralRaster(DEFAULT_EDIT, DEFAULT_FRAMING), true);
});

test('tone, detail and framing changes still require the rendered preview', () => {
  for (const edit of [{ exposure: 0.1 }, { denoise: 1 }, { sharpen: 1 }]) {
    assert.equal(canShowNeutralRaster({ ...DEFAULT_EDIT, ...edit }, DEFAULT_FRAMING), false);
  }
  for (const framing of [{ ratio: 1 }, { turns: 1 }, { straighten: 1 }, { x: 0.6 }, { size: 0.9 }]) {
    assert.equal(canShowNeutralRaster(DEFAULT_EDIT, { ...DEFAULT_FRAMING, ...framing }), false);
  }
});
