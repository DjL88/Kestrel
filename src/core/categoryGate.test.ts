import { test } from 'node:test';
import assert from 'node:assert/strict';
import taxonomy from '../assets/subject/taxonomy.json' with { type: 'json' };
import vectorFile from '../assets/subject/vectors.json' with { type: 'json' };
import { gateOutcome, gateVectors } from './categoryGate';
import { routeSubject, type SubjectCategory } from './subjectRouter';

const categories = taxonomy.categories as SubjectCategory[];
const vectors = gateVectors(vectorFile, categories);
const at = (id: string) => vectors[categories.findIndex((category) => category.id === id)];
/** A picture that looks exactly like one category's description. */
const route = (picture: Float32Array) => routeSubject(picture, vectors, categories);

test('the committed vectors cover every category in the taxonomy', () => {
  assert.equal(vectors.length, categories.length);
  assert.ok(vectors.every((vector) => vector.length === vectorFile.dim && vector.some((value) => value !== 0)));
  assert.throws(() => gateVectors({ dim: vectorFile.dim, vectors: {} }, categories), RangeError);
});

test('a helicopter is never handed to the species step, and is not made wildlife', () => {
  const outcome = gateOutcome(route(at('helicopter')), undefined);
  assert.equal(outcome.species, 'block');
  assert.equal(outcome.kind, undefined);
  // Even when someone marked the photo Wildlife by mistake, no animal name is offered.
  assert.equal(gateOutcome(route(at('helicopter')), 'wildlife').species, 'block');
});

test('a clear bird makes an unclassified photo wildlife, so it gets species suggestions without hand-marking', () => {
  const outcome = gateOutcome(route(at('bird')), undefined);
  assert.equal(outcome.species, 'allow');
  assert.equal(outcome.kind, 'wildlife');
});

test('a kind the person chose always wins', () => {
  assert.equal(gateOutcome(route(at('bird')), 'other').kind, undefined);
  assert.equal(gateOutcome(route(at('bird')), 'people').kind, undefined);
});

test('without the gate model, behaviour is exactly as before', () => {
  assert.deepEqual(gateOutcome(null, undefined), { species: 'allow' });
  assert.deepEqual(gateOutcome(null, 'wildlife'), { species: 'allow' });
});

test('a picture halfway between a bird and a helicopter is not classified', () => {
  const blend = Float32Array.from(at('bird'), (value, i) => value + at('helicopter')[i]);
  const outcome = gateOutcome(route(blend), undefined);
  assert.equal(outcome.kind, undefined, 'unknown stays unknown');
  assert.notEqual(outcome.species, 'allow');
});

test('aircraft and non-animal evidence cannot be promoted to a species by a manual Wildlife kind', () => {
  // Closed-list animal embeddings must never override independent negative subject evidence.
  for (const id of ['helicopter', 'airliner', 'military-jet', 'drone', 'car', 'architecture', 'mountain']) {
    const evidence = route(at(id));
    assert.equal(gateOutcome(evidence, 'wildlife').species, 'block', id);
    assert.equal(gateOutcome(evidence, undefined).kind, undefined, id);
  }
});

test('an ambiguous aircraft-versus-bird route never qualifies for ordinary automatic species suggestions', () => {
  const blend = Float32Array.from(at('bird'), (value, i) => value + at('helicopter')[i]);
  const evidence = route(blend);
  assert.notEqual(gateOutcome(evidence, 'wildlife').species, 'allow');
  assert.equal(gateOutcome(evidence, undefined).kind, undefined);
  // The user may keep Wildlife manually; the classifier cannot silently change it.
  assert.equal(gateOutcome(evidence, 'wildlife').kind, undefined);
});
