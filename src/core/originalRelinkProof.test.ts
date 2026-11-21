import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { planVerifiedRelinks } from './originalRelinkProof';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const original = (id: string, data: string) => ({
  photoId: id, byteLength: Buffer.byteLength(data), sha256: hash(data),
});
const candidate = (id: string, data: string, key = 'volume/' + id) => ({
  ...original(id, data), candidateKey: key,
});

test('accepts only complete byte-identical original evidence', () => {
  assert.deepEqual(planVerifiedRelinks([original('bird', 'RAW bytes')], [candidate('bird', 'RAW bytes')]), {
    ok: true, matches: [{ photoId: 'bird', candidateKey: 'volume/bird' }],
  });
});

test('rejects same-size replacement with a different digest', () => {
  const result = planVerifiedRelinks([original('bird', 'osprey')], [candidate('bird', 'copier')]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failures[0].reason, 'original-content-mismatch');
});

test('refuses missing, extra and duplicate identities', () => {
  const o = [original('a', 'a'), original('b', 'b')];
  assert.equal(planVerifiedRelinks(o, [candidate('a', 'a')]).ok, false);
  assert.equal(planVerifiedRelinks(o, [candidate('a', 'a'), candidate('b', 'b'), candidate('c', 'c')]).ok, false);
  assert.equal(planVerifiedRelinks(o, [candidate('a', 'a'), candidate('a', 'a'), candidate('b', 'b')]).ok, false);
});

test('refuses one physical candidate reused for two photo IDs', () => {
  assert.equal(planVerifiedRelinks(
    [original('a', 'same'), original('b', 'same')],
    [candidate('a', 'same', 'drive/one'), candidate('b', 'same', 'drive/one')],
  ).ok, false);
});

test('refuses malformed hashes, unsafe IDs and unverified lengths', () => {
  assert.equal(planVerifiedRelinks([{ photoId: 'a', byteLength: 1, sha256: 'unknown' }], []).ok, false);
  assert.equal(planVerifiedRelinks([original('a ', 'a')], [candidate('a ', 'a')]).ok, false);
  assert.equal(planVerifiedRelinks([original('a', 'a')], [{ ...candidate('a', 'a'), byteLength: -1 }]).ok, false);
});

test('500 synthetic originals: one changed candidate rejects the entire batch', () => {
  const originals = Array.from({ length: 500 }, (_, i) => original('p' + i, 'raw-' + i));
  const candidates = originals.map((o, i) => candidate(o.photoId, 'raw-' + i));
  assert.equal(planVerifiedRelinks(originals, candidates).ok, true);
  candidates[379] = candidate('p379', 'fake379');
  const result = planVerifiedRelinks(originals, candidates);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.failures.some(f => f.photoId === 'p379'));
});
