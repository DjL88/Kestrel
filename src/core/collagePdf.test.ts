import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collagePdf } from './collagePdf';
import { planCollagePrint } from './collagePrint';

test('RGB album PDF has physical media, trim, bleed and a valid cross-reference offset', async () => {
  const print = planCollagePrint('a4-portrait');
  // Test PDF structure only. The runtime renderer supplies browser-encoded JPEGs.
  const marker = new Blob([Uint8Array.from([255, 216, 255, 217])], { type: 'image/jpeg' });
  const pages = [1, 2].map(() => ({ jpeg: marker, width: print.targetPixels.width, height: print.targetPixels.height }));
  const pdf = collagePdf(pages, print);
  assert.equal(pdf.type, 'application/pdf');
  const content = new TextDecoder('latin1').decode(await pdf.arrayBuffer());
  assert.match(content, /^%PDF-1.4\n/);
  assert.match(content, /\/Count 2\b/);
  assert.equal((content.match(/\/TrimBox/g) ?? []).length, 2);
  assert.equal((content.match(/\/BleedBox/g) ?? []).length, 2);
  assert.equal((content.match(/\/ColorSpace \/DeviceRGB/g) ?? []).length, 2);
  const xref = Number(content.match(/startxref\n(\d+)\n%%EOF/)?.[1]);
  assert.equal(content.slice(xref, xref + 4), 'xref');
});
test('PDF refuses bad paper encoding, wrong dimensions and an empty album', () => {
  const print = planCollagePrint('a4-portrait');
  const jpeg = new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' });
  assert.throws(() => collagePdf([], print));
  assert.throws(() => collagePdf([{ jpeg, width: 1080, height: 1080 }], print));
  assert.throws(() => collagePdf([{ jpeg: new Blob(['x'], {type: 'image/png'}), width: print.targetPixels.width, height: print.targetPixels.height }], print));
});
