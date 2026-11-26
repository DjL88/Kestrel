import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { bandingCodeFor, buildBandingCodes, searchSpecies, type SpeciesEntry } from './speciesSearch';

const BIRDS: SpeciesEntry[] = [
  { scientific: 'Turdus migratorius', common: 'American Robin' },
  { scientific: 'Erithacus rubecula', common: 'European Robin' },
  { scientific: 'Agelaius phoeniceus', common: 'Red-winged Blackbird' },
  { scientific: 'Mniotilta varia', common: 'Black-and-white Warbler' },
  { scientific: 'Anas platyrhynchos', common: 'Mallard' },
  { scientific: 'Turdus merula', common: 'Common Blackbird' },
  { scientific: 'Struthio camelus', common: 'Common Ostrich' },
  { scientific: 'Aenigmatolimnas marginalis', common: 'Aenigmatolimnas marginalis' },
];
const codes = buildBandingCodes(BIRDS);
const names = (hits: { common: string }[]) => hits.map((hit) => hit.common);

test('bandingCodeFor follows the four-letter rule for one to four words', () => {
  assert.equal(bandingCodeFor('Mallard'), 'MALL');
  assert.equal(bandingCodeFor('American Robin'), 'AMRO');
  assert.equal(bandingCodeFor('Red-winged Blackbird'), 'RWBL');
  assert.equal(bandingCodeFor('Black-capped Chickadee'), 'BCCH');
  assert.equal(bandingCodeFor('Black-and-white Warbler'), 'BAWW');
  assert.equal(bandingCodeFor('Northern Rough-winged Swallow'), 'NRWS');
});

test('bandingCodeFor drops apostrophes and gives no code where the rule gives none', () => {
  assert.equal(bandingCodeFor("Swainson's Hawk"), 'SWHA');
  assert.equal(bandingCodeFor('Gambel’s Quail'), 'GAQU');
  assert.equal(bandingCodeFor('Emu'), null);
  assert.equal(bandingCodeFor('One Two Three Four Five'), null);
  assert.equal(bandingCodeFor(''), null);
});

test('buildBandingCodes leaves out a code two different species would share, rather than guess', () => {
  const table = buildBandingCodes([
    { scientific: 'A a', common: 'Common Ostrich' },
    { scientific: 'B b', common: 'Common Osprey' },
    { scientific: 'Turdus migratorius', common: 'American Robin' },
    { scientific: 'Turdus migratorius', common: 'American Robin' },
    { scientific: 'C c', common: 'C c' },
  ]);
  assert.equal(table.has('COOS'), false);
  assert.equal(table.get('AMRO'), 'Turdus migratorius');
  assert.equal(table.size, 1);
});

test('searchSpecies puts the species with a typed four-letter code first, in any case', () => {
  for (const typed of ['AMRO', 'amro', ' Amro ']) {
    const [first] = searchSpecies(typed, BIRDS, codes);
    assert.equal(first.common, 'American Robin');
    assert.equal(first.code, 'AMRO');
    assert.equal(first.matchedBy, 'code');
  }
});

test('searchSpecies matches names from the start, then later words, then scientific names', () => {
  assert.deepEqual(names(searchSpecies('robin', BIRDS, codes)), ['American Robin', 'European Robin']);
  assert.deepEqual(names(searchSpecies('black', BIRDS, codes)), ['Black-and-white Warbler', 'Common Blackbird', 'Red-winged Blackbird']);
  assert.deepEqual(searchSpecies('turdus', BIRDS, codes).map((hit) => hit.matchedBy), ['scientific', 'scientific']);
});

test('searchSpecies shows a hit’s code where it has one and none where it lacks one', () => {
  const [mallard] = searchSpecies('mall', BIRDS, codes);
  assert.equal(mallard.code, 'MALL');
  assert.equal(searchSpecies('european', BIRDS, new Map())[0].code, undefined);
});

test('searchSpecies offers nothing for one letter or an unknown code, and honours the limit', () => {
  assert.deepEqual(searchSpecies('a', BIRDS, codes), []);
  assert.deepEqual(searchSpecies('ZZZZ', BIRDS, codes), []);
  assert.equal(searchSpecies('co', BIRDS, codes, 1).length, 1);
});

test('shipped banding-codes.json notes its source and licence, and holds well-known codes once each', () => {
  const file = JSON.parse(readFileSync('public/models/species-names/banding-codes.json', 'utf8')) as { codes: [string, string][]; source: string; licence: string };
  assert.match(file.source, /Not the official/);
  assert.match(file.licence, /CC BY 4\.0/);
  const table = new Map(file.codes);
  assert.equal(table.get('AMRO'), 'Turdus migratorius');
  assert.equal(table.get('BCCH'), 'Poecile atricapillus');
  assert.equal(table.get('RWBL'), 'Agelaius phoeniceus');
  assert.equal(table.size, file.codes.length);
  assert.equal(new Set(file.codes.map(([, scientific]) => scientific)).size, file.codes.length);
  for (const [code] of file.codes) assert.match(code, /^[A-Z]{4}$/);
});
