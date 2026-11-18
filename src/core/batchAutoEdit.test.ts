import assert from 'node:assert/strict';
import test from 'node:test';
import { applyKeeperAutoEdits } from '../providers/batchAutoEdit';
import { DEFAULT_EDIT } from './photoEdits';
import type { PhotoFrame } from './types';

const make = (id: string, decision: PhotoFrame['decision'] = 'keep'): PhotoFrame => ({
  id, stableKey: id, filename: id + '.jpg', sequenceIndex: 1, decision,
  burstGroupId: null, burstIndex: 1, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file',
});

test('batch auto enhance commits only eligible current keepers into edit history', () => {
  const edited = { ...make('edited'), edit: { ...DEFAULT_EDIT, contrast: 0.5 } };
  const removed = { ...make('removed'), removedAt: 44 };
  const virtual = { ...make('virtual'), virtualCopy: { originalFrameId: 'good', number: 1 } };
  const frames = [make('good'), edited, removed, virtual, make('reject', 'reject')];
  const changes = new Map(frames.map((f) => [f.id, { ...DEFAULT_EDIT, exposure: 0.4 }]));
  const result = applyKeeperAutoEdits(frames, changes, 1234);
  assert.equal(result[0].edit?.exposure, 0.4);
  assert.equal(result[0].editHistory?.steps.length, 1);
  for (let i = 1; i < frames.length; i++) assert.strictEqual(result[i], frames[i]);
});

test('stale batch results do not overwrite a photograph edited after analysis began', () => {
  const original = make('one');
  const current = { ...original, edit: { ...DEFAULT_EDIT, warmth: 0.3 } };
  const next = applyKeeperAutoEdits([current], new Map([['one', { ...DEFAULT_EDIT, warmth: -1 }]]), 500);
  assert.strictEqual(next[0], current);
});

test('selected local Auto Edit can adjust unreviewed photos while leaving an unselected keeper alone', () => {
  const frames = [make('chosen', 'unreviewed'), make('other', 'keep'), make('rejected', 'reject')];
  const ids = new Set(['chosen']);
  const changes = new Map(frames.map((frame) => [frame.id, { ...DEFAULT_EDIT, contrast: 0.6 }]));
  const next = applyKeeperAutoEdits(frames, changes, 250, ids);
  assert.equal(next[0].edit?.contrast, 0.6);
  assert.equal(next[0].editHistory?.steps.length, 1);
  assert.strictEqual(next[1], frames[1]);
  assert.strictEqual(next[2], frames[2]);
});

test('selected auto edit respects stale decisions, manual changes, removed photos and virtual copies', () => {
  const ids = new Set(['new', 'edited', 'removed', 'virtual']);
  const frames = [
    make('new', 'unreviewed'),
    { ...make('edited', 'keep'), edit: { ...DEFAULT_EDIT, warmth: 1 } },
    { ...make('removed', 'unreviewed'), removedAt: 40 },
    { ...make('virtual', 'unreviewed'), virtualCopy: { originalFrameId: 'new', number: 1 } },
  ];
  const changes = new Map(frames.map((frame) => [frame.id, { ...DEFAULT_EDIT, exposure: 1.1 }]));
  const result = applyKeeperAutoEdits(frames, changes, 500, ids);
  assert.equal(result[0].edit?.exposure, 1.1);
  for (let i = 1; i < frames.length; i++) assert.strictEqual(result[i], frames[i]);
});


test('removed-at-zero frames cannot receive automatic edits or new history', () => {
  const removed = { ...make('removed-zero'), removedAt: 0 };
  const eligible = make('eligible');
  const frames = [removed, eligible];
  const edits = new Map(frames.map((frame) => [frame.id, { ...DEFAULT_EDIT, exposure: 0.7 }]));
  const result = applyKeeperAutoEdits(frames, edits, 900);
  assert.strictEqual(result[0], removed);
  assert.equal(result[0].editHistory, undefined);
  assert.equal(result[1].edit?.exposure, 0.7);
  assert.equal(result[1].editHistory?.steps.length, 1);
  assert.equal(removed.removedAt, 0);
});


test('selected Auto Edit cannot resurrect an epoch-zero removed photograph', () => {
  const removed = { ...make('removed-selected', 'unreviewed'), removedAt: 0 };
  const selected = make('selected-live', 'unreviewed');
  const frames = [removed, selected];
  const targetIds = new Set(frames.map((frame) => frame.id));
  const edits = new Map(frames.map((frame) => [frame.id, { ...DEFAULT_EDIT, exposure: 0.25 }]));
  const next = applyKeeperAutoEdits(frames, edits, 901, targetIds);
  assert.strictEqual(next[0], removed);
  assert.equal(next[0].editHistory, undefined);
  assert.equal(next[1].edit?.exposure, 0.25);
  assert.equal(next[1].editHistory?.steps.length, 1);
  assert.strictEqual(frames[0], removed);
});
