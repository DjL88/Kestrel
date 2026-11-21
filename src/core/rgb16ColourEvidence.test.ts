import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { measureRgb16Region, compareRgb16Region, type Rgb16ColourSource } from './rgb16ColourEvidence';

const frame = (pixels: number[], colourSpace: Rgb16ColourSource['colourSpace'] = 'verified-srgb'): Rgb16ColourSource =>
  ({ width: pixels.length / 3, height: 1, data: Uint16Array.from(pixels), colourSpace });
const region = (width: number) => ({ x: 0, y: 0, width, height: 1 });

describe('RGB16 photographic colour evidence (no camera-colour claims)', () => {
  it('refuses unverified camera ICC/profile', () => {
    assert.equal(measureRgb16Region(frame([32768,32768,32768], 'unverified'), region(1)).status, 'unknown');
  });
  it('preserves sub-8-bit middle values without clipping', () => {
    const result = measureRgb16Region(frame([32769,32769,32769]), region(1));
    assert.equal(result.status, 'measured');
    assert.equal(result.clippedPixelFraction, 0);
    assert.equal(result.meanHueDegrees, null);
    assert.ok(result.meanLinearLuminance > 0.21);
  });
  it('reports clipped channels as measurements, not wrong colours', () => {
    const result = measureRgb16Region(frame([65535,65535,45000]), region(1));
    assert.ok(Math.abs(result.clippedChannelFraction - 2/3) < 1e-9);
    assert.equal(result.clippedPixelFraction, 1);
  });
  it('measures plausible foliage and plumage hues as relative values only', () => {
    const foliage = measureRgb16Region(frame([10000,42000,12000]), region(1));
    const plumage = measureRgb16Region(frame([45000,23000,8000]), region(1));
    assert.ok(foliage.meanHueDegrees !== null && foliage.meanHueDegrees > 90);
    assert.ok(plumage.meanHueDegrees !== null && plumage.meanHueDegrees < 90);
  });
  it('unchanged working pixels compare with zero measured deltas', () => {
    const source = frame([12345,34567,23456,65535,40000,20000]);
    const result = compareRgb16Region(source, source, region(2));
    assert.equal(result.status, 'measured');
    if (result.status === 'measured') {
      assert.equal(result.luminanceDelta, 0);
      assert.equal(result.chromaDelta, 0);
      assert.equal(result.clippedPixelFractionDelta, 0);
    }
  });
  it('refuses mismatched geometry and malformed regions', () => {
    assert.equal(compareRgb16Region(frame([1,2,3]), frame([1,2,3,4,5,6]), region(1)).status, 'unknown');
    assert.equal(measureRgb16Region(frame([1,2,3]), {x:0,y:0,width:2,height:1}).status, 'unknown');
  });
});
