import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCullEvidence, finaliseCullEvidence } from './cullEvidenceFinal';
import type { CullSuggestion } from './autoCull';

const subject = (frameId: string): CullSuggestion => ({
  frameId, decision: 'keep', confidence: 'high', score: 95, reason: 'subjectSharp',
});
const preview = (frameId: string): CullSuggestion => ({
  frameId, decision: 'keep', confidence: 'high', score: 93, reason: 'clearDetail',
});

test('preview analysis can begin and finish while duplicate hashing is still in progress', async () => {
  let releaseHashes: (() => void) | undefined;
  let analysisStarted = false;
  let hashesStarted = false;
  const hashes = new Promise<ReadonlySet<string>>((resolve) => {
    releaseHashes = () => resolve(new Set(['dup']));
  });
  const pending = collectCullEvidence(async () => {
    analysisStarted = true;
    return [subject('bird')];
  }, async () => {
    hashesStarted = true;
    return hashes;
  });
  assert.equal(analysisStarted, true);
  assert.equal(hashesStarted, true);
  // No final result until both the duplicate and photo evidence exist.
  let settled = false;
  void pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  releaseHashes!();
  const result = await pending;
  assert.deepEqual(result.analysis.map((item) => item.frameId), ['bird']);
  assert.deepEqual([...result.duplicates], ['dup']);
});

test('duplicate outcome wins over a sharp or unavailable preview, in candidate order', () => {
  const input = new Map([
    ['bird', subject('bird')],
    ['dup', subject('dup')],
    ['offline', { frameId: 'offline', decision: null, confidence: 'low', score: 0, reason: 'unavailable' } as CullSuggestion],
  ]);
  const result = finaliseCullEvidence(
    ['offline', 'dup', 'bird'], input, new Set(['dup']), new Map([...input].filter(([key]) => key !== 'offline')), true,
  );
  assert.deepEqual(result.map((item) => item.frameId), ['offline', 'dup', 'bird']);
  assert.deepEqual([result[1].decision, result[1].confidence, result[1].reason], ['reject', 'high', 'duplicate']);
  assert.equal(result[0].decision, null);
  assert.equal(input.get('dup')!.decision, 'keep', 'source suggestion remains unchanged');
});

test('a detector failure downgrades earlier model findings but never verified duplicates', () => {
  const base = new Map([['bird', preview('bird')], ['dup', preview('dup')]]);
  const results = finaliseCullEvidence(
    ['bird', 'dup'], new Map([['bird', subject('bird')], ['dup', subject('dup')]]),
    new Set(['dup']), base, false,
  );
  assert.deepEqual([results[0].decision, results[0].confidence], [null, 'medium']);
  assert.deepEqual([results[1].decision, results[1].reason], ['reject', 'duplicate']);
});

test('fallback population ignores preview-scored duplicates exactly as earlier fast path did', () => {
  const without = { frameId: 'jet', decision: null, confidence: 'low', score: 35, reason: 'noSubject' } as CullSuggestion;
  const results = finaliseCullEvidence(
    ['jet', 'dup'], new Map([['jet', without], ['dup', subject('dup')]]),
    new Set(['dup']), new Map([['jet', preview('jet')], ['dup', preview('dup')]]), true,
  );
  assert.equal(results[0].decision, null);
  assert.equal(results[0].reason, 'clearDetail');
  assert.equal(results[0].confidence, 'medium');
  assert.equal(results[1].reason, 'duplicate');
});

test('a missing analysis result fails closed instead of being marked a keeper', () => {
  const results = finaliseCullEvidence(['missing'], new Map(), new Set(), new Map(), true);
  assert.deepEqual(results[0], { frameId: 'missing', decision: null, confidence: 'low', score: 0, reason: 'unavailable' });
});

test('failure of either evidence producer rejects rather than publishing partial results', async () => {
  await assert.rejects(collectCullEvidence(
    async () => [subject('bird')],
    async () => { throw new Error('hash read failed'); },
  ), /hash read failed/);
  await assert.rejects(collectCullEvidence(
    async () => { throw new Error('analysis cancelled'); },
    async () => new Set<string>(),
  ), /analysis cancelled/);
});
