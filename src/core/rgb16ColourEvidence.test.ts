import { describe, it, expect } from 'vitest';
import { measureRgb16Region, compareRgb16Region, type Rgb16ColourSource } from './rgb16ColourEvidence';
const frame = (pixels: number[], colourSpace: Rgb16ColourSource['colourSpace'] = 'verified-srgb'): Rgb16ColourSource =>
  ({ width: pixels.length / 3, height: 1, data: Uint16Array.from(pixels), colourSpace });
const region = (width: number) => ({ x: 0, y: 0, width, height: 1 });
describe('RGB16 photographic colour evidence', () => {
  it('refuses unverified camera ICC/profile, never calls it measured', () => {
    expect(measureRgb16Region(frame([32768,32768,32768], 'unverified'), region(1)).status).toBe('unknown');
  });
  it('distinguishes true 16-bit middle values from clipping', () => {
    const result = measureRgb16Region(frame([32769,32769,32769]), region(1));
    expect(result.status).toBe('measured');
    expect(result.clippedPixelFraction).toBe(0);
    expect(result.meanHueDegrees).toBeNull();
    expect(result.meanLinearLuminance).toBeGreaterThan(0.21);
  });
  it('measures bright clipped sky without claiming its colour is wrong', () => {
    const result = measureRgb16Region(frame([65535,65535,45000]), region(1));
    expect(result.clippedChannelFraction).toBeCloseTo(2 / 3);
    expect(result.clippedPixelFraction).toBe(1);
  });
  it('reports green foliage and orange plumage as measurements only', () => {
    const foliage = measureRgb16Region(frame([10000,42000,12000]), region(1));
    const plumage = measureRgb16Region(frame([45000,23000,8000]), region(1));
    expect(foliage.meanHueDegrees).toBeGreaterThan(90);
    expect(plumage.meanHueDegrees).toBeLessThan(90);
  });
  it('compares unchanged pixels exactly, without double encoding', () => {
    const original = frame([12345,34567,23456, 65535,40000,20000]);
    const result = compareRgb16Region(original, original, region(2));
    expect(result.status).toBe('measured');
    if (result.status === 'measured') {
      expect(result.luminanceDelta).toBe(0);
      expect(result.chromaDelta).toBe(0);
      expect(result.clippedPixelFractionDelta).toBe(0);
    }
  });
  it('refuses mismatched geometry and malformed regions', () => {
    expect(compareRgb16Region(frame([1,2,3]), frame([1,2,3,4,5,6]), region(1)).status).toBe('unknown');
    expect(measureRgb16Region(frame([1,2,3]), {x:0,y:0,width:2,height:1}).status).toBe('unknown');
  });
});
