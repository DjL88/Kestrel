import assert from 'node:assert/strict';
import { test } from 'node:test';
import { photoTileMilestones } from './photoTileReadiness';

test('a photo is not called ready merely because its catalogue row exists', () => {
  const pending = photoTileMilestones({}, 'loading');
  assert.equal(pending.preview, 'loading');
  assert.equal(pending.cullScanned, false);
  assert.equal(pending.edited, false);
  assert.match(pending.summary, /Preview loading/);

  const visible = photoTileMilestones({}, 'ready');
  assert.equal(visible.preview, 'ready');
  assert.match(visible.summary, /ready to open/);
  assert.match(visible.summary, /No cull scan recorded/);
});

test('unavailable preview is distinct from unscanned and never implies a rejected photo', () => {
  const status = photoTileMilestones({ cullScore: undefined }, 'unavailable');
  assert.equal(status.preview, 'unavailable');
  assert.equal(status.cullScanned, false);
  assert.match(status.summary, /reconnecting/);
  assert.doesNotMatch(status.summary, /reject/i);
});

test('only a finite score in the persisted 0–100 range proves a cull scan was recorded', () => {
  for (const value of [0, 25, 100]) {
    assert.equal(photoTileMilestones({ cullScore: value }, 'ready').cullScanned, true);
  }
  for (const value of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(photoTileMilestones({ cullScore: value }, 'ready').cullScanned, false);
  }
});

test('edited marker reflects actual saved nondestructive adjustments, not an unscanned frame', () => {
  const untouched = photoTileMilestones({ edit: { exposure: 0, warmth: 0, colour: 0 } }, 'ready');
  assert.equal(untouched.edited, false);
  const edited = photoTileMilestones({ edit: { exposure: 0.4, warmth: 0, colour: 0 } }, 'ready');
  assert.equal(edited.edited, true);
  assert.match(edited.summary, /Saved edits/);
});

test('live analysis stages are honest and never count as a saved cull score', () => {
  const queued = photoTileMilestones({}, 'ready', 'queued');
  assert.equal(queued.analysis, 'queued');
  assert.equal(queued.cullScanned, false);
  assert.match(queued.summary, /Waiting for local analysis/);
  const checking = photoTileMilestones({}, 'ready', 'analysing');
  assert.equal(checking.analysis, 'analysing');
  assert.match(checking.summary, /Analysing this photo/);
  const tentative = photoTileMilestones({}, 'ready', 'analysed');
  assert.equal(tentative.cullScanned, false);
  assert.match(tentative.summary, /finishing shoot comparison/);
  const unavailable = photoTileMilestones({}, 'ready', 'unavailable');
  assert.equal(unavailable.cullScanned, false);
  assert.match(unavailable.summary, /manual review available/);
  const final = photoTileMilestones({ cullScore: 75 }, 'ready', 'analysing');
  assert.equal(final.analysis, 'recorded');
  assert.equal(final.cullScanned, true);
  assert.match(final.summary, /Cull scan recorded/);
});

test('every marker state a segment can show differs by shape, not only by colour', async () => {
  const { segmentShape } = await import('./photoTileReadiness');
  // States one segment can show side by side over time must look different without colour.
  const groups = [
    ['loading', 'ready', 'unavailable'],
    ['idle', 'queued', 'analysing', 'analysed', 'unavailable', 'recorded'],
    ['not-yet', 'done'],
  ] as const;
  for (const states of groups) {
    const meaning = (state: (typeof states)[number]) => ({ loading: 'busy', analysing: 'busy', ready: 'done', recorded: 'done', done: 'done', unavailable: 'failed', analysed: 'provisional', idle: 'not-yet', queued: 'not-yet', 'not-yet': 'not-yet' } as const)[state];
    const seen = new Map<string, string>();
    for (const state of states) {
      const shape = JSON.stringify(segmentShape(state));
      const earlier = seen.get(shape);
      assert.ok(earlier === undefined || earlier === meaning(state), `${state} looks like ${earlier} without colour`);
      seen.set(shape, meaning(state));
    }
  }
});
