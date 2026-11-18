import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSrgbIccProfile,
  decodeTiffOrRawBuffer,
  demosaicBayerMalvar,
  encodeRgb16TiffWithIcc,
  extractEmbeddedRawPreview,
} from './kestrelRawDecoder';

function buildMinimalTiff({
  littleEndian,
  width,
  height,
  bitsPerSample,
  photometric,
  samplesPerPixel,
  raster,
  asShotNeutral,
  blackLevel,
  whiteLevel,
  cfaPattern,
}: {
  littleEndian: boolean;
  width: number;
  height: number;
  bitsPerSample: number;
  photometric: number;
  samplesPerPixel: number;
  raster: Uint8Array;
  asShotNeutral?: [number, number, number];
  blackLevel?: number;
  whiteLevel?: number;
  cfaPattern?: [number, number, number, number];
}): Uint8Array {
  const entries: Array<{ tag: number; type: number; count: number; value?: number; extra?: Uint8Array }> = [
    { tag: 256, type: 4, count: 1, value: width },
    { tag: 257, type: 4, count: 1, value: height },
    { tag: 259, type: 3, count: 1, value: 1 },
    { tag: 262, type: 3, count: 1, value: photometric },
    { tag: 277, type: 3, count: 1, value: samplesPerPixel },
    { tag: 278, type: 4, count: 1, value: height },
    { tag: 279, type: 4, count: 1, value: raster.length },
  ];

  if (samplesPerPixel === 3) {
    const bps = new Uint8Array(6);
    const bv = new DataView(bps.buffer);
    bv.setUint16(0, bitsPerSample, littleEndian);
    bv.setUint16(2, bitsPerSample, littleEndian);
    bv.setUint16(4, bitsPerSample, littleEndian);
    entries.push({ tag: 258, type: 3, count: 3, extra: bps });
  } else {
    entries.push({ tag: 258, type: 3, count: 1, value: bitsPerSample });
  }

  if (cfaPattern) {
    entries.push({ tag: 33422, type: 1, count: 4, extra: new Uint8Array(cfaPattern) });
  }
  if (blackLevel !== undefined) {
    entries.push({ tag: 50714, type: 4, count: 1, value: blackLevel });
  }
  if (whiteLevel !== undefined) {
    entries.push({ tag: 50717, type: 4, count: 1, value: whiteLevel });
  }
  if (asShotNeutral) {
    const raw = new Uint8Array(24);
    const rv = new DataView(raw.buffer);
    for (let i = 0; i < 3; i += 1) {
      rv.setUint32(i * 8, Math.round(asShotNeutral[i] * 10000), littleEndian);
      rv.setUint32(i * 8 + 4, 10000, littleEndian);
    }
    entries.push({ tag: 50728, type: 5, count: 3, extra: raw });
  }

  // StripOffsets placeholder (filled once extra blocks placed)
  const stripPlaceholderIdx = entries.length;
  entries.push({ tag: 273, type: 4, count: 1, value: 0 });
  entries.sort((a, b) => a.tag - b.tag);

  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  let cursor = ifdOffset + ifdSize;
  const extraPlacements = new Map<number, number>();
  for (const e of entries) {
    if (e.extra && e.extra.length > 4) {
      extraPlacements.set(e.tag, cursor);
      cursor += e.extra.length + (e.extra.length % 2);
    }
  }
  const rasterOffset = cursor;
  const total = rasterOffset + raster.length;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  buf[0] = littleEndian ? 0x49 : 0x4d;
  buf[1] = littleEndian ? 0x49 : 0x4d;
  view.setUint16(2, 42, littleEndian);
  view.setUint32(4, ifdOffset, littleEndian);
  view.setUint16(ifdOffset, entries.length, littleEndian);

  let p = ifdOffset + 2;
  for (const e of entries) {
    view.setUint16(p, e.tag, littleEndian);
    view.setUint16(p + 2, e.type, littleEndian);
    view.setUint32(p + 4, e.count, littleEndian);
    if (e.tag === 273) {
      view.setUint32(p + 8, rasterOffset, littleEndian);
    } else if (e.extra && e.extra.length <= 4) {
      buf.set(e.extra, p + 8);
    } else if (e.extra) {
      const off = extraPlacements.get(e.tag)!;
      view.setUint32(p + 8, off, littleEndian);
      buf.set(e.extra, off);
    } else if (e.type === 3 && e.count === 1) {
      view.setUint16(p + 8, e.value ?? 0, littleEndian);
    } else {
      view.setUint32(p + 8, e.value ?? 0, littleEndian);
    }
    p += 12;
  }
  void stripPlaceholderIdx;
  buf.set(raster, rasterOffset);
  return buf;
}

