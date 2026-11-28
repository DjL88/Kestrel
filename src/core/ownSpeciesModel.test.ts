import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOwnSpecies, parseOwnSpeciesHead, type OwnSpeciesHead } from './ownSpeciesModel';
import { EMBED_MODEL } from './visualSimilarity';

const dims = EMBED_MODEL.dims;
const axis = (index: number, value = 1) => Array.from({ length: dims }, (_, i) => (i === index ? value : 0));
const head = (over: Partial<OwnSpeciesHead> = {}): OwnSpeciesHead => ({
  schema: 'kestrel-own-species-head/1',
  base: { id: EMBED_MODEL.id, licence: 'Apache-2.0', dims, sha256: EMBED_MODEL.sha256 },
  kind: 'prototype',
  labels: [{ common: 'Kingfisher', scientific: 'Alcedo atthis' }, { common: 'Dipper', scientific: 'Cinclus cinclus' }],
  W: [axis(0, 30), axis(1, 30)],
  b: [0, 0],
  minConfidence: 0.8,
  minSimilarity: 0.4,
  trainedOn: { frames: 10, shoots: 4, labelsConfirmed: false },
  ...over,
});
const vec = (...pairs: [number, number][]) => { const v = new Float32Array(dims); pairs.forEach(([i, x]) => { v[i] = x; }); return v; };

test('names a picture close to a trained species and marks unconfirmed labels as provisional', () => {
    const answer = classifyOwnSpecies(vec([0, 1]), head());
    assert.equal(answer?.guess.common, 'Kingfisher');
    assert.ok((answer?.guess.probability ?? 0) > 0.99);
    assert.equal(answer?.provisional, true);
    assert.equal(classifyOwnSpecies(vec([0, 1]), head({ trainedOn: { frames: 10, shoots: 4, labelsConfirmed: true } }))?.provisional, false);
  });

test('abstains when the head\'s own "not in list" class wins', () => {
  const withOther = head({ labels: [...head().labels, { common: 'Not in list', scientific: '' }], W: [axis(0, 30), axis(1, 30), axis(2, 30)], b: [0, 0, 0], otherIndex: 2 });
  assert.equal(classifyOwnSpecies(vec([2, 1]), withOther), null);
  assert.equal(classifyOwnSpecies(vec([0, 1]), withOther)?.guess.common, 'Kingfisher');
  assert.equal(parseOwnSpeciesHead({ ...withOther, otherIndex: 7 }), null);
});

test('abstains when two species are equally likely', () => {
    assert.equal(classifyOwnSpecies(vec([0, 1], [1, 1]), head()), null);
  });

test('abstains on a picture far from every trained species, however the shares fall', () => {
    // Mostly an unrelated direction with a slight lean to the first species: the share is high, the similarity is not.
    assert.equal(classifyOwnSpecies(vec([5, 1], [0, 0.2]), head({ minConfidence: 0.6 })), null);
  });

test('abstains on empty, non-finite or wrong-sized embeddings', () => {
    assert.equal(classifyOwnSpecies(new Float32Array(dims), head()), null);
    assert.equal(classifyOwnSpecies(vec([0, Number.NaN]), head()), null);
    assert.equal(classifyOwnSpecies(new Float32Array(10), head()), null);
  });

test('refuses a head made for another embedding model or with bad numbers', () => {
    assert.notEqual(parseOwnSpeciesHead(head()), null);
    assert.equal(parseOwnSpeciesHead(head({ base: { id: 'other', licence: 'x', dims, sha256: EMBED_MODEL.sha256 } })), null);
    assert.equal(parseOwnSpeciesHead(head({ base: { id: EMBED_MODEL.id, licence: 'x', dims, sha256: 'deadbeef' } })), null);
    assert.equal(parseOwnSpeciesHead(head({ W: [axis(0), [1, 2, 3]] })), null);
    assert.equal(parseOwnSpeciesHead(head({ b: [0, Number.NaN] })), null);
    assert.equal(parseOwnSpeciesHead(head({ minConfidence: 0 })), null);
    assert.equal(parseOwnSpeciesHead(head({ labels: [{ common: ' ', scientific: 'x' }, { common: 'b', scientific: 'y' }] })), null);
    assert.equal(parseOwnSpeciesHead(null), null);
    assert.equal(parseOwnSpeciesHead({ schema: 'nope' }), null);
  });

