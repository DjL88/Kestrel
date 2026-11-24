import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_NOTICE_MS, noticeDurationMs, noticeNeedsDismiss } from './noticeTiming.ts';

test('messages about problems wait to be dismissed', () => {
  for (const text of [
    'InFlight could not save this project. Your original photos are unchanged.',
    'Some export outputs failed. Open Tasks for each photograph and Retry failed.',
    'Export stopped. Files already saved remain in place.',
    'Not connected to the InFlight engine yet, so not applied: tint.',
    'Subject detection failed. Open Tasks for details.',
  ]) assert.equal(noticeNeedsDismiss(text), true, text);
});

test('confirmations dismiss themselves', () => {
  for (const text of ['Flagged 3 photos.', 'Look applied. Undo is available.', 'Screenshot saved to your downloads.']) {
    assert.equal(noticeNeedsDismiss(text), false, text);
  }
});

test('a short confirmation stays at least 6 seconds, twice the old 3.2', () => {
  assert.equal(noticeDurationMs('Flagged 3 photos.'), MIN_NOTICE_MS);
});

test('a long confirmation stays longer, up to 20 seconds', () => {
  const long = 'Added an adjustable Oval area mask. Expand its layer to position it, then move an adjustment slider to affect the photograph. Undo is available.';
  assert.ok(noticeDurationMs(long) > MIN_NOTICE_MS);
  assert.equal(noticeDurationMs('word '.repeat(500)), 20000);
});
