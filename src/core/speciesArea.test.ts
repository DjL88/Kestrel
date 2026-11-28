import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  ALL_REGION_IDS, SPECIES_COUNTRIES, parseSpeciesArea, regionIdsForArea, regionsForCountry, regionsForPosition, reopenForNewArea,
  resolvedArea, speciesLabelsForRegions, suggestAreaFromPositions,
} from './speciesArea';
import { decodeVector, rankSpecies, type SpeciesLabel } from './speciesMatch';
import { parseSettings } from './projectSettings';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as { labels: SpeciesLabel[] };
const shipped = read('../../tools/species/uk.json').labels;
const world = read('../../public/models/species-world.json').labels;
const HOME = ['palearctic'];

/** A photo-like embedding: mostly the Venezuelan bird, with a strong share of its UK look-alike. */
function blend(a: SpeciesLabel, b: SpeciesLabel, share = 0.6): Float32Array {
  const va = decodeVector(a), vb = decodeVector(b);
  const out = va.map((value, i) => share * value + (1 - share) * vb[i]);
  const norm = Math.hypot(...out);
  return out.map((value) => value / norm);
}

function topName(embedding: Float32Array, regions: string[]): string {
  const labels = speciesLabelsForRegions(shipped, world, [], regions);
  return rankSpecies(embedding, labels, labels.map(decodeVector))[0].label.scientific;
}

for (const [venezuelan, lookalike] of [['Sicalis flaveola', 'Emberiza citrinella'], ['Turdus leucomelas', 'Turdus philomelos']]) {
  test(`a Venezuelan ${venezuelan} outranks the UK ${lookalike} when the project says South America or Worldwide`, () => {
    const a = world.find((label) => label.scientific === venezuelan)!;
    const b = shipped.find((label) => label.scientific === lookalike)!;
    assert.ok(a && b, 'both names are in the lists');
    const photo = blend(a, b);
    assert.equal(topName(photo, regionIdsForArea({ kind: 'regions', ids: ['neotropics'] }, HOME)), venezuelan);
    assert.equal(topName(photo, regionIdsForArea({ kind: 'country', code: 'VE' }, HOME)), venezuelan);
    assert.equal(topName(photo, regionIdsForArea({ kind: 'world' }, HOME)), venezuelan);
    // At home (Europe) the Venezuelan bird is not on the list, which is why a trip needs its own place.
    assert.equal(topName(photo, regionIdsForArea(undefined, HOME)), lookalike);
  });
}

test('the UK list is ranked only when Europe is among the regions; the world list still has the birds that live in both', () => {
  const southAmerica = speciesLabelsForRegions(shipped, world, [], ['neotropics']);
  assert.ok(!southAmerica.some((label) => label.scientific === 'Emberiza citrinella'), 'no Yellowhammer in South America');
  const northAmerica = speciesLabelsForRegions(shipped, world, [], ['nearctic']);
  assert.ok(northAmerica.some((label) => label.scientific === 'Anas platyrhynchos'), 'the Mallard lives in North America too');
  const home = speciesLabelsForRegions(shipped, world, [], HOME);
  assert.equal(home.slice(0, shipped.length).map((label) => label.scientific).join(), shipped.map((label) => label.scientific).join(), 'UK names first, as before');
  assert.equal(new Set(home.map((label) => label.scientific.toLowerCase())).size, home.length, 'no name twice');
  const everywhere = speciesLabelsForRegions(shipped, world, [], [...ALL_REGION_IDS]);
  assert.ok(everywhere.length >= world.length, 'worldwide has every bird');
});

