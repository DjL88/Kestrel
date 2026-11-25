import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropSourceUrls } from './previewInvalidation';

const frames = [
  { id: 'a', stableKey: 'k1' },
  { id: 'a-copy', stableKey: 'k1' },
  { id: 'b', stableKey: 'k2' },
];

test('drops revoked preview and thumbnail URLs for every photo sharing the original', () => {
  const urls = {
    a: { thumb: 'blob:t-a', preview: 'blob:p-a' },
    'a-copy': { thumb: 'blob:t-a2', preview: 'blob:p-a' },
    b: { thumb: 'blob:t-b', preview: 'blob:p-b' },
  };
  const result = dropSourceUrls(urls, frames, 'k1');
  assert.deepEqual(result.frameIds.sort(), ['a', 'a-copy']);
  assert.deepEqual(result.urls.a, {});
  assert.deepEqual(result.urls['a-copy'], {});
  assert.deepEqual(result.urls.b, { thumb: 'blob:t-b', preview: 'blob:p-b' });
});

test('keeps a recorded failure so an unavailable original still says so', () => {
  const result = dropSourceUrls({ a: { thumb: 'blob:t', failed: true } }, frames, 'k1');
  assert.deepEqual(result.urls.a, { failed: true });
});

test('returns the same object when nothing belongs to that original', () => {
  const urls = { b: { thumb: 'blob:t-b' } };
  const result = dropSourceUrls(urls, frames, 'k1');
  assert.equal(result.urls, urls);
  assert.deepEqual(result.frameIds, []);
});