test('buildSrgbIccProfile generates valid ICC v2.1 header and encodeRgb16TiffWithIcc round-trips through decodeTiffOrRawBuffer', () => {
  const icc = buildSrgbIccProfile();
  const acsp = String.fromCharCode(icc[36], icc[37], icc[38], icc[39]);
  assert.equal(acsp, 'acsp');

  const w = 4;
  const h = 3;
  const rgb16 = new Uint16Array(w * h * 3);
  for (let i = 0; i < w * h; i += 1) {
    rgb16[i * 3] = 52428; // ~0.8 sRGB
    rgb16[i * 3 + 1] = 32768; // ~0.5 sRGB
    rgb16[i * 3 + 2] = 13107; // ~0.2 sRGB
  }
  const tiff = encodeRgb16TiffWithIcc(rgb16, w, h, 'Kestrel Test Encoder');
  const decoded = decodeTiffOrRawBuffer(tiff);
  assert.equal(decoded.width, w);
  assert.equal(decoded.height, h);
  assert.equal(decoded.bitDepth, 16);
  assert.equal(decoded.decoder, 'kestrel-tiff-rgb16');
  assert.ok(Math.abs(decoded.linearRgb[0] - ((0.8 + 0.055) / 1.055) ** 2.4) < 0.002);
  assert.ok(Math.abs(decoded.linearRgb[1] - ((0.5 + 0.055) / 1.055) ** 2.4) < 0.002);
  assert.ok(Math.abs(decoded.linearRgb[2] - ((0.2 + 0.055) / 1.055) ** 2.4) < 0.002);

  // Verify Tag 34675 (ICC Profile) exists inside TIFF bytes
  const ascii = Buffer.from(tiff).toString('latin1');
  assert.ok(ascii.includes('Kestrel Test Encoder'));
  assert.ok(ascii.includes('acsp'));
});

test('decodeTiffOrRawBuffer supports Big-Endian RGB8 TIFFs cleanly', () => {
  const raster = new Uint8Array([255, 0, 128, 64, 192, 32]);
  const beTiff = buildMinimalTiff({
    littleEndian: false,
    width: 2,
    height: 1,
    bitsPerSample: 8,
    photometric: 2,
    samplesPerPixel: 3,
    raster,
  });
  const decoded = decodeTiffOrRawBuffer(beTiff);
  assert.equal(decoded.decoder, 'kestrel-tiff-rgb8');
  assert.ok(decoded.linearRgb[0] > 0.99);
  assert.equal(decoded.linearRgb[1], 0);
});

test('decodeTiffOrRawBuffer decodes 16-bit Bayer CFA mosaic with Black/White level & AsShotNeutral via Malvar-He-Cutler', () => {
  const width = 8;
  const height = 8;
  const samples = new Uint16Array(width * height);
  // Neutral scene illuminated so R=1000+512, G=2000+512, B=1500+512 above BlackLevel=512
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const isEvenY = y % 2 === 0;
      const isEvenX = x % 2 === 0;
      const c = isEvenY ? (isEvenX ? 0 : 1) : (isEvenX ? 1 : 2);
      samples[y * width + x] = 512 + (c === 0 ? 1000 : c === 1 ? 2000 : 1500);
    }
  }
  const raster = new Uint8Array(samples.buffer);
  const cfaTiff = buildMinimalTiff({
    littleEndian: true,
    width,
    height,
    bitsPerSample: 16,
    photometric: 32803,
    samplesPerPixel: 1,
    raster,
    blackLevel: 512,
    whiteLevel: 16383,
    cfaPattern: [0, 1, 1, 2],
    asShotNeutral: [0.5, 1.0, 0.75],
  });
  const decoded = decodeTiffOrRawBuffer(cfaTiff);
  assert.equal(decoded.decoder, 'kestrel-bayer-malvar');
  const centerIdx = (4 * width + 4) * 3;
  // After AsShotNeutral compensation, R, G, B at interior pixel should balance closely to neutral grey
  assert.ok(Math.abs(decoded.linearRgb[centerIdx] - decoded.linearRgb[centerIdx + 1]) < 0.015);
  assert.ok(Math.abs(decoded.linearRgb[centerIdx + 2] - decoded.linearRgb[centerIdx + 1]) < 0.015);

  // Direct demosaic sanity check on unit mosaic
  const uni = new Float32Array(16).fill(0.5);
  const flatRgb = demosaicBayerMalvar(uni, 4, 4, [0, 1, 1, 2]);
  assert.equal(flatRgb.length, 48);
  assert.ok(Math.abs(flatRgb[15] - 0.5) < 0.01);
});

test('decodeTiffOrRawBuffer decodes binary P6 16-bit Netpbm PPM', () => {
  const header = new TextEncoder().encode('P6\n# Kestrel synthetic\n2 1\n65535\n');
  const pixels = new Uint8Array([
    0xff, 0xff, 0x00, 0x00, 0x80, 0x00, // (1.0, 0.0, ~0.5) big-endian
    0x00, 0x00, 0xff, 0xff, 0x00, 0x00, // (0.0, 1.0, 0.0)
  ]);
  const ppm = new Uint8Array(header.length + pixels.length);
  ppm.set(header, 0);
  ppm.set(pixels, header.length);
  const decoded = decodeTiffOrRawBuffer(ppm);
  assert.equal(decoded.decoder, 'kestrel-netpbm');
  assert.equal(decoded.bitDepth, 16);
  assert.ok(decoded.linearRgb[0] > 0.99);
  assert.equal(decoded.linearRgb[4], 1);
});

test('extractEmbeddedRawPreview finds largest embedded JPEG preview stream across arbitrary container bytes', () => {
  const fakeContainer = new Uint8Array(4096);
  // Small fake thumb at offset 64 (1100 bytes)
  fakeContainer.set([0xff, 0xd8, 0xff, 0xe0], 64);
  fakeContainer.set([0xff, 0xd9], 64 + 1100);
  // Larger preview at offset 1500 (2100 bytes)
  fakeContainer.set([0xff, 0xd8, 0xff, 0xe1], 1500);
  fakeContainer.set([0xff, 0xd9], 1500 + 2100);
  const res = extractEmbeddedRawPreview(fakeContainer);
  assert.ok(res);
  assert.equal(res.jpeg.length, 2102);
  assert.equal(res.jpeg[0], 0xff);
  assert.equal(res.jpeg[1], 0xd8);
});