test('a GPS position gives its broad region, and both sides near a boundary', () => {
  assert.deepEqual(regionsForPosition(51.5, -0.13), ['palearctic'], 'London');
  assert.deepEqual(regionsForPosition(10.5, -66.9), ['neotropics'], 'Caracas');
  assert.deepEqual(regionsForPosition(40.7, -74), ['nearctic'], 'New York');
  assert.deepEqual(regionsForPosition(19.4, -99.1).sort(), ['nearctic', 'neotropics'], 'Mexico City');
  assert.deepEqual(regionsForPosition(-1.3, 36.8), ['afrotropics'], 'Nairobi');
  assert.deepEqual(regionsForPosition(28.6, 77.2), ['oriental'], 'Delhi');
  assert.deepEqual(regionsForPosition(39.9, 116.4), ['palearctic'], 'Beijing');
  assert.deepEqual(regionsForPosition(35.7, 139.7), ['palearctic'], 'Tokyo');
  assert.deepEqual(regionsForPosition(1.35, 103.8), ['oriental'], 'Singapore');
  assert.deepEqual(regionsForPosition(-33.9, 151.2), ['australasia'], 'Sydney');
  assert.deepEqual(regionsForPosition(-41.3, 174.8), ['australasia'], 'Wellington');
  assert.deepEqual(regionsForPosition(21.3, -157.9), ['oceans'], 'Honolulu');
  assert.deepEqual(regionsForPosition(-18.1, 178.4), ['oceans'], 'Suva');
  assert.deepEqual(regionsForPosition(64.1, -21.9), ['palearctic'], 'Reykjavík');
  assert.deepEqual(regionsForPosition(61.2, -149.9), ['nearctic'], 'Anchorage');
  assert.deepEqual(regionsForPosition(-12, -77), ['neotropics'], 'Lima');
  assert.deepEqual(regionsForPosition(30.05, 31.2), ['palearctic'], 'Cairo');
  assert.deepEqual(regionsForPosition(-77.8, 166.7), ['oceans'], 'McMurdo, Antarctica');
  assert.deepEqual(regionsForPosition(Number.NaN, 0), [], 'no position, no region');
  assert.deepEqual(regionsForPosition(120, 0), []);
});

test('the photos\' GPS suggests a place only when it is not already home; the person confirms it', () => {
  const caracas = { latitude: 10.5, longitude: -66.9 }, london = { latitude: 51.5, longitude: -0.13 };
  assert.deepEqual(suggestAreaFromPositions([caracas, caracas], HOME), { kind: 'regions', ids: ['neotropics'] });
  assert.equal(suggestAreaFromPositions([london], HOME), null, 'home photos: nothing to suggest');
  assert.equal(suggestAreaFromPositions([], HOME), null, 'no GPS: nothing to suggest');
  assert.deepEqual(suggestAreaFromPositions([london, caracas], HOME), { kind: 'regions', ids: ['palearctic', 'neotropics'] }, 'a project with both');
});

test('a stored place is checked, and an unknown one means home', () => {
  assert.deepEqual(parseSpeciesArea({ kind: 'country', code: 've' }), { kind: 'country', code: 'VE' });
  assert.equal(parseSpeciesArea({ kind: 'country', code: 'ZZ' }), undefined);
  assert.deepEqual(parseSpeciesArea({ kind: 'regions', ids: ['neotropics', 'mars', 'neotropics'] }), { kind: 'regions', ids: ['neotropics'] });
  assert.equal(parseSpeciesArea({ kind: 'regions', ids: [] }), undefined);
  assert.equal(parseSpeciesArea('world'), undefined);
  assert.deepEqual(regionIdsForArea({ kind: 'world' }, HOME), [...ALL_REGION_IDS]);
  assert.deepEqual(regionIdsForArea({ kind: 'country', code: 'MX' }, HOME), ['nearctic', 'neotropics'], 'Mexico spans two regions');
  assert.deepEqual(resolvedArea(undefined, HOME), { kind: 'regions', ids: ['palearctic'] }, 'home is written out beside a name');
  assert.deepEqual(resolvedArea({ kind: 'regions', ids: [...ALL_REGION_IDS] }, HOME), { kind: 'world' });
  // Kept with the project and its backups.
  assert.deepEqual(parseSettings({ autoCull: true, autoEdit: false, speciesArea: { kind: 'country', code: 'VE' } }).speciesArea, { kind: 'country', code: 'VE' });
  assert.equal(parseSettings({ autoCull: true, autoEdit: false, speciesArea: { kind: 'nowhere' } }).speciesArea, undefined);
});

