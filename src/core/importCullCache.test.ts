import test from 'node:test';
import assert from 'node:assert/strict';
import { ImportCullCache } from './importCullCache';
import type { CullPreviewEvidence } from './importCullCache';

const image = { id: 'import-a-file-3', stableKey: 'local-file://bird.nef::900::123' };
const info = { size: 900, lastModified: 123 };
const evidence: CullPreviewEvidence = {
  result: { frameId: image.id, decision: 'keep', confidence: 'high', score: 91, reason: 'subjectSharp' },
  base: { frameId: image.id, decision: 'keep', confidence: 'high', score: 93, reason: 'clearDetail' },
};

test('a completed model observation is reused only for the exact project, photo, source version and model', () => {
  const cache = new ImportCullCache('birds', 'import-a', 'sha:model');
  cache.put(image, info, evidence);
  assert.strictEqual(cache.get('birds', image, info, 'sha:model'), evidence);
  assert.equal(cache.get('other', image, info, 'sha:model'), undefined);
  assert.equal(cache.get('birds', image, info, 'changed-model'), undefined);
  assert.equal(cache.get('birds', { ...image, stableKey: 'other.nef' }, info, 'sha:model'), undefined);
  assert.equal(cache.get('birds', { ...image, id: 'import-a-file-4' }, info, 'sha:model'), undefined);
  assert.equal(cache.get('birds', image, { size: 901, lastModified: 123 }, 'sha:model'), undefined);
  assert.equal(cache.get('birds', image, { size: 900, lastModified: 124 }, 'sha:model'), undefined);
});

test('unknown or malformed source versions and unrelated imports are never cached', () => {
  const cache = new ImportCullCache('birds', 'import-a', 'sha:model');
  cache.put(image, { size: 0, lastModified: 123 }, evidence);
  cache.put(image, { size: 900 }, evidence);
  cache.put(image, { size: 900, lastModified: NaN }, evidence);
  cache.put({ ...image, id: 'import-b-file-3' }, info,
    { result: { ...evidence.result, frameId: 'import-b-file-3' } });
  cache.put(image, info, { result: { ...evidence.result, frameId: 'different' } });
  assert.equal(cache.size, 0);
  cache.put(image, info, evidence);
  assert.equal(cache.size, 1);
  assert.equal(cache.get('birds', image, { size: 900 }, 'sha:model'), undefined);
});

test('failure invalidates all early model results and cannot be reversed by late completions', () => {
  const cache = new ImportCullCache('birds', 'import-a', 'sha:model');
  cache.put(image, info, evidence);
  cache.failDetector();
  assert.equal(cache.size, 0);
  assert.equal(cache.usable, false);
  cache.put(image, info, evidence);
  assert.equal(cache.get('birds', image, info, 'sha:model'), undefined);
});

test('missing previews are retried, and cache has bounded memory', () => {
  const cache = new ImportCullCache('birds', 'import-a', 'sha:model', 2);
  cache.put(image, info, { result: { ...evidence.result, reason: 'unavailable', decision: null } });
  assert.equal(cache.size, 0);
  for (let index = 0; index < 3; index++) {
    const target = { ...image, id: `import-a-file-${index}` };
    cache.put(target, info, { result: { ...evidence.result, frameId: target.id } });
  }
  assert.equal(cache.size, 2);
  assert.equal(cache.get('birds', { ...image, id: 'import-a-file-0' }, info, 'sha:model'), undefined);
  assert.ok(cache.get('birds', { ...image, id: 'import-a-file-2' }, info, 'sha:model'));
  cache.clear();
  assert.equal(cache.size, 0);
});
