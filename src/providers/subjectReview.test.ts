import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { finalSubjectSourceMatches } from './subjectReview';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const signal = () => new AbortController().signal;

test('unchanged immutable original remains valid after crop drawing', async () => {
  const original = new Blob(['original pixels']);
  assert.equal(await finalSubjectSourceMatches(original, sha('original pixels'), {
    isCurrent: () => true, read: async () => original,
  }, signal()), true);
});

test('same-sized replacement linked original fails final digest', async () => {
  assert.equal(await finalSubjectSourceMatches(new Blob(['ABCDEF']), sha('ABCDEF'), {
    isCurrent: () => true, read: async () => new Blob(['UVWXYZ']),
  }, signal()), false);
});

test('photo switch during final original read discards stale crops', async () => {
  const original = new Blob(['original pixels']);
  let current = true;
  assert.equal(await finalSubjectSourceMatches(original, sha('original pixels'), {
    isCurrent: () => current,
    read: async () => { current = false; return original; },
  }, signal()), false);
});

test('abort, unavailable original and read failure abstain', async () => {
  const original = new Blob(['original pixels']);
  const stopped = new AbortController();
  stopped.abort();
  assert.equal(await finalSubjectSourceMatches(original, sha('original pixels'), {
    isCurrent: () => true, read: async () => original,
  }, stopped.signal), false);
  assert.equal(await finalSubjectSourceMatches(original, sha('original pixels'), {
    isCurrent: () => true, read: async () => undefined,
  }, signal()), false);
  assert.equal(await finalSubjectSourceMatches(original, sha('original pixels'), {
    isCurrent: () => true, read: async () => { throw Error('offline NAS'); },
  }, signal()), false);
});