test('every country maps to the same regions as the table that built the species lists', async () => {
  const { realmsForCountries } = await import('../../tools/species/realms.mjs') as { realmsForCountries: (codes: string[]) => string[] };
  const regionOf: Record<string, string> = { PAL: 'palearctic', NA: 'nearctic', SA: 'neotropics', AF: 'afrotropics', OR: 'oriental', AU: 'australasia', PO: 'oceans' };
  assert.ok(SPECIES_COUNTRIES.length > 200);
  for (const code of SPECIES_COUNTRIES) {
    assert.deepEqual(regionsForCountry(code).sort(), realmsForCountries([code]).map((realm) => regionOf[realm]).sort(), code);
  }
  assert.deepEqual(regionsForCountry('VE'), ['neotropics']);
});

test('a new place reopens only photos carrying the app\'s own name; the person\'s names stay', () => {
  const frames = [
    { id: 'auto', subjectKind: 'wildlife', speciesChecked: true, tags: ['Yellowhammer'], autoTags: ['Yellowhammer'], speciesArea: { kind: 'regions' as const, ids: ['palearctic'] } },
    { id: 'none', subjectKind: 'wildlife', speciesChecked: true },
    { id: 'kept', subjectKind: 'wildlife', speciesChecked: true, tags: ['Saffron Finch'], autoTags: [] },
    { id: 'named', subjectKind: 'wildlife', speciesChecked: true, subjectNames: ['Saffron Finch'], tags: ['Saffron Finch'] },
    { id: 'plane', subjectKind: 'other', speciesChecked: true },
    { id: 'gone', subjectKind: 'wildlife', speciesChecked: true, removedAt: 1 },
  ];
  const { frames: next, reopened } = reopenForNewArea(frames);
  assert.equal(reopened, 2);
  assert.deepEqual(next[0], { id: 'auto', subjectKind: 'wildlife', speciesChecked: false, tags: [], autoTags: [] });
  assert.equal(next[1].speciesChecked, false);
  assert.equal(next[2], frames[2], 'a kept name is the person\'s');
  assert.equal(next[3], frames[3]);
  assert.equal(next[4], frames[4], 'not an animal');
  assert.equal(next[5], frames[5]);
});

test('a confident world match from outside home raises the question; a home bird or an unsure match does not', async () => {
  const { labelsOutsideRegions, outsideRegionMatch } = await import('./speciesArea');
  const outside = labelsOutsideRegions([world], HOME);
  assert.ok(outside.some((label) => label.scientific === 'Sicalis flaveola'), 'the Saffron Finch lives outside Europe only');
  assert.ok(!outside.some((label) => label.scientific === 'Erithacus rubecula'), 'the Robin is a home bird');
  assert.ok(!outside.some((label) => !label.regions?.length), 'unknown range is never "outside"');
  const homeLabels = speciesLabelsForRegions(shipped, world, [], HOME);
  const local = { labels: homeLabels, vectors: homeLabels.map(decodeVector) };
  const away = { labels: outside, vectors: outside.map(decodeVector) };
  const finch = world.find((label) => label.scientific === 'Sicalis flaveola')!;
  const robin = shipped.find((label) => label.scientific === 'Erithacus rubecula')!;
  const yellowhammer = shipped.find((label) => label.scientific === 'Emberiza citrinella')!;
  assert.equal(outsideRegionMatch(decodeVector(finch), local, away, ['bird'])?.scientific, 'Sicalis flaveola');
  assert.equal(outsideRegionMatch(decodeVector(robin), local, away, ['bird']), null, 'a home bird');
  assert.equal(outsideRegionMatch(blend(finch, yellowhammer, 0.5), local, away, ['bird']), null, 'torn between the two: not confident, not asked');
  assert.equal(outsideRegionMatch(decodeVector(finch), local, away, null), null, 'the gate was not sure of the group');
  assert.equal(outsideRegionMatch(decodeVector(finch), local, away, ['insect']), null, 'only birds and mammals are checked');
  // The question is kept with the project until it is answered.
  assert.deepEqual(parseSettings({ autoCull: false, autoEdit: false, speciesAreaPrompt: { example: 'Saffron Finch' } }).speciesAreaPrompt, { example: 'Saffron Finch' });
  assert.equal(parseSettings({ autoCull: false, autoEdit: false, speciesAreaPrompt: { example: 7 } }).speciesAreaPrompt, undefined);
});
