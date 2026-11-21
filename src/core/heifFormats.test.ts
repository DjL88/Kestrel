import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { expect } from './testExpect.ts';
import { readHeifExif } from './heifExif.ts';
import { HEIF_EXTENSIONS, PHOTO_ACCEPT, PHOTO_EXTENSIONS, RAW_ACCEPT, heifFormatLabel, isHeifFile, isRawPreviewFile, looksLikeHeif } from './rawFormats.ts';
import { isSupportedPhotoFilename } from '../providers/localShootLoader.ts';

// tests/fixtures/make_heic_fixture.py: wholly synthetic, 96 x 64, EXIF from a made-up "Kestrel Test" camera.
const FIXTURE = new Uint8Array(readFileSync(new URL('../../tests/fixtures/synthetic-heic.heic', import.meta.url)));

const ftyp = (major: string, ...compatible: string[]) => {
  const brands = [major, '\0\0\0\0', ...compatible].join('');
  const size = 8 + brands.length;
  const bytes = new Uint8Array(Math.max(size, 32));
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set([...'ftyp'].map((c) => c.charCodeAt(0)), 4);
  bytes.set([...brands].map((c) => c.charCodeAt(0)), 8);
  return bytes;
};

describe('HEIF detection', () => {
  it('knows HEIC, HEIF and HIF by name, whatever the letter case, and never as RAW', () => {
    for (const name of ['IMG_0001.HEIC', 'a.heic', 'b.HEIF', 'c.heif', 'R5_0001.HIF', 'sony.hif']) {
      expect(isHeifFile(name)).toBe(true);
      expect(isRawPreviewFile(name)).toBe(false);
      expect(isSupportedPhotoFilename(name)).toBe(true);
    }
    for (const name of ['a.jpg', 'a.heic.txt', 'heic', 'a.avif', 'a.cr3']) expect(isHeifFile(name)).toBe(false);
    expect(heifFormatLabel('IMG_0001.heic')).toBe('HEIC');
    expect(heifFormatLabel('R5_0001.HIF')).toBe('HIF');
  });

  it('offers HEIF files in every photo picker, by extension and by type, but not as RAW', () => {
    for (const ext of HEIF_EXTENSIONS) {
      expect(PHOTO_EXTENSIONS).toContain(`.${ext}`);
      expect(PHOTO_ACCEPT.split(',')).toContain(`.${ext}`);
      expect(RAW_ACCEPT.split(',')).not.toContain(`.${ext}`);
    }
    expect(PHOTO_ACCEPT.split(',')).toContain('image/heic');
    expect(PHOTO_ACCEPT.split(',')).toContain('image/heif');
    expect(RAW_ACCEPT.split(',')).toContain('.cr3');
    expect(RAW_ACCEPT.split(',')).not.toContain('.jpg');
  });

  it('recognises a HEIF file from its first bytes, and does not mistake a Canon CR3 or a JPEG for one', () => {
    expect(looksLikeHeif(FIXTURE)).toBe(true);
    expect(looksLikeHeif(ftyp('mif1', 'heic'))).toBe(true);
    expect(looksLikeHeif(ftyp('heix'))).toBe(true);
    expect(looksLikeHeif(ftyp('crx ', 'isom'))).toBe(false);
    expect(looksLikeHeif(ftyp('avif', 'mif1', 'miaf'))).toBe(true); // a HEIF container; decoding then decides
    expect(looksLikeHeif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, ...new Array(28).fill(0)]))).toBe(false);
    expect(looksLikeHeif(new Uint8Array(8))).toBe(false);
  });
});

describe('HEIF EXIF', () => {
  it('finds the EXIF block of a HEIF written with item base offsets (which exifr alone misreads)', async () => {
    const tiff = await readHeifExif(new Blob([FIXTURE]));
    expect(tiff).toBeTruthy();
    expect(String.fromCharCode(tiff![0], tiff![1])).toBe('MM');
    expect(new TextDecoder().decode(tiff!)).toContain('Kestrel Test');
  });

  it('returns no EXIF for a file without one, or for damaged bytes, rather than guessing', async () => {
    expect(await readHeifExif(new Blob([new Uint8Array(0)]))).toBeUndefined();
    expect(await readHeifExif(new Blob([ftyp('heic', 'mif1')]))).toBeUndefined();
    expect(await readHeifExif(new Blob([FIXTURE.slice(0, 200)]))).toBeUndefined();
    const garbage = new Uint8Array(4096);
    for (let i = 0; i < garbage.length; i += 1) garbage[i] = (i * 7919) & 255;
    expect(await readHeifExif(new Blob([garbage]))).toBeUndefined();
  });
});
