import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasColourSpace, isIdentityFraming, showsOriginalPixels } from './displayFidelity';
import { DEFAULT_EDIT } from './photoEdits';
import { DEFAULT_FRAMING } from './photoFraming';
import { createMask } from './maskTypes';

const size = { width: 6000, height: 4000 };

test('an unedited, uncropped photo shows the original pixels', () => {
  assert.equal(showsOriginalPixels(undefined, DEFAULT_FRAMING, size), true);
  assert.equal(showsOriginalPixels(DEFAULT_EDIT, DEFAULT_FRAMING, size), true);
  // Choosing the photo's own shape, or moving a full-size crop, still leaves every pixel where it is.
  assert.equal(showsOriginalPixels(DEFAULT_EDIT, { ...DEFAULT_FRAMING, ratio: 3 / 2, x: 0.2 }, size), true);
  // A mask with no adjustment in it changes nothing on screen.
  assert.equal(showsOriginalPixels({ ...DEFAULT_EDIT, masks: [createMask('radial', 'm1')] }, DEFAULT_FRAMING, size), true);
});

test('any change to the pixels shows the processed picture instead', () => {
  assert.equal(showsOriginalPixels({ ...DEFAULT_EDIT, exposure: 0.1 }, DEFAULT_FRAMING, size), false);
  assert.equal(showsOriginalPixels({ ...DEFAULT_EDIT, sharpen: 0.2 }, DEFAULT_FRAMING, size), false);
  assert.equal(showsOriginalPixels({ ...DEFAULT_EDIT, denoise: 0.5 }, DEFAULT_FRAMING, size), false);
  assert.equal(showsOriginalPixels(DEFAULT_EDIT, { ...DEFAULT_FRAMING, ratio: 1 }, size), false);
  assert.equal(showsOriginalPixels(DEFAULT_EDIT, { ...DEFAULT_FRAMING, size: 0.9 }, size), false);
  assert.equal(showsOriginalPixels(DEFAULT_EDIT, { ...DEFAULT_FRAMING, turns: 1 }, size), false);
  assert.equal(showsOriginalPixels(DEFAULT_EDIT, { ...DEFAULT_FRAMING, turns: 2 }, size), false);
  assert.equal(showsOriginalPixels(DEFAULT_EDIT, { ...DEFAULT_FRAMING, straighten: 0.5 }, size), false);
});

test('identity framing needs a real picture size', () => {
  assert.equal(isIdentityFraming(DEFAULT_FRAMING, { width: 0, height: 0 }), false);
  assert.equal(isIdentityFraming({ ...DEFAULT_FRAMING, turns: 4 }, size), true);
});

test('screen canvases use Display P3 only where both the browser and the screen can', () => {
  assert.equal(canvasColourSpace({ p3Canvas: true, wideGamutScreen: true }), 'display-p3');
  assert.equal(canvasColourSpace({ p3Canvas: true, wideGamutScreen: false }), 'srgb');
  assert.equal(canvasColourSpace({ p3Canvas: false, wideGamutScreen: true }), 'srgb');
  assert.equal(canvasColourSpace({ p3Canvas: false, wideGamutScreen: false }), 'srgb');
});
