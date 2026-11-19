import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GATE_MASS, ROUTER_THRESHOLDS, routeSubject, routeWording, speciesGate, type Taxonomy } from './subjectRouter';
import { SUBJECT_CLASSES } from './objectDetection';
import { SUBJECT_KINDS } from './subjectTags';

const taxonomy = JSON.parse(readFileSync('src/assets/subject/taxonomy.json', 'utf8')) as Taxonomy;
const { categories } = taxonomy;
const index = (id: string) => categories.findIndex((category) => category.id === id);

/** One axis per category: a perfectly separable stand-in for the real text vectors. */
const vectors = categories.map((_, i) => Float32Array.from({ length: categories.length }, (_, j) => (i === j ? 1 : 0)));
/** A picture that looks mostly like `weights` (category id to share), as a unit vector with a little noise. */
function picture(weights: Record<string, number>) {
  const v = new Float32Array(categories.length).fill(0.01);
  for (const [id, share] of Object.entries(weights)) v[index(id)] += share;
  return v;
}

test('the taxonomy is well formed: unique ids, known groups and kinds, enough prompts, real detector classes', () => {
  const ids = categories.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(categories.length >= 50, 'broad coverage');
  const kinds = new Set(SUBJECT_KINDS.map((k) => k.id));
  const detectorLabels = new Set(Object.values(SUBJECT_CLASSES));
  for (const c of categories) {
    assert.ok(taxonomy.groups.includes(c.group), `${c.id}: group`);
    assert.ok(kinds.has(c.kind), `${c.id}: kind`);
    assert.ok(c.prompts.length >= 2 && c.prompts.every((p) => p.trim().length > 8), `${c.id}: prompts`);
    for (const label of c.detector) assert.ok(detectorLabels.has(label), `${c.id}: the detector never reports "${label}"`);
    assert.ok([null, 'species', 'aircraft', 'car', 'boat'].includes(c.identify), `${c.id}: identify`);
  }
});

test('vehicles, buildings and scenery are never in the animal group, and only animals route to the species list', () => {
  const byId = (id: string) => categories[index(id)];
  for (const id of ['helicopter', 'airliner', 'military-jet', 'drone', 'car', 'train', 'ship-boat', 'architecture', 'mountain', 'food', 'moon']) {
    assert.ok(byId(id), id);
    assert.notEqual(byId(id).group, 'animal', id);
    assert.notEqual(byId(id).identify, 'species', id);
  }
  for (const c of categories.filter((x) => x.identify === 'species')) assert.equal(c.group, 'animal');
  assert.equal(byId('helicopter').identify, 'aircraft');
  assert.equal(byId('car').identify, 'car');
});

test('a helicopter is called a helicopter, and the species step is blocked', () => {
  const result = routeSubject(picture({ helicopter: 1, bird: 0.15 }), vectors, categories);
  assert.equal(result.category?.id, 'helicopter');
  assert.equal(speciesGate(result), 'block');
  assert.match(routeWording(result), /^(Likely|Possibly) helicopter$/);
});

test('a bird whose probability is split across bird, raptor and waterbird is still allowed', () => {
  const result = routeSubject(picture({ bird: 0.6, 'bird-of-prey': 0.6, waterbird: 0.6 }), vectors, categories);
  assert.ok(result.top[0].probability < 0.6, 'no single bird category wins outright');
  assert.ok(result.speciesProbability >= GATE_MASS.allow);
  assert.equal(speciesGate(result), 'allow');
});

test('a picture that is half bird and half helicopter is not guessed: it is strict, not blocked and not allowed', () => {
  const result = routeSubject(picture({ bird: 1, helicopter: 1 }), vectors, categories);
  assert.equal(result.confident, false);
  assert.equal(result.category, null);
  assert.equal(speciesGate(result), 'strict');
  assert.match(routeWording(result), /^(Possibly|Unsure) /);
});

test('pets and farm animals are animals the species list does not cover, so they are strict, never allowed or blocked', () => {
  assert.equal(speciesGate(routeSubject(picture({ dog: 1 }), vectors, categories)), 'strict');
  assert.equal(speciesGate(routeSubject(picture({ 'farm-animal': 1 }), vectors, categories)), 'strict');
});

test('landscapes and buildings are blocked from animal names', () => {
  for (const id of ['mountain', 'architecture', 'sunset', 'food', 'night-sky']) {
    assert.equal(speciesGate(routeSubject(picture({ [id]: 1 }), vectors, categories)), 'block', id);
  }
});

test('with no router model the gate leaves today\'s behaviour alone', () => {
  assert.equal(speciesGate(null), 'allow');
});

