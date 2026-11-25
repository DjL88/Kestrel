import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { familyFallback } from './autoTags';
import type { SpeciesLabel, Suggestion } from './speciesMatch';
import { buildSpeciesNameIndex, displaySpeciesName } from './speciesNames';

const label = (common: string, family?: string): SpeciesLabel => ({ common, scientific: `${common} sp`, group: 'bird', vector: '', scale: 1, family });
const ranked = (entries: [string, string | undefined, number][]): Suggestion[] =>
  entries.map(([common, family, probability], index) => ({ index, label: label(common, family), probability }));

test('an uncertain species can still be named by its family, when the family together is certain', () => {
  const owls = ranked([['Tawny Owl', 'Owls', 0.45], ['Ural Owl', 'Owls', 0.4], ['Little Owl', 'Owls', 0.05], ['Kestrel', 'Falcons', 0.1]]);
  const found = familyFallback(owls);
  assert.equal(found?.family, 'Owls');
  assert.ok(Math.abs((found?.probability ?? 0) - 0.9) < 1e-9);
});

test('unknown stays unknown: no family stands out, or the family is one name in disguise, or the family is missing', () => {
  assert.equal(familyFallback(ranked([['Tawny Owl', 'Owls', 0.4], ['Ural Owl', 'Owls', 0.3], ['Kestrel', 'Falcons', 0.3]])), undefined, 'owls only 70%');
  assert.equal(familyFallback(ranked([['Dipper', 'Dippers', 0.9], ['Kestrel', 'Falcons', 0.1]])), undefined, 'one-member family');
  assert.equal(familyFallback(ranked([['Tawny Owl', undefined, 0.5], ['Ural Owl', undefined, 0.5]])), undefined, 'no family recorded');
  assert.equal(familyFallback([]), undefined);
});

test('a family name is shown in the person’s language: the scientific family where the source has no local name', () => {
  const index = JSON.parse(readFileSync('public/models/species-names/index.json', 'utf8')) as { families: [string, string][] };
  const owls = index.families.find(([, english]) => english === 'Owls');
  assert.deepEqual(owls, ['Strigidae', 'Owls']);
  const table = { source: 't', attribution: 't', language: 'de', names: index.families.map(([s, e]): [string, string, string | null] => [s, e, null]) };
  assert.equal(displaySpeciesName('Owls', buildSpeciesNameIndex('de', [table])).name, 'Strigidae');
  assert.equal(displaySpeciesName('Owls', buildSpeciesNameIndex('en-GB', [table])).name, 'Owls');
});
