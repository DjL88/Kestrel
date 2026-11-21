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

test('a burst is the other shots of the same moment, and tagging one name covers them without touching anything else', async () => {
  const { burstMates, hasName, tagFrames } = await import('./speciesBurst');
  const { generateDemoShootFrames } = await import('./cullingEngine');
  const [a, b, c, d] = generateDemoShootFrames(4).map((frame, index) => ({ ...frame, burstGroupId: index < 3 ? 'burst-1' : null }));
  const frames = [a, { ...b, removedAt: 1 }, c, d];
  assert.deepEqual(burstMates(frames, a).map((frame) => frame.id), [c.id], 'removed photos and other bursts are left out');
  assert.deepEqual(burstMates(frames, d), [], 'a single frame has no burst');
  const tagged = tagFrames(frames, [c.id, d.id], 'Red kite', 'wildlife');
  assert.deepEqual(tagged[2].tags, ['Red kite']);
  assert.equal(tagged[2].subjectKind, 'wildlife');
  assert.equal(tagged[0], frames[0], 'photos not chosen are the same objects');
  const again = tagFrames(tagged, [c.id], 'red kite', 'people');
  assert.equal(again[2], tagged[2], 'a photo that already has the name is not changed');
  assert.equal(tagFrames([{ ...c, subjectKind: 'other' }], [c.id], 'Red kite', 'wildlife')[0].subjectKind, 'other', 'a kind you chose is kept');
  assert.equal(hasName({ subjectNames: ['Red Kite'] }, 'red kite'), true);
});

test('wrong-dimensional, zero or non-finite cached evidence is unknown, never a fabricated 100% name', () => {
  assert.deepEqual(rankSpecies(axis(0), labels, vectors.slice(0, 2)), []);
  assert.deepEqual(rankSpecies(axis(0), labels, vectors.map(() => axis(0, 4))), []);
  assert.deepEqual(rankSpecies(new Float32Array(8), labels, vectors), []);
  const broken = axis(0);
  broken[1] = Number.NaN;
  assert.deepEqual(rankSpecies(broken, labels, vectors), []);
  assert.deepEqual(rankSpecies(axis(0), labels, [axis(0), new Float32Array(8), ...vectors.slice(2)]), []);
  assert.deepEqual(rankSpecies(axis(0), [], []), []);
  assert.equal(pickSuggestions(rankSpecies(broken, labels, vectors)).length, 0);
});

test('normalisation remains finite even for huge but valid model values', async () => {
  const { normalise } = await import('./speciesMatch');
  const big = Float32Array.from([1e35, 1e35, -1e35, 0]);
  const unit = normalise(big);
  assert.ok(unit.every(Number.isFinite));
  assert.ok(Math.abs(unit[0] - Math.sqrt(1 / 3)) < 1e-6);
  assert.ok(Math.abs(unit[2] + Math.sqrt(1 / 3)) < 1e-6);
});

test('invalid stored scales and corrupt prior counts cannot manufacture a high-confidence species', () => {
  assert.throws(() => decodeVector({ vector: 'AA==', scale: 0 }), RangeError);
  assert.throws(() => decodeVector({ vector: 'AA==', scale: Number.NaN }), RangeError);
  const badCounts = { 'Red kite': Number.POSITIVE_INFINITY, 'Black kite': -1, 'Red fox': Number.NaN };
  assert.deepEqual(personalBonus(labels, badCounts), [0, 0, 0, 0]);
  assert.equal(recordAccepted(badCounts, 'Red kite')['Red kite'], 1);
  assert.equal(rankSpecies(axis(0), labels, vectors, [Number.NaN, Number.POSITIVE_INFINITY, -500, 0])[0].label.common, 'Red kite');
});

test('scene similarity rejects corrupt or dimension-mismatched embeddings instead of borrowing species tags', () => {
  const picture = axis(0);
  const other = [
    { id: 'same', embedding: axis(0) },
    { id: 'wrong-dimension', embedding: axis(0, 2) },
    { id: 'zero', embedding: new Float32Array(8) },
    { id: 'nan', embedding: Float32Array.from([Number.NaN, 1, 0, 0, 0, 0, 0, 0]) },
  ];
  assert.deepEqual(similarPhotos(picture, other), ['same']);
  assert.deepEqual(similarPhotos(picture, other, Number.NaN), []);
  assert.deepEqual(similarPhotos(new Float32Array(8), other), []);
});
