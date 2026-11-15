import test from 'node:test';
import assert from 'node:assert/strict';
import { confidenceWord, decodeVector, kindFor, personalBonus, pickSuggestions, quantiseVector, rankSpecies, recordAccepted, similarPhotos, similarity, type SpeciesLabel } from './speciesMatch';

const axis = (index: number, size = 8, value = 1) => Float32Array.from({ length: size }, (_, position) => (position === index ? value : 0));
const label = (common: string, group: SpeciesLabel['group'], vector: Float32Array): SpeciesLabel => ({ common, scientific: common, group, ...quantiseVector(vector) });
const labels = [label('Red kite', 'bird', axis(0)), label('Black kite', 'bird', axis(1)), label('Red fox', 'mammal', axis(2)), label('Human', 'other', axis(3))];
const vectors = labels.map(decodeVector);

test('vectors survive being stored as int8 with one scale', () => {
  const original = Float32Array.from([0.5, -0.25, 0.1, 0, -0.5]);
  const back = decodeVector({ ...quantiseVector(original) });
  original.forEach((value, index) => assert.ok(Math.abs(value - back[index]) < 0.005));
  assert.ok(similarity(original, back) > 0.9999);
});

test('the closest name wins and the odds add up to one', () => {
  const ranked = rankSpecies(Float32Array.from([1, 0.2, 0, 0, 0, 0, 0, 0]), labels, vectors);
  assert.equal(ranked[0].label.common, 'Red kite');
  assert.ok(Math.abs(ranked.reduce((sum, entry) => sum + entry.probability, 0) - 1) < 1e-6);
  assert.ok(ranked[0].probability > 0.9);
});

test('a photo that matches no name well gives no suggestion rather than a bad guess', () => {
  const vague = Float32Array.from([1, 1, 1, 1, 0, 0, 0, 0]);
  assert.deepEqual(pickSuggestions(rankSpecies(vague, labels, vectors)), []);
  const clear = pickSuggestions(rankSpecies(Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0]), labels, vectors));
  assert.equal(clear.length, 1, 'only names that are close behind the best are offered too');
  const close = pickSuggestions(rankSpecies(Float32Array.from([1, 0.99, 0, 0, 0, 0, 0, 0]), labels, vectors));
  assert.deepEqual(close.map((entry) => entry.label.common), ['Red kite', 'Black kite']);
});

test('confidence is put in words', () => {
  assert.equal(confidenceWord(0.95), 'likely');
  assert.equal(confidenceWord(0.5), 'possible');
  assert.equal(confidenceWord(0.2), 'unsure');
});

test('animals mean wildlife, a person means people, and pets are left for you to place', () => {
  assert.equal(kindFor({ common: 'Red kite', group: 'bird' }), 'wildlife');
  assert.equal(kindFor({ common: 'Red fox', group: 'mammal' }), 'wildlife');
  assert.equal(kindFor({ common: 'Human', group: 'other' }), 'people');
  assert.equal(kindFor({ common: 'Domestic cat', group: 'mammal' }), 'other');
});

test('names accepted before rise gently and can tip a near tie, but never beat a clear match', () => {
  const tie = Float32Array.from([1, 0.99, 0, 0, 0, 0, 0, 0]);
  assert.equal(rankSpecies(tie, labels, vectors)[0].label.common, 'Red kite');
  let counts = {};
  for (let i = 0; i < 6; i += 1) counts = recordAccepted(counts, 'Black kite');
  const bonus = personalBonus(labels, counts);
  assert.ok(bonus[1] > 0 && bonus[1] <= 1.5 && bonus[0] === 0);
  assert.equal(rankSpecies(tie, labels, vectors, bonus)[0].label.common, 'Black kite');
  const clearlyKite = Float32Array.from([1, 0.3, 0, 0, 0, 0, 0, 0]);
  assert.equal(rankSpecies(clearlyKite, labels, vectors, bonus)[0].label.common, 'Red kite');
});

test('near-identical photos are found for one correction to cover a whole burst', () => {
  const others = [{ id: 'burst-2', embedding: Float32Array.from([1, 0.05, 0, 0]) }, { id: 'other', embedding: Float32Array.from([0, 1, 0, 0]) }];
  assert.deepEqual(similarPhotos(Float32Array.from([1, 0, 0, 0]), others), ['burst-2']);
});
