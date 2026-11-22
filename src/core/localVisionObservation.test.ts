import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_TEXT, sanitiseObservation } from './localVisionObservation.ts';

test('a plain observation is kept as it is', () => {
  const result = sanitiseObservation('The main subject is a bird of prey. The light looks natural.');
  assert.equal(result.usable, true);
  assert.equal(result.text, 'The main subject is a bird of prey. The light looks natural.');
});

test('markup, links and control characters are removed, never kept or followed', () => {
  const result = sanitiseObservation('A kite <script>alert(1)</script> in flight\u0007 see https://evil.example/x and javascript:alert(1) done.');
  assert.equal(result.text.includes('<'), false);
  assert.equal(/https?:|javascript:/i.test(result.text), false);
  assert.equal(/[\u0000-\u001f]/.test(result.text), false);
  assert.match(result.text, /A kite/);
});

test('nothing usable gives nothing, so the app says nothing instead of guessing', () => {
  for (const value of ['', '   ', '..', '123456789', null, undefined, 42, {}]) assert.equal(sanitiseObservation(value).usable, false);
});

test('a long answer is cut at a full stop, not mid-sentence', () => {
  const sentence = 'The bird is sharp and the background is soft. ';
  const result = sanitiseObservation(sentence.repeat(30));
  assert.ok(result.text.length <= MAX_TEXT);
  assert.ok(result.text.endsWith('.'));
});

import { sameVersion } from './localVisionObservation.ts';
test('an old answer is recognised as old as soon as the photo or edit changes', () => {
  const edit = { exposure: 0 };
  assert.equal(sameVersion([edit, 'a'], [edit, 'a']), true);
  assert.equal(sameVersion([edit, 'a'], [{ exposure: 0 }, 'a']), false);
  assert.equal(sameVersion([edit], [edit, 'a']), false);
});
