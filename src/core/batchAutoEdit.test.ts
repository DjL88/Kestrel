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
