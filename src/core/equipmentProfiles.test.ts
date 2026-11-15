import assert from 'node:assert/strict';
import test from 'node:test';
import { findEquipmentLabel, parseEquipmentCatalogue, selectEquipmentUpdate } from './equipmentProfiles';

const canon = {
  id: 'canon-eos-r5', kind: 'camera', maker: 'Canon', model: 'EOS R5',
  aliases: ['Canon EOS R5'], source: 'manufacturer',
  sourceUrl: 'https://www.canon-europe.com/',
};
const sony = {
  id: 'sony-fe-lens', kind: 'lens', maker: 'Sony', model: 'FE 24-70mm F2.8 GM',
  aliases: ['SEL2470GM'], source: 'lensfun',
  sourceUrl: 'https://lensfun.github.io/',
};
const catalogue = { schema: 1, revision: 2, entries: [canon, sony] };

test('camera and lens catalogue accepts explicit evidence and matches exact aliases', () => {
  const parsed = parseEquipmentCatalogue(catalogue);
  assert.ok(parsed);
  assert.equal(findEquipmentLabel(parsed, 'camera', 'Canon', ' canon eos r5 '), 'EOS R5');
  assert.equal(findEquipmentLabel(parsed, 'lens', 'Sony', 'sel2470gm'), 'FE 24-70mm F2.8 GM');
  assert.equal(findEquipmentLabel(parsed, 'camera', 'Sony', 'Canon EOS R5'), null);
  assert.equal(findEquipmentLabel(parsed, 'camera', 'Canon', 'EOS R5 II'), null);
});

test('reject unknown fields, duplicate IDs, ambiguous aliases, executable URLs and oversized collections', () => {
  assert.equal(parseEquipmentCatalogue({ ...catalogue, execute: true }), null);
  assert.equal(parseEquipmentCatalogue({ ...catalogue, entries: [canon, canon] }), null);
  assert.equal(parseEquipmentCatalogue({ ...catalogue, entries: [{ ...canon, aliases: ['EOS R5'] }] }), null);
  assert.equal(parseEquipmentCatalogue({ ...catalogue, entries: [{ ...canon, sourceUrl: 'javascript:alert(1)' }] }), null);
  assert.equal(parseEquipmentCatalogue({ ...catalogue, entries: [{ ...canon, sourceUrl: 'https://user:pass@example.com' }] }), null);
  assert.equal(parseEquipmentCatalogue({ ...catalogue, entries: [{ ...canon, model: 'R5\nscript' }] }), null);
  assert.equal(parseEquipmentCatalogue({ ...catalogue, entries: Array(5001).fill(canon) }), null);
});

test('reject bogus revisions and do not apply older or identical catalogue updates', () => {
  const current = parseEquipmentCatalogue(catalogue)!;
  assert.equal(parseEquipmentCatalogue({ ...catalogue, revision: 0 }), null);
  assert.equal(parseEquipmentCatalogue({ ...catalogue, revision: 1.5 }), null);
  assert.equal(selectEquipmentUpdate(current, { ...catalogue, revision: 1 }), null);
  assert.equal(selectEquipmentUpdate(current, catalogue), null);
  assert.equal(selectEquipmentUpdate(current, { ...catalogue, revision: 3 })?.revision, 3);
});
