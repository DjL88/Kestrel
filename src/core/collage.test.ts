import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCollagePage, changeCollageTemplate, collagePage, createCollage, deleteCollagePage, duplicateCollagePage, readCollage, replaceCollagePhoto, COLLAGE_FORMATS } from './collage';

test('a collage can show the same photograph on multiple pages without duplicating originals', () => {
  let doc = createCollage(['raw-1', 'raw-2', 'raw-3']);
  assert.equal(collagePage(doc).slots[0].photoId, 'raw-1');
  doc = addCollagePage(doc, 'diagonal');
  doc = replaceCollagePhoto(doc, collagePage(doc).slots[1].id, 'raw-1');
  assert.equal(collagePage(doc).slots[1].photoId, 'raw-1');
  assert.equal(doc.pages[0].slots[0].photoId, 'raw-1');
  assert.equal(doc.pages.length, 2);
  const roundTrip = readCollage(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(roundTrip, doc);
});
test('template changes retain source photo choices and page styling', () => {
  let doc = createCollage(['a', 'b', 'c']);
  doc.pages[0].background = '#112233';
  doc = changeCollageTemplate(doc, 'grid');
  assert.deepEqual(collagePage(doc).slots.slice(0, 3).map((s) => s.photoId), ['a', 'b', 'c']);
  assert.equal(collagePage(doc).background, '#112233');
});
test('duplicate copies slots but allows independent page edits, deletion never removes the last page', () => {
  let doc = createCollage(['a']);
  doc = duplicateCollagePage(doc);
  assert.notEqual(doc.pages[0].slots[0].id, doc.pages[1].slots[0].id);
  doc = replaceCollagePhoto(doc, doc.pages[1].slots[0].id, 'b');
  assert.equal(doc.pages[0].slots[0].photoId, 'a');
  doc = deleteCollagePage(doc);
  assert.equal(doc.pages.length, 1);
  assert.equal(deleteCollagePage(doc).pages.length, 1);
});
test('reject invalid persisted shapes; social pixels are distinct from physical print units', () => {
  assert.equal(readCollage({ version: 1, format: 'square', pages: [], activePageId: '' }), null);
  assert.equal(COLLAGE_FORMATS.square.unit, 'px');
  assert.equal(COLLAGE_FORMATS['a4-portrait'].unit, 'mm');
});

test('a filmstrip selection of 10 photographs fills three collage pages without loss', () => {
  const ids = Array.from({length: 10}, (_, i) => `photo-${i}`);
  const doc = createCollage(ids);
  assert.equal(doc.pages.length, 3);
  assert.deepEqual(doc.pages.flatMap((p) => p.slots.map((s) => s.photoId).filter(Boolean)), ids);
  assert.equal(doc.activePageId, doc.pages[0].id);
});
