import assert from 'node:assert/strict';
import test from 'node:test';
import { AI_REVIEW_CONSENT_VERSION } from '../../core/aiReview';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { consentFor, type AiProviderSettings } from '../../providers/aiProviders';
import { aiOpinionView, applyTargets, type AiOpinionRecord } from './aiSecondOpinion';

const ollama: AiProviderSettings = { kind: 'openai', key: '', model: 'qwen2.5vl', baseUrl: 'http://localhost:11434/v1', consent: null };
const agreed = { ...ollama, consent: consentFor(AI_REVIEW_CONSENT_VERSION, ollama) };

test('nothing set up shows only the set-up prompt', () => {
  assert.deepEqual(aiOpinionView(null, null, 'p1'), { setup: 'none' });
});

test('a model on this computer asks for agreement, saying nothing leaves the computer', () => {
  const view = aiOpinionView(ollama, null, 'p1');
  assert.equal(view.setup, 'consent');
  assert.equal(view.onThisComputer, true);
  assert.match(view.consentText ?? '', /localhost:11434.*Nothing leaves your computer/);
});

test('an answer is shown only for the photo it was about, with the exact checked values', () => {
  const record: AiOpinionRecord = {
    photoId: 'p1', base: DEFAULT_EDIT, stableKey: 'k', phase: 'ready', targets: { warmth: 0.2 },
    review: { summary: 'A little cool.', points: [{ issue: 'cast', detail: 'Slightly blue.' }], suggestion: { warmth: 1.5 } },
  };
  const view = aiOpinionView(agreed, record, 'p1');
  assert.equal(view.setup, 'ready');
  assert.deepEqual(view.changes, ['Warmth: +0.2']);
  assert.equal(view.points?.[0].label, 'Tint');
  assert.equal(aiOpinionView(agreed, record, 'p2').summary, undefined);
});

test('applying sets the checked absolute values, not the raw model values', () => {
  const next = applyTargets({ ...DEFAULT_EDIT, warmth: 0.1 }, { warmth: 0.3, exposure: -0.2 });
  assert.equal(next.warmth, 0.3);
  assert.equal(next.exposure, -0.2);
});
