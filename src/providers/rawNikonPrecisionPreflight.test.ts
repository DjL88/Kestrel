import { describe } from 'node:test';
import { expect, it } from '../core/testExpect';
import { precisionModeRefusal, verifiedNikonSensorMode } from './rawDevelop';

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
  it('lets HE and HE* through to the 16-bit develop (owner decision, 25 Nov 2026) and refuses only an unread compression', () => {
    expect(precisionModeRefusal('other')).toBe(null);
    expect(precisionModeRefusal('nikon-he')).toBe(null);
    expect(precisionModeRefusal('nikon-he-star')).toBe(null);
    expect(precisionModeRefusal('unknown')).toBe('Nikon RAW compression could not be verified; no precision export was made.');
  });
});
