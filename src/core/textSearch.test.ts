import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeVector, isSearchable, mergeMatches, normaliseQuery, rankByQuery, readVector, searchNote } from './textSearch';

const unit = (...v: number[]) => { const n = Math.hypot(...v); return Float32Array.from(v.map((x) => x / n)); };

test('queries are normalised and tiny ones are not sent to the model', () => {
  assert.equal(normaliseQuery('  Red   CAR '), 'red car');
  assert.equal(isSearchable('ab'), false);
  assert.equal(isSearchable('owl'), true);
});

test('a stored vector round-trips closely and a foreign or damaged one is ignored', () => {
  const v = unit(...Array.from({ length: 512 }, (_, i) => Math.sin(i)));
  const back = readVector(encodeVector(v))!;
  let dot = 0; for (let i = 0; i < 512; i += 1) dot += v[i] * back[i];
  assert.ok(dot > 0.999);
  assert.equal(readVector({ ...encodeVector(v), model: 'other' }), null);
  assert.equal(readVector({ v: '!!', scale: 1, model: 'clip-vit-b32' }), null);
  assert.equal(readVector(undefined), null);
});

test('ranking keeps only close matches, best first, and may be empty', () => {
  const q = unit(1, 0);
  const photos = [
    { id: 'far', vector: unit(0, 1) },
    { id: 'near', vector: unit(1, 0.1) },
    { id: 'best', vector: unit(1, 0) },
    { id: 'none', vector: null },
  ];
  assert.deepEqual(rankByQuery(q, photos).map((s) => s.id), ['best', 'near']);
  assert.deepEqual(rankByQuery(q, [{ id: 'far', vector: unit(0, 1) }]), []);
});

test('merge puts picture matches first and keeps word matches', () => {
  const all = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(mergeMatches([all[0]], all, [{ id: 'c', score: 0.3 }]).map((f) => f.id), ['c', 'a']);
  assert.deepEqual(mergeMatches([all[0]], all, []).map((f) => f.id), ['a']);
});

test('notes are plain words', () => {
  assert.match(searchNote('preparing', 2, 9), /2 of 9/);
  assert.equal(searchNote('ready', 0, 0), '');
});
