import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHistogram } from './histogram';
import { DEFAULT_EDIT } from './photoEdits';
import { adviceAction, adviseOnPhoto, applySuggestion } from './photoAdvice';

/** A picture of `count` pixels where `pick(i)` gives [r,g,b]. */
const picture = (count: number, pick: (i: number) => [number, number, number]) => {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i += 1) data.set([...pick(i), 255], i * 4);
  return computeHistogram(data);
};
const ramp = (i: number): [number, number, number] => { const v = Math.round((i / 999) * 255); return [v, v, v]; };

test('a well-spread, neutral picture is good and offers nothing', () => {
  const advice = adviseOnPhoto(picture(1000, ramp), DEFAULT_EDIT);
  assert.equal(advice.verdict, 'good');
  assert.deepEqual(advice.suggestions, []);
});

test('too little data is "unsure", never a guess', () => {
  assert.equal(adviseOnPhoto(picture(10, ramp), DEFAULT_EDIT).verdict, 'unsure');
});

test('clipped highlights are a measured, high-confidence, bounded Highlights change', () => {
  const advice = adviseOnPhoto(picture(1000, (i) => i < 100 ? [255, 255, 255] : ramp(i)), DEFAULT_EDIT);
  const white = advice.suggestions.find((item) => item.issue === 'whiteClip')!;
  assert.equal(white.confidence, 'high');
  assert.ok(white.changes.highlights! < 0 && white.changes.highlights! >= -0.6);
  assert.equal(advice.verdict, 'needs-work', '10% pure white is severe');
});

test('a dark frame is advised unless the scene is known to be deliberately low-key', () => {
  const dark = picture(1000, (i) => { const v = Math.round((i / 999) * 70) + 4; return [v, v, v]; });
  assert.ok(adviseOnPhoto(dark, DEFAULT_EDIT).issues.includes('dark'));
  const known = adviseOnPhoto(dark, DEFAULT_EDIT, { intent: 'low-key' });
  assert.ok(!known.issues.includes('dark'));
});

test('a colour cast alone never lowers the verdict (golden light may be the point)', () => {
  const warm = adviseOnPhoto(picture(1000, (i) => { const v = 45 + Math.round((i / 999) * 165); return [v + 40, v, v - 40]; }), DEFAULT_EDIT);
  assert.ok(warm.issues.includes('warm'));
  assert.equal(warm.verdict, 'good');
  assert.equal(warm.suggestions[0].confidence, 'low');
});

test('applying a suggestion is additive, clamped, and leaves masks alone', () => {
  const next = applySuggestion({ ...DEFAULT_EDIT, highlights: -1.9, masks: [] },
    { issue: 'whiteClip', changes: { highlights: -0.6 }, confidence: 'high' });
  assert.equal(next.highlights, -2);
  assert.deepEqual(next.masks, []);
});

test('advice does not push a slider that is already far along the same way', () => {
  const clipped = picture(1000, (i) => i < 100 ? [255, 255, 255] : ramp(i));
  assert.equal(adviseOnPhoto(clipped, { ...DEFAULT_EDIT, highlights: -1.6 }).suggestions.length, 0);
});

test('mode mapping: Solo is silent unless asked, Glide offers one Try this, Soar applies only measured safe changes', () => {
  const advice = adviseOnPhoto(picture(1000, (i) => i < 100 ? [255, 255, 255] : (i > 900 ? [0, 0, 0] : ramp(i))), DEFAULT_EDIT);
  assert.ok(advice.suggestions.length >= 2);
  assert.deepEqual(adviceAction('solo', advice), { show: false, auto: [], tryThis: null });
  assert.equal(adviceAction('solo', advice, { asked: true }).auto.length, 0);
  const glide = adviceAction('glide', advice);
  assert.equal(glide.auto.length, 0, 'Glide never changes anything by itself');
  assert.ok(glide.tryThis);
  const soar = adviceAction('soar', advice);
  assert.ok(soar.auto.length >= 1 && soar.auto.every((item) => item.confidence === 'high'));
  assert.equal(adviceAction('soar', advice, { manuallyRefined: true }).auto.length, 0, 'never over the photographer\'s own edits');
});

test('scene context from the model only ever removes advice: golden light keeps a warm cast, low-key keeps a dark frame', () => {
  const warm = picture(1000, (i) => { const v = 45 + Math.round((i / 999) * 165); return [v + 40, v, v - 40]; });
  assert.ok(adviseOnPhoto(warm, DEFAULT_EDIT).issues.includes('warm'));
  assert.ok(!adviseOnPhoto(warm, DEFAULT_EDIT, { light: 'golden' }).issues.includes('warm'));
  const clipped = picture(1000, (i) => i < 100 ? [255, 255, 255] : ramp(i));
  const plain = adviseOnPhoto(clipped, DEFAULT_EDIT), withContext = adviseOnPhoto(clipped, DEFAULT_EDIT, { intent: 'low-key', light: 'golden' });
  assert.deepEqual(withContext.suggestions.map((item) => item.issue), plain.suggestions.map((item) => item.issue), 'measured clipping is never explained away');
  assert.deepEqual(withContext.suggestions.map((item) => item.confidence), plain.suggestions.map((item) => item.confidence), 'context never raises confidence');
});
