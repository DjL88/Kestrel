import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreNoSubjectFallback } from './cullFallback';
import type { CullSuggestion } from './autoCull';

const suggestion = (frameId: string, reason: CullSuggestion['reason'], confidence: CullSuggestion['confidence'], score: number): CullSuggestion =>
  ({ frameId, reason, confidence, score, decision: 'keep' });

test('an unrecognised aircraft cannot become an automatic keeper from background texture', () => {
  const missing: CullSuggestion = { ...suggestion('jet', 'noSubject', 'low', 35), decision: null };
  const base = suggestion('jet', 'clearDetail', 'high', 97);
  const [fallback] = restoreNoSubjectFallback([missing], new Map([['jet', base]]));
  assert.deepEqual([fallback.decision, fallback.confidence, fallback.score], ['keep', 'medium', 79]);
  assert.equal(missing.decision, null, 'original detector result remains unchanged');
  assert.equal(base.confidence, 'high', 'source preview score remains unchanged');
});

test('recognized subjects, unavailable images and duplicates are not changed', () => {
  const recognized = suggestion('bird', 'subjectSharp', 'high', 95);
  const unavailable: CullSuggestion = { ...suggestion('offline', 'unavailable', 'low', 0), decision: null };
  const duplicate = suggestion('dup', 'duplicate', 'high', 100);
  const results = [recognized, unavailable, duplicate];
  assert.deepEqual(restoreNoSubjectFallback(results, new Map()), results);
});

test('missing base results and medium-confidence previews cannot gain confidence', () => {
  const unknown: CullSuggestion = { ...suggestion('unknown', 'noSubject', 'low', 35), decision: null };
  const base = suggestion('known', 'someDetail', 'medium', 70);
  const known: CullSuggestion = { ...unknown, frameId: 'known' };
  const [first, second] = restoreNoSubjectFallback([unknown, known], new Map([['known', base]]));
  assert.equal(first, unknown);
  assert.deepEqual([second.confidence, second.score], ['medium', 70]);
});