test('a detector that saw an aeroplane breaks a tie towards aircraft, but cannot override a clear picture', () => {
  const tie = picture({ airliner: 1, bird: 1 });
  const withDetector = routeSubject(tie, vectors, categories, [{ label: 'aeroplane', score: 0.9 }]);
  assert.equal(withDetector.best.id, 'airliner');
  const clearBird = picture({ bird: 1 });
  const stillBird = routeSubject(clearBird, vectors, categories, [{ label: 'aeroplane', score: 0.99 }]);
  assert.equal(stillBird.best.group, 'animal');
  const weak = routeSubject(tie, vectors, categories, [{ label: 'aeroplane', score: ROUTER_THRESHOLDS.detectorMinimumScore - 0.1 }]);
  assert.ok(Math.abs(weak.top[0].probability - weak.top[1].probability) < 0.05, 'a weak detection is ignored');
});

test('a detector wrongly calling a helicopter a bird cannot drag a clear helicopter back to a bird', () => {
  const result = routeSubject(picture({ helicopter: 1, bird: 0.2 }), vectors, categories, [{ label: 'bird', score: 0.9 }]);
  assert.equal(result.best.id, 'helicopter');
  assert.equal(speciesGate(result), 'block');
});

test('bad input is refused, never guessed from', () => {
  assert.throws(() => routeSubject(picture({ bird: 1 }), vectors.slice(1), categories), RangeError);
  assert.throws(() => routeSubject(new Float32Array(3), vectors, categories), RangeError);
  const bad = picture({ bird: 1 });
  bad[0] = Number.NaN;
  assert.throws(() => routeSubject(bad, vectors, categories), RangeError);
  assert.throws(() => routeSubject(picture({ bird: 1 }), [], []), RangeError);
});


test('corrupt or degenerate embeddings cannot produce a confident wildlife or aircraft label', () => {
  const bird = picture({ bird: 1 });
  const invalidVectors = vectors.map((vector) => Float32Array.from(vector));
  invalidVectors[index('helicopter')][0] = Number.NaN;
  assert.throws(() => routeSubject(bird, invalidVectors, categories), RangeError);
  invalidVectors[index('helicopter')][0] = Number.POSITIVE_INFINITY;
  assert.throws(() => routeSubject(bird, invalidVectors, categories), RangeError);
  invalidVectors[index('helicopter')].fill(0);
  assert.throws(() => routeSubject(bird, invalidVectors, categories), RangeError);
  assert.throws(() => routeSubject(new Float32Array(bird.length), vectors, categories), RangeError);
});

test('corrupt detector scores never bias bird versus aircraft routing', () => {
  const tie = picture({ bird: 1, helicopter: 1 });
  const baseline = routeSubject(tie, vectors, categories);
  for (const score of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.1]) {
    const actual = routeSubject(tie, vectors, categories, [{ label: 'bird', score }]);
    assert.equal(actual.best.id, baseline.best.id);
    assert.equal(actual.confident, baseline.confident);
    assert.equal(speciesGate(actual), 'strict');
  }
});

test('high top probability with insufficient margin never reads as a likely subject', () => {
  // A top probability of at least 0.8 always leaves a margin of at least 0.6, and here it is about 1, so a required
  // margin above 1 can never be met: the route must stay unconfident however strong the top score is.
  const ambiguous = routeSubject(picture({ bird: 1 }), vectors, categories, [], {
    ...ROUTER_THRESHOLDS, minimumMargin: 1.01,
  });
  assert.ok(ambiguous.probability >= 0.8, 'top category is numerically strong');
  assert.equal(ambiguous.confident, false, 'the required separation is not met');
  assert.equal(ambiguous.category, null);
  assert.match(routeWording(ambiguous), /^Possibly /);
  assert.doesNotMatch(routeWording(ambiguous), /^Likely /);

  const confidentAircraft = routeSubject(picture({ helicopter: 1 }), vectors, categories);
  assert.equal(confidentAircraft.confident, true);
  assert.match(routeWording(confidentAircraft), /^Likely helicopter$/);
  assert.equal(speciesGate(confidentAircraft), 'block');
});

test('finite extreme-magnitude embeddings keep finite probabilities and conservative species gating', () => {
  // All inputs are finite. The former unscaled dot/norm implementation overflowed
  // to Infinity, producing NaN probabilities and an invalid confident result.
  const largePicture = Float64Array.from(picture({ helicopter: 1 }), (value) => value * 1e200);
  const largeVectors = vectors.map((vector) => Float64Array.from(vector, (value) => value * 1e200));
  const result = routeSubject(largePicture, largeVectors, categories);
  assert.equal(result.best.id, 'helicopter');
  assert.equal(result.category?.id, 'helicopter');
  assert.equal(speciesGate(result), 'block');
  assert.ok(Number.isFinite(result.probability));
  assert.ok(Number.isFinite(result.margin));
  assert.ok(result.top.every((entry) => Number.isFinite(entry.probability)));
  assert.equal(result.confident, true);
});
