import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fetchPinned, LENSFUN_COMMIT, LENSFUN_DOWNLOAD_BYTES, LENSFUN_FILES } from './lensProfileStore';

test('the download list is pinned to one lensfun commit with a digest and size for every file', () => {
  assert.match(LENSFUN_COMMIT, /^[0-9a-f]{40}$/);
  assert.ok(LENSFUN_FILES.length > 40);
  for (const [name, sha, bytes] of LENSFUN_FILES) {
    assert.match(name, /^[a-z0-9-]+$/);
    assert.match(sha, /^[0-9a-f]{64}$/);
    assert.ok(bytes > 0);
  }
  assert.ok(LENSFUN_DOWNLOAD_BYTES > 3e6 && LENSFUN_DOWNLOAD_BYTES < 8e6, 'about 5 MB, as the UI says');
});

test('a file is kept only when it is exactly the pinned bytes, fetched without credentials', async () => {
  const body = '<lensdatabase version="2"></lensdatabase>';
  const sha = createHash('sha256').update(body).digest('hex');
  let seen: { url: string; init?: RequestInit } | null = null;
  const fetcher = (async (url: string, init?: RequestInit) => { seen = { url, init }; return new Response(body); }) as unknown as typeof fetch;
  assert.equal(await fetchPinned('generic', sha, body.length, fetcher), body);
  assert.equal(seen!.url, `https://raw.githubusercontent.com/lensfun/lensfun/${LENSFUN_COMMIT}/data/db/generic.xml`);
  assert.equal(seen!.init?.credentials, 'omit');
  await assert.rejects(fetchPinned('generic', sha.replace(/^./, sha[0] === 'a' ? 'b' : 'a'), body.length, fetcher), /did not match/);
  await assert.rejects(fetchPinned('generic', sha, body.length + 1, fetcher), /did not match/);
  const missing = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(fetchPinned('generic', sha, 1, missing), /could not be downloaded/);
});
