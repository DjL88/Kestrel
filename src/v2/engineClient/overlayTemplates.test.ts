import assert from 'node:assert/strict';
import test from 'node:test';
import { addTemplate, deleteTemplate, overlayFromTemplate, readTemplates, renameTemplate } from './overlayTemplates.ts';
import { createDefaultOverlay } from '../ui/stub.ts';

const overlay = () => ({ ...createDefaultOverlay(false), textEnabled: true, textX: 20, textY: 80 });

test('a template keeps the overlay as a copy: changing the original or the applied copy never changes it', () => {
  const list = addTemplate([], '  Wildlife   credit ', overlay(), 'tpl-abc123', 1)!;
  assert.equal(list[0].name, 'Wildlife credit');
  const source = overlay(); source.textX = 99;
  assert.equal(list[0].overlay.textX, 20);
  const applied = overlayFromTemplate(list[0]); applied.textX = 5;
  assert.equal(list[0].overlay.textX, 20);
});

test('empty names, bad ids, duplicates and a full list are refused', () => {
  assert.equal(addTemplate([], '   ', overlay(), 'tpl-abc123', 1), undefined);
  assert.equal(addTemplate([], 'x', overlay(), 'bad id', 1), undefined);
  const one = addTemplate([], 'x', overlay(), 'tpl-abc123', 1)!;
  assert.equal(addTemplate(one, 'y', overlay(), 'tpl-abc123', 2), undefined);
  let full = one;
  for (let i = 0; i < 19; i += 1) full = addTemplate(full, `t${i}`, overlay(), `tpl-id${String(i).padStart(3, '0')}`, i)!;
  assert.equal(full.length, 20);
  assert.equal(addTemplate(full, 'one more', overlay(), 'tpl-zzz999', 9), undefined);
});

test('rename keeps a usable name, delete removes only that template', () => {
  const list = addTemplate(addTemplate([], 'A', overlay(), 'tpl-aaa111', 1)!, 'B', overlay(), 'tpl-bbb222', 2)!;
  assert.equal(renameTemplate(list, 'tpl-aaa111', ' New ')[0].name, 'New');
  assert.equal(renameTemplate(list, 'tpl-aaa111', '  ')[0].name, 'A');
  assert.deepEqual(deleteTemplate(list, 'tpl-aaa111').map((entry) => entry.id), ['tpl-bbb222']);
});

test('stored data is read defensively: junk is dropped and the overlay is made valid', () => {
  assert.deepEqual(readTemplates(null), []);
  assert.deepEqual(readTemplates('not json'), []);
  assert.deepEqual(readTemplates('{"a":1}'), []);
  const read = readTemplates(JSON.stringify([
    { id: 'tpl-good01', name: 'Good', overlay: { textX: 9999, textEnabled: 'yes' }, savedAt: 5 },
    { id: '../evil', name: 'Evil', overlay: {} }, { id: 'tpl-noname', name: '   ', overlay: {} }, 7, null,
  ]));
  assert.deepEqual(read.map((entry) => entry.id), ['tpl-good01']);
  assert.ok(read[0].overlay.textX <= 96 && read[0].overlay.textX >= 4);
  assert.equal(typeof read[0].overlay.textEnabled, 'boolean');
});
