import { describe, expect, it } from 'vitest';
import { verifiedNikonSensorMode } from './rawDevelop';

describe('verified Nikon precision preflight', () => {
  const file = new Blob([new Uint8Array(32)]);
  it('accepts only an explicitly classified ordinary mode', async () => {
    expect(await verifiedNikonSensorMode(file, async () => 'other')).toBe('other');
  });
  it('preserves HE/HE* classification for licensing gate', async () => {
    expect(await verifiedNikonSensorMode(file, async () => 'nikon-he')).toBe('nikon-he');
    expect(await verifiedNikonSensorMode(file, async () => 'nikon-he-star')).toBe('nikon-he-star');
  });
  it('fails closed on unavailable, malformed or incomplete classification', async () => {
    expect(await verifiedNikonSensorMode(file, async () => 'need-more')).toBe('unknown');
    expect(await verifiedNikonSensorMode(file, async () => 'bad-mode')).toBe('unknown');
    expect(await verifiedNikonSensorMode(file, async () => { throw new Error('decoder unavailable'); })).toBe('unknown');
    expect(await verifiedNikonSensorMode(new Blob([]), async () => 'other')).toBe('unknown');
  });
});
