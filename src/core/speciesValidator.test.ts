import assert from 'node:assert/strict';
import test from 'node:test';
import { checkValidatorLabels, compareSpecies } from './speciesValidator';
import type { SpeciesLabel, Suggestion } from './speciesMatch';
import { BIOCLIP2, OPTIONAL_MODELS, optionalModelFitsDevice } from './optionalModels';

const label = (common: string, scientific: string): SpeciesLabel => ({ common, scientific, group: 'bird', vector: '', scale: 1 });
const kingfisher = label('Common Kingfisher', 'Alcedo atthis');
const robin = label('European Robin', 'Erithacus rubecula');
const ranking = (...entries: Array<[SpeciesLabel, number]>): Suggestion[] => entries.map(([l, probability], index) => ({ index, label: l, probability }));

test('agreement only when the validator\'s own top pick is the same species (by scientific name)', () => {
  assert.deepEqual(compareSpecies({ ...kingfisher, common: 'Kingfisher' }, ranking([kingfisher, 0.9], [robin, 0.05])), { kind: 'agrees', name: 'Kingfisher' });
});

test('a clear different pick is a disagreement with both names, never a silent replacement', () => {
  assert.deepEqual(compareSpecies(kingfisher, ranking([robin, 0.7], [kingfisher, 0.2])), { kind: 'differs', suggested: 'Common Kingfisher', validator: 'European Robin' });
});

test('no clear answer from the validator, or nothing suggested, is unsure: it neither confirms nor contradicts', () => {
  assert.deepEqual(compareSpecies(kingfisher, ranking([robin, 0.25], [kingfisher, 0.24])), { kind: 'unsure' });
  assert.deepEqual(compareSpecies(kingfisher, []), { kind: 'unsure' });
  assert.deepEqual(compareSpecies(null, ranking([robin, 0.9])), { kind: 'unsure' });
});

test('the labels file must be BioCLIP 2 vectors (768 dimensions) with a UK list', () => {
  assert.throws(() => checkValidatorLabels({ model: 'bioclip', dimensions: 512, uk: [kingfisher], world: [] }));
  assert.throws(() => checkValidatorLabels(null));
  assert.equal(checkValidatorLabels({ version: 1, model: 'bioclip-2', dimensions: 768, uk: [kingfisher], world: [] }).uk.length, 1);
});

test('the validator pack is desktop-only, MIT weights, two pinned files', () => {
  assert.ok(OPTIONAL_MODELS.includes(BIOCLIP2));
  assert.equal(optionalModelFitsDevice(BIOCLIP2, 'phone'), false);
  assert.deepEqual(Object.keys(BIOCLIP2.files), ['model', 'labels']);
  for (const file of Object.values(BIOCLIP2.files)) assert.match(file.sha256, /^[0-9a-f]{64}$/);
});
