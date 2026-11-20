import test from 'node:test';
import { expect } from './testExpect';
import { canvasColourSpace } from './canvasColourSpace';

test('screen canvases use Display P3 only where both the browser and the screen can', () => {
  expect(canvasColourSpace({ p3Canvas: true, wideGamutScreen: true })).toBe('display-p3');
  expect(canvasColourSpace({ p3Canvas: true, wideGamutScreen: false })).toBe('srgb');
  expect(canvasColourSpace({ p3Canvas: false, wideGamutScreen: true })).toBe('srgb');
  expect(canvasColourSpace({ p3Canvas: false, wideGamutScreen: false })).toBe('srgb');
});
