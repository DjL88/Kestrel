import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { planFinish } from '../../core/finishPlan';
import { finishBatchStore } from '../engineClient/finishBatchStore';
import type { FinishResult } from '../engineClient/runFinishBatch';
import type { PhotoFrame } from '../../core/types';
import FinishBestDialog, { finishSummaryLine } from './dialogs/FinishBestDialog';
import FinishReviewDialog from './dialogs/FinishReviewDialog';
import FinishBestButton from './shell/FinishBestButton';

const frame = (id: string, patch: Partial<PhotoFrame> = {}): PhotoFrame => ({
  id, stableKey: `${id}.jpg`, filename: `${id}.jpg`, sequenceIndex: 1, decision: 'unreviewed', burstGroupId: null,
  burstIndex: 0, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file', ...patch,
});
const result = (photoId: string, state: FinishResult['state'], patch: Partial<FinishResult> = {}): FinishResult =>
  ({ photoId, filename: `${photoId}.jpg`, state, why: `why ${photoId}`, denoised: false, review: 'pending', at: 1, ...patch });
const control = { preview: async () => null, undo: () => undefined, cancel: () => undefined };

test('the chooser says what a request means in one line, and what it leaves alone', () => {
  const frames = [frame('a', { rating: 5 }), frame('b', { rating: 4 }), frame('c', { rating: 3, decision: 'reject' }), frame('d')];
  const plan = planFinish(frames, { kind: 'count', count: 3 });
  assert.equal(finishSummaryLine(plan.summary, { kind: 'count', count: 3 }), 'Best 3 of 4');
  const html = renderToStaticMarkup(createElement(FinishBestDialog, { open: true, plan: (request) => planFinish(frames, request), version: frames, onStart: () => undefined, onClose: () => undefined }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  // 10% of 4 is smaller than 50, so the chooser opens on the percentage, with its field already there for focus to land on.
  assert.match(html, /Best 10%: 1 of 4/);
  assert.match(html, /data-testid="finish-percent"/);
  assert.doesNotMatch(html, /data-testid="finish-count"/);
  assert.doesNotMatch(html, /finish-raw-note/);
  assert.match(html, /Everything runs on this device\. Nothing is uploaded\./);
  assert.equal(renderToStaticMarkup(createElement(FinishBestDialog, { open: false, plan: (request) => planFinish(frames, request), version: frames, onStart: () => undefined, onClose: () => undefined })), '');
});

test('the review groups edited, held and left-alone photos, each with a word and a reason, and Keep or Undo by name', () => {
  const run = finishBatchStore.begin('p', 4);
  finishBatchStore.add(run, result('a', 'applied', { applied: 'Exposure up.' }));
  finishBatchStore.add(run, result('b', 'held', { heldReason: 'Held for you to look at.' }));
  finishBatchStore.add(run, result('c', 'unchanged'));
  finishBatchStore.add(run, result('d', 'applied', { review: 'kept' }));
  finishBatchStore.finish(run, false);
  const html = renderToStaticMarkup(createElement(FinishReviewDialog, { open: true, control, onOpenPhoto: () => undefined, onClose: () => undefined }));
  assert.match(html, /Finished photos \(2\)/);
  assert.match(html, /Held for your review \(1\)/);
  assert.match(html, /Left as they were \(1\)/);
  assert.match(html, /Exposure up\./);
  assert.match(html, /Held for you to look at\./);
  assert.match(html, /aria-label="Keep the edit on a\.jpg"/);
  assert.doesNotMatch(html, /aria-label="Keep the edit on d\.jpg"/, 'a kept photo has no Keep button');
  assert.match(html, /aria-label="Undo the edit on d\.jpg"/);
  assert.match(html, /Approve all/);
  assert.match(html, /aria-pressed="true"[^>]*data-testid="finish-show-after"/);
  finishBatchStore.reset();
});

test('the entry button is busy in words while a batch runs, and offers the review once there is one', () => {
  finishBatchStore.reset();
  const entry = { onOpen: () => undefined, onReview: () => undefined };
  const idle = renderToStaticMarkup(createElement(FinishBestButton, { entry }));
  assert.match(idle, /Finish best…/);
  assert.doesNotMatch(idle, /Review \d+ finished/);
  const run = finishBatchStore.begin('p', 2);
  finishBatchStore.add(run, result('a', 'applied'));
  const busy = renderToStaticMarkup(createElement(FinishBestButton, { entry }));
  assert.match(busy, /Finishing…/);
  assert.match(busy, /disabled/);
  assert.match(busy, /Review 1 finished/);
  finishBatchStore.reset();
});

test('the chooser warns that RAW photos take longer, only when the batch includes one', () => {
  const frames = [frame('a', { rating: 5, filename: 'a.NEF', stableKey: 'a.NEF' }), frame('b', { rating: 4 })];
  const html = renderToStaticMarkup(createElement(FinishBestDialog, { open: true, plan: (request) => planFinish(frames, request), version: frames, onStart: () => undefined, onClose: () => undefined }));
  assert.match(html, /RAW photos take longer/);
});

test('the review says Before or After in words, marks the chosen button with a tick, and never leans on colour alone', () => {
  const run = finishBatchStore.begin('p', 2);
  finishBatchStore.add(run, result('a', 'applied'));
  finishBatchStore.add(run, result('b', 'held'));
  finishBatchStore.finish(run, false);
  const html = renderToStaticMarkup(createElement(FinishReviewDialog, { open: true, control, onOpenPhoto: () => undefined, onClose: () => undefined }));
  assert.match(html, /data-testid="finish-show-after"[^>]*>[^]*?✓[^]*?After<\/button>/);
  assert.doesNotMatch(html, /data-testid="finish-show-before"[^>]*>[^]*?✓[^]*?Before<\/button>/);
  assert.equal((html.match(/data-testid="finish-picture-caption"/g) ?? []).length, 1, 'the edited tile is captioned, the held (unchanged) one is not');
  assert.match(html, /press Auto/);
  finishBatchStore.reset();
});
