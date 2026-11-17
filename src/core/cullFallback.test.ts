import test from 'node:test';
import assert from 'node:assert/strict';
import { missingDetectorReviewFallback, restoreNoSubjectFallback } from './cullFallback';
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

test('an AI Studio checkout without YOLOX cannot turn textured backgrounds into automatic keepers', () => {
  const sharp = suggestion('helicopter', 'clearDetail', 'high', 98);
  const duplicate: CullSuggestion = { frameId: 'duplicate', reason: 'duplicate', confidence: 'high', score: 100, decision: 'reject' };
  const unavailable: CullSuggestion = { frameId: 'offline', reason: 'unavailable', confidence: 'low', score: 0, decision: null };
  const originals = [sharp, duplicate, unavailable];
  const actual = missingDetectorReviewFallback(originals, new Map([['helicopter', sharp]]));
  assert.deepEqual(actual.map(({ decision, confidence }) => [decision, confidence]), [
    ['keep', 'medium'], ['reject', 'high'], [null, 'low'],
  ]);
  assert.ok(actual[0].score <= 79, 'a model-less preview cannot approve a high-confidence keeper');
  assert.deepEqual(originals[0], sharp, 'the original culling scores are not changed');
});

test('unrecognised and flat photos without a model stay low or medium confidence', () => {
  const flat: CullSuggestion = { frameId: 'flat', decision: 'reject', confidence: 'medium', score: 72, reason: 'flat' };
  const vague: CullSuggestion = { frameId: 'vague', decision: null, confidence: 'low', score: 40, reason: 'limitedDetail' };
  const actual = missingDetectorReviewFallback([flat, vague], new Map([['flat', flat], ['vague', vague]]));
  assert.deepEqual(actual.map(({ confidence }) => confidence), ['medium', 'low']);
  assert.ok(actual.every((item) => item.confidence !== 'high'));
});
