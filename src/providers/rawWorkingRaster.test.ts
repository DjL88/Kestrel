import { describe, it, expect } from 'vitest';
import { acceptSensorRgb16 } from './rawWorkingRaster';

function rgb16(width: number, height: number, samples: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(8 + samples.length * 2);
  const view = new DataView(buffer);
  view.setUint32(0, width, true);
  view.setUint32(4, height, true);
  samples.forEach((value, index) => view.setUint16(8 + index * 2, value, true));
  return buffer;
}
describe('sensor working raster safety', () => {
  it('retains intermediate 16-bit samples without JPEG quantisation', () => {
    const out = acceptSensorRgb16(rgb16(2, 1, [1, 256, 32769, 65534, 42, 8193]));
    expect([...out.image.data]).toEqual([1, 256, 32769, 65534, 42, 8193]);
    expect(out.allocatedBytes).toBe(20);
    expect(out.provenance.encoding).toBe('display-srgb');
    expect(out.provenance.iccVerified).toBe(false);
    expect(out.provenance.sceneLinear).toBe(false);
    expect(out.provenance.previewExportParityVerified).toBe(false);
  });
  it('rejects truncated pixels, trailing bytes and hostile dimensions', () => {
    expect(() => acceptSensorRgb16(rgb16(2, 1, [1, 2, 3]))).toThrow();
    expect(() => acceptSensorRgb16(rgb16(1, 1, [1, 2, 3, 4]))).toThrow();
    expect(() => acceptSensorRgb16(rgb16(2, 1, [1, 2, 3, 4, 5, 6]), 1)).toThrow();
  });
  it('rejects invalid memory limits and empty images', () => {
    expect(() => acceptSensorRgb16(new ArrayBuffer(0))).toThrow();
    expect(() => acceptSensorRgb16(rgb16(1, 1, [1, 2, 3]), Number.NaN)).toThrow();
    expect(() => acceptSensorRgb16(rgb16(1, 1, [1, 2, 3]), 100_000_000)).toThrow();
  });
});
