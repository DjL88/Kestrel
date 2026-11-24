import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCollagePage, collageExportPages, changeCollageTemplate, collagePage, createCollage, deleteCollagePage, duplicateCollagePage, readCollage, replaceCollagePhoto, COLLAGE_FORMATS } from './collage';

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

test('creating a collage from ten filmstrip photos uses three pages and keeps every photo', () => {
  const photoIds = Array.from({ length: 10 }, (_, index) => `photo-${index + 1}`);
  const collage = createCollage(photoIds, 'portrait');
  assert.equal(collage.pages.length, 3);
  assert.equal(collage.pages[0].slots.length, 4);
  assert.deepEqual(collage.pages.flatMap(page => page.slots.map(slot => slot.photoId).filter((id): id is string => id !== null)), photoIds);
  assert.deepEqual(readCollage(JSON.parse(JSON.stringify(collage))), collage);
});
test('switching from four-up to a two-window angled template preserves all page assignments', () => {
  const original = createCollage(['a', 'b', 'c', 'd']);
  const adjusted = changeCollageTemplate(original, 'diagonal');
  assert.equal(adjusted.pages.length, 2);
  assert.equal(adjusted.pages[0].id, original.pages[0].id);
  assert.deepEqual(adjusted.pages.flatMap(page => page.slots.map(slot => slot.photoId).filter((id): id is string => id !== null)), ['a','b','c','d']);
  assert.deepEqual(readCollage(JSON.parse(JSON.stringify(adjusted))), adjusted);
});

test('all accepted page operations remain reopenable at the album limit', () => {
  const ids = Array.from({length: 800}, (_, i) => String(i));
  const doc = createCollage(ids);
  assert.ok(readCollage(JSON.parse(JSON.stringify(doc))));
  assert.throws(() => createCollage([...ids, 'extra']), /800/);
  assert.equal(addCollagePage(doc), doc);
  assert.equal(duplicateCollagePage(doc), doc);
  assert.equal(changeCollageTemplate(doc, 'diagonal'), doc);
  assert.deepEqual(doc.pages.flatMap(page => page.slots.map(slot => slot.photoId)), ids);
  assert.ok(readCollage(changeCollageTemplate(deleteCollagePage(doc), 'diagonal')));
});

test('exports an inclusive range in album order and rejects invalid or excessive selections', () => {
  const doc = createCollage(Array.from({length: 168}, (_, i) => String(i)));
  assert.deepEqual(collageExportPages(doc, false, { first: 3, last: 42 }), doc.pages.slice(2));
  assert.deepEqual(collageExportPages(doc, false), [doc.pages[0]]);
  for (const range of [{first: 0,last: 1}, {first: 2,last: 1}, {first: 1,last: 41}, {first: 41,last: 43}, {first: 1.1,last: 2}]) {
    assert.throws(() => collageExportPages(doc, false, range));
  }
  assert.throws(() => collageExportPages(doc, true), /40/);
});

test('a new page size re-lays every page for its shape and keeps photographs and framing', async () => {
  const { changeCollageFormat, setCollageSlotFraming, collageShapes } = await import('./collage');
  let doc = createCollage(['a', 'b', 'c'], 'square');
  assert.equal(collagePage(doc).template, 'triptych');
  // Square: three side-by-side columns.
  assert.ok(collagePage(doc).slots.every((slot) => slot.height > slot.width));
  doc = setCollageSlotFraming(doc, collagePage(doc).slots[1].id, { zoom: 2, panX: 0.5 });
  const ids = collagePage(doc).slots.map((slot) => slot.id);
  const story = changeCollageFormat(doc, 'story');
  // A tall story page turns the columns into rows instead of stretching them.
  assert.ok(collagePage(story).slots.every((slot) => slot.width > slot.height));
  assert.deepEqual(collagePage(story).slots.map((slot) => slot.id), ids);
  assert.deepEqual(collagePage(story).slots.map((slot) => slot.photoId), ['a', 'b', 'c']);
  assert.equal(collagePage(story).slots[1].zoom, 2);
  assert.deepEqual(readCollage(JSON.parse(JSON.stringify(story))), story);
  // Going back restores the original geometry.
  const back = changeCollageFormat(story, 'square');
  assert.deepEqual(back.pages[0].slots.map(({ x, y, width, height }) => ({ x, y, width, height })),
    collageShapes('triptych', 1).map(({ x, y, width, height }) => ({ x, y, width, height })));
});

