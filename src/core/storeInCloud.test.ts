import assert from 'node:assert/strict';
import test from 'node:test';
import type { CloudUsage } from './cloudPlan';
import { COLLABORATION_UI, cloudLimitNote, photosToStore, storeEstimate } from './storeInCloud';

const GB = 1_000_000_000; // as src/core/cloudPlan.ts counts it
const usage = (change: Partial<CloudUsage>): CloudUsage => ({ plan: 'pro', photosUsed: 0, storedBytes: 0, downloadedBytes: 0, balancePence: 0, nowMs: 0, ...change });
const photos = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, cullScore: i, decision: i % 10 === 0 ? 'keep' : null }));

test('sharing with other people stays out of the interface until the app switch is turned on', () => {
  assert.equal(COLLABORATION_UI, false);
});

test('each filter covers its own photos; Best and Top N follow Auto pick, and nothing unscored or removed is guessed in', () => {
  assert.equal(photosToStore('all', photos).length, 40);
  assert.deepEqual(photosToStore('flagged', photos), ['p0', 'p10', 'p20', 'p30']);
  assert.deepEqual(photosToStore('selected', photos, { selectedIds: ['p3', 'p7', 'gone'] }), ['p3', 'p7']);
  assert.deepEqual(photosToStore('top', photos, { top: 3 }), ['p39', 'p38', 'p37']);
  assert.equal(photosToStore('top', photos).length, 40, 'Top 50 of 40 photos is all 40');
  assert.deepEqual(photosToStore('best', photos), ['p39', 'p38', 'p37', 'p36'], 'the top tenth, as the Info panel ranks them');
  const mixed = [{ id: 'a', cullScore: 5 }, { id: 'b' }, { id: 'c', cullScore: 9, removedAt: 1 }];
  assert.deepEqual(photosToStore('top', mixed, { top: 5 }), ['a']);
  assert.deepEqual(photosToStore('all', mixed), ['a', 'b']);
  assert.deepEqual(photosToStore('top', photos, { top: Number.NaN }).length, 40);
});

test('the size is an estimate against the account\'s own storage, and says when it would not fit', () => {
  const fits = storeEstimate(340, usage({ storedBytes: 1 * GB }));
  assert.equal(fits.bytes, 340_000_000);
  assert.equal(fits.included, 2.5 * GB);
  assert.equal(fits.fits, true);
  assert.equal(storeEstimate(2000, usage({ storedBytes: 2 * GB })).fits, false);
  assert.equal(storeEstimate(10, usage({ storedBytes: undefined })).storedNow, null, 'unknown stays unknown');
  assert.equal(storeEstimate(10, usage({ plan: 'basic' })).fits, false, 'Basic includes no storage');
});

test('nothing is shown below 80%; from there the numbers; at the limit, Full', () => {
  assert.equal(cloudLimitNote(usage({ plan: 'plus', storedBytes: 1.9 * GB, photosUsed: 3999 })), null);
  assert.equal(cloudLimitNote(null), null);
  const storage = cloudLimitNote(usage({ storedBytes: 2.1 * GB }))!;
  assert.deepEqual({ kind: storage.kind, percent: storage.percent, full: storage.full }, { kind: 'storage', percent: 84, full: false });
  const edits = cloudLimitNote(usage({ plan: 'plus', photosUsed: 4200 }))!;
  assert.deepEqual({ kind: edits.kind, used: edits.used, included: edits.included, full: edits.full }, { kind: 'edits', used: 4200, included: 5000, full: false });
  // A full limit comes before one that is only close.
  const full = cloudLimitNote(usage({ plan: 'plus', storedBytes: 2.2 * GB, photosUsed: 5000 }))!;
  assert.deepEqual({ kind: full.kind, full: full.full, percent: full.percent }, { kind: 'edits', full: true, percent: 100 });
  // Storage not reported by the server: only what is known is judged.
  assert.equal(cloudLimitNote(usage({ storedBytes: undefined, photosUsed: 10 })), null);
});
