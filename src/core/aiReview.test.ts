import assert from 'node:assert/strict';
import test from 'node:test';
import { aiReviewPrompt, parseAiReview } from './aiReview';

test('a good answer is kept, in plain words, with bounded colour and light suggestions only', () => {
  const review = parseAiReview(JSON.stringify({
    summary: 'The robin’s breast is a little too orange, and the background leans green.',
    points: [{ issue: 'tooStrong', detail: 'The orange breast is stronger than in life.' }, { issue: 'cast', detail: 'A slight green tint in the leaves.' }],
    suggestion: { colour: -0.33, warmth: -0.2, sharpen: 2, masks: [], exposure: 9 },
  }));
  assert.ok(review);
  assert.equal(review.points.length, 2);
  assert.deepEqual(review.suggestion, { colour: -0.35, warmth: -0.2, exposure: 2 }, 'rounded, clamped, and no detail or mask changes');
});

test('code fences are tolerated; markup, links and code are stripped from sentences', () => {
  const review = parseAiReview('```json\n{"summary": "<b>Fine</b> colour, see https://evil.example now", "points": [{"issue": "weird", "detail": "`rm -rf` ok"}], "suggestion": {}}\n```');
  assert.ok(review);
  assert.equal(review.summary, 'Fine colour, see now');
  assert.deepEqual(review.points, [{ issue: 'other', detail: 'rm -rf ok' }]);
  assert.deepEqual(review.suggestion, {});
});

test('anything that is not the expected shape is refused', () => {
  for (const reply of ['', 'not json', '[]', 'null', '{"points": []}', '{"summary": "   "}', '{"summary": 42}']) {
    assert.equal(parseAiReview(reply), null, reply);
  }
});

test('long answers are cut to a calm length, and at most four points are kept', () => {
  const review = parseAiReview(JSON.stringify({
    summary: 'x'.repeat(1000),
    points: Array.from({ length: 9 }, () => ({ issue: 'flat', detail: 'Flat.' })),
    suggestion: {},
  }));
  assert.ok(review);
  assert.ok(review.summary.length <= 280);
  assert.equal(review.points.length, 4);
});

test('the question asks for the person’s language and never asks about people', () => {
  const prompt = aiReviewPrompt('Welsh', ['Very strong red covers 40% of the photo.']);
  assert.match(prompt, /in Welsh/);
  assert.match(prompt, /Never describe, identify or name any person/);
  assert.match(prompt, /Very strong red/);
  assert.doesNotMatch(aiReviewPrompt('English', []), /on-device check found/);
});