test('angled split turns on its side on a tall page and still reopens', async () => {
  const { changeCollageFormat } = await import('./collage');
  const doc = changeCollageFormat(createCollage(['a', 'b'], 'square'), 'a4-portrait');
  assert.equal(collagePage(doc).template, 'diagonal');
  assert.ok(collagePage(doc).slots.every((slot) => slot.width > slot.height && slot.clip));
  assert.ok(readCollage(JSON.parse(JSON.stringify(doc))));
});

test('window framing is clamped, resets to centred, and invalid saved framing is refused', async () => {
  const { setCollageSlotFraming, placeCollagePhoto, collageSlotPlacement } = await import('./collage');
  let doc = createCollage(['a']);
  const slot = collagePage(doc).slots[0].id;
  doc = setCollageSlotFraming(doc, slot, { zoom: 50, panX: -9, panY: 0.25 });
  assert.deepEqual({ zoom: collagePage(doc).slots[0].zoom, panX: collagePage(doc).slots[0].panX }, { zoom: 8, panX: -1 });
  doc = placeCollagePhoto(doc, slot, 'b');
  assert.equal('zoom' in collagePage(doc).slots[0], false);
  const bad = JSON.parse(JSON.stringify(doc));
  bad.pages[0].slots[0].zoom = 0.5;
  assert.equal(readCollage(bad), null);
  // A 3:2 photo in a square window, centred: wider than the window, cropped evenly both sides.
  const placed = collageSlotPlacement(1.5, 1, {});
  assert.deepEqual(placed, { width: 1.5, height: 1, left: -0.25, top: 0 });
  // Pan to the far right shows the right-hand edge of the picture.
  assert.equal(collageSlotPlacement(1.5, 1, { panX: 1 }).left, -0.5);
});

test('photographs dropped on a page fill its empty windows in order', async () => {
  const { fillEmptyCollageSlots } = await import('./collage');
  let doc = createCollage([], 'square');
  doc = replaceCollagePhoto(doc, collagePage(doc).slots[1].id, 'kept');
  const { doc: filled, placed } = fillEmptyCollageSlots(doc, ['x', 'y', 'z']);
  assert.equal(placed, 2);
  assert.deepEqual(collagePage(filled).slots.map((slot) => slot.photoId), ['x', 'kept', 'y']);
});

test('pages can be reordered and any page deleted, keeping the active page where it can', async () => {
  const { moveCollagePage, deleteCollagePageById } = await import('./collage');
  let doc = addCollagePage(addCollagePage(createCollage(['a'])));
  const [p1, p2, p3] = doc.pages.map((p) => p.id);
  doc = { ...doc, activePageId: p2 };
  doc = moveCollagePage(doc, p3, 0);
  assert.deepEqual(doc.pages.map((p) => p.id), [p3, p1, p2]);
  assert.equal(doc.activePageId, p2);
  assert.equal(moveCollagePage(doc, 'missing', 0), doc);
  doc = deleteCollagePageById(doc, p1);
  assert.deepEqual(doc.pages.map((p) => p.id), [p3, p2]);
  assert.equal(doc.activePageId, p2);
  doc = deleteCollagePageById(doc, p2);
  assert.equal(doc.activePageId, p3);
  assert.equal(deleteCollagePageById(doc, p3).pages.length, 1);
  assert.ok(readCollage(JSON.parse(JSON.stringify(doc))));
});

test('a background photograph is saved as a reference and checked on reopen', () => {
  const doc = createCollage(['a']);
  const withBackground = { ...doc, pages: doc.pages.map((p) => ({ ...p, backgroundPhotoId: 'a' })) };
  assert.ok(readCollage(JSON.parse(JSON.stringify(withBackground))));
  const bad = JSON.parse(JSON.stringify(withBackground));
  bad.pages[0].backgroundPhotoId = 42;
  assert.equal(readCollage(bad), null);
});
