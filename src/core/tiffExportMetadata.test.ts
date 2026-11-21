import assert from 'node:assert/strict';
import test from 'node:test';
import { tiffXmpPacket } from './tiffExportMetadata.ts';
import { metadataForExport, NO_EXPORT_METADATA } from './exportMetadataOptions.ts';
import { encodeTiff16, type Rgb16Image } from './master16.ts';
import { proveTiff16 } from './tiff16Proof.ts';

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const img = (): Rgb16Image => ({
  width: 3, height: 2,
  data: Uint16Array.from([1, 257, 65535, 2049, 23, 32768, 1024, 34, 33333,
    10, 20, 30, 54321, 789, 1029, 65532, 2, 517]),
});
function tag(view: DataView, id: number): { offset: number; count: number; entry: number } | null {
  const dir = view.getUint32(4, true);
  for (let n = 0; n < view.getUint16(dir, true); n++) {
    const entry = dir + 2 + n * 12;
    if (view.getUint16(entry, true) === id) return {
      entry, count: view.getUint32(entry + 4, true), offset: view.getUint32(entry + 8, true),
    };
  }
  return null;
}
const pixels = (buffer: ArrayBuffer) => {
  const v = new DataView(buffer);
  const strip = tag(v, 273)!;
  const length = tag(v, 279)!;
  return new Uint8Array(buffer, strip.offset, v.getUint32(length.entry + 8, true));
};

test('opt-in TIFF XMP preserves all original RGB16 pixel bytes and ICC profile', async () => {
  const source = img();
  const before = source.data.slice();
  const ordinary = await encodeTiff16(source).arrayBuffer();
  const annotated = await encodeTiff16(source, { title: 'Blue tit', caption: 'On a branch',
    creator: 'Photographer', copyright: '© Photographer', keywords: ['bird', 'garden'] }).arrayBuffer();
  assert.deepEqual(source.data, before, 'No modification to source image buffer');
  assert.deepEqual(pixels(annotated), pixels(ordinary), 'Metadata never changes 16-bit image samples');
  assert.deepEqual(proveTiff16(annotated), proveTiff16(ordinary));
  const iccOf = (buffer: ArrayBuffer) => {
    const v = new DataView(buffer);
    const p = tag(v, 34675)!;
    return new Uint8Array(buffer, p.offset, p.count);
  };
  assert.deepEqual(iccOf(annotated), iccOf(ordinary), 'The real embedded colour profile is unchanged');
});

test('opt-in metadata embeds escaped Unicode fields and no implicit sensitive EXIF/GPS', async () => {
  const buffer = await encodeTiff16(img(), {
    title: 'Kite44 & <clouds>', caption: 'Français — 日本語',
    creator: 'Owner', copyright: '© 2026', keywords: ['owl', 'owl', 'garden'],
  }).arrayBuffer();
  const v = new DataView(buffer);
  const xmp = tag(v, 700)!;
  assert.ok(xmp.count > 0);
  const xml = decode(new Uint8Array(buffer, xmp.offset, xmp.count));
  assert.match(xml, /Kite44 &amp; &lt;clouds&gt;/);
  assert.match(xml, /Français — 日本語/);
  assert.match(xml, /rdf:Alt/);
  assert.equal((xml.match(/<rdf:li>owl<\/rdf:li>/g) ?? []).length, 1);
  assert.doesNotMatch(xml, /GPS|latitude|longitude|SerialNumber|CameraSerial/i);
  assert.deepEqual(proveTiff16(buffer), { width: 3, height: 2, iccBytes: 588 });
});

test('default and empty metadata create no XMP packet at all', async () => {
  const source = img();
  const bare = await encodeTiff16(source).arrayBuffer();
  const blank = await encodeTiff16(source, { title: ' ', keywords: [''] }).arrayBuffer();
  assert.deepEqual(new Uint8Array(blank), new Uint8Array(bare));
  assert.equal(tag(new DataView(bare), 700), null);
  assert.equal(tiffXmpPacket(null), null);
});

test('invalid XMP offsets, types and overlaps fail the TIFF proof', async () => {
  const valid = await encodeTiff16(img(), { title: 'Safe metadata' }).arrayBuffer();
  const entry = tag(new DataView(valid), 700)!.entry;
  const icc = tag(new DataView(valid), 34675)!;
  const strip = tag(new DataView(valid), 273)!;
  for (const change of [
    (v: DataView) => v.setUint16(entry + 2, 4, true),
    (v: DataView) => v.setUint32(entry + 4, 0xffffffff, true),
    (v: DataView) => v.setUint32(entry + 8, icc.offset, true),
    (v: DataView) => v.setUint32(entry + 8, strip.offset, true),
    (v: DataView) => v.setUint32(entry + 8, 8, true),
  ]) {
    const mutated = valid.slice(0);
    change(new DataView(mutated));
    assert.throws(() => proveTiff16(mutated), /XMP|out-of-bounds/);
  }
});

test('malformed XML characters are stripped and photographer text is not executable markup', () => {
  const bytes = tiffXmpPacket({ title: '<script>alert("x")</script>\u0001 & test' })!;
  const text = decode(bytes);
  assert.doesNotMatch(text, /<script>/);
  assert.match(text, /&lt;script&gt;/);
  assert.doesNotMatch(text, /\u0001/);
});

test('the shared Export form applies the same opt-in metadata to a 16-bit TIFF', async () => {
  const frame = {
    subjectNames: ['Dunnock'], tags: ['Bird', 'Helicopter'], autoTags: ['Helicopter'],
  };
  const blank = await encodeTiff16(img(), metadataForExport(frame, NO_EXPORT_METADATA)).arrayBuffer();
  assert.equal(tag(new DataView(blank), 700), null, 'metadata stays absent by default');
  const selected = metadataForExport(frame, {
    ...NO_EXPORT_METADATA, enabled: true, includeKeywords: true,
    creator: 'Wildlife photographer', caption: 'Garden portrait',
  });
  const exported = await encodeTiff16(img(), selected).arrayBuffer();
  const xmpTag = tag(new DataView(exported), 700);
  assert.ok(xmpTag);
  const xml = decode(new Uint8Array(exported, xmpTag.offset, xmpTag.count));
  assert.match(xml, /Dunnock/);
  assert.match(xml, /Wildlife photographer/);
  assert.match(xml, /Garden portrait/);
  assert.doesNotMatch(xml, /Helicopter|GPS|SerialNumber/);
  assert.deepEqual(pixels(exported), pixels(blank), 'descriptive metadata cannot change 16-bit pixels');
  assert.deepEqual(proveTiff16(exported), proveTiff16(blank), 'TIFF integrity and colour profile unchanged');
});
