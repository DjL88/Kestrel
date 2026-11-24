import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleAlbumPdf, jpegDimensions } from './collagePdf';

const jpeg = Uint8Array.from([255,216,255,192,0,17,8,0,16,0,32,3,1,17,0,2,17,0,3,17,0,255,217]);
test('physical multi-page PDF includes page count and trim box and exact image sizes', () => {
  assert.deepEqual(jpegDimensions(jpeg), { width: 32, height: 16, components: 3 });
  const content = assembleAlbumPdf([1,2].map(() => ({ jpeg, pixels: { width:32, height:16 }, mediaMm: { width:216, height:303 }, bleedMm:3 })));
  const rendered = new TextDecoder('latin1').decode(content);
  assert.ok(rendered.includes('/Count 2'));
  assert.ok(rendered.includes('/TrimBox ['));
  assert.ok(rendered.includes('/Width 32 /Height 16 /ColorSpace /DeviceRGB'));
  assert.ok(rendered.includes('startxref'));
  assert.ok(rendered.startsWith('%PDF-1.4'));
});
test('refuses suspicious or mismatched JPEGs and invalid bleed', () => {
  const page = { jpeg, pixels: { width:32, height:16 }, mediaMm: { width:216, height:303 }, bleedMm:3 };
  assert.throws(() => assembleAlbumPdf([]));
  assert.throws(() => assembleAlbumPdf([{...page,pixels:{width:100,height:16}}]));
  assert.throws(() => assembleAlbumPdf([{...page,bleedMm:200}]));
  assert.throws(() => jpegDimensions(new Uint8Array([1,2])));
});
