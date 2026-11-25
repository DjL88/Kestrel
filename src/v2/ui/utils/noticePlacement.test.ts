import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneNoticeBottom } from './noticePlacement.ts';

test('a phone notice sits above the highest thing at the bottom of the screen', () => {
  // 844 px phone: tool bar from 780, filmstrip from 676: the notice clears the filmstrip.
  assert.equal(phoneNoticeBottom(844, [780, 676]), 844 - 676 + 8);
  // An open tool sheet reaching higher still wins.
  assert.equal(phoneNoticeBottom(844, [780, 676, 409]), 844 - 409 + 8);
});

test('hidden or off-screen elements are ignored, and nothing measured keeps the usual inset', () => {
  assert.equal(phoneNoticeBottom(844, [0, Number.NaN, 900]), 80);
  assert.equal(phoneNoticeBottom(844, []), 80);
  // Never lower than the usual inset above the tool bar.
  assert.equal(phoneNoticeBottom(844, [830]), 80);
});
