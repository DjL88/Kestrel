import test from 'node:test';
import assert from 'node:assert/strict';
import { scanExactDuplicates } from './cullDuplicateScan';
import type { PhotoFrame } from './types';
const photo = (id: string, decision: PhotoFrame['decision'] = 'unreviewed'): PhotoFrame => ({
  id, stableKey: id, filename: id + '.NEF', sequenceIndex: 1, decision, burstGroupId: null,
  burstIndex: 0, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file',
});
test('a keeper anchors rejection, and equal sizes alone do not prove duplicates', async () => {
  const keeper = photo('keeper', 'keep');
  const candidates = [photo('copy'), photo('different'), photo('second')];
  const blobs = new Map([['keeper',new Blob(['abcd'])],['copy',new Blob(['abcd'])],
    ['different',new Blob(['wxyz'])],['second',new Blob(['wxyz'])]]);
  const result = await scanExactDuplicates(candidates,[keeper,...candidates],k=>blobs.get(k)?.size,
    async k=>blobs.get(k),new AbortController().signal);
  assert.deepEqual([...result],['copy','second']);
});
test('RAW larger than 32 MiB is hashed by bounded slices', async () => {
  const size = 33 * 1024 * 1024;
  let largest = 0;
  const bytes = { size, slice(start: number, end: number) {
    largest = Math.max(largest,end-start);
    return { arrayBuffer: async () => new ArrayBuffer(end-start) };
  }};
  const candidates = [photo('a'), photo('b')];
  const result = await scanExactDuplicates(candidates,candidates,()=>size,async()=>bytes,new AbortController().signal);
  assert.deepEqual([...result],['b']);
  assert.ok(largest <= 1024*1024);
});
test('a substituted original cannot anchor a false match', async () => {
  const keeper = {...photo('keeper','keep'),originalSha256:'0'.repeat(64)};
  const candidate = photo('candidate');
  const result = await scanExactDuplicates([candidate],[keeper,candidate],()=>4,async()=>new Blob(['abcd']),new AbortController().signal);
  assert.equal(result.size,0);
});
