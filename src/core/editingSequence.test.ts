import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireLease, EMPTY_LEASE_BOARD } from './photoLease';
import { applySteps, buildEditingSequence, initialsOf, mayModifyPhoto, photoToScreen, screenToPhoto, shouldSendCursor, CURSOR_MIN_INTERVAL_MS } from './editingSequence';

test('steps follow a person’s usual order with the real values, and skip what did not change', () => {
  const before = { lookId: 'none', exposure: 0, contrast: 0, temperature: 0, clarity: 5, shadows: 0 };
  const after = { lookId: 'auto', exposure: 0.6, contrast: 0, temperature: 12, clarity: 5, shadows: 20 };
  const steps = buildEditingSequence(before, after, ['lookId']);
  assert.deepEqual(steps.map((s) => [s.key, s.group, s.from, s.to]), [
    ['temperature', 'white-balance', 0, 12], ['exposure', 'light', 0, 0.6], ['shadows', 'light', 0, 20],
  ]);
});

test('an unknown setting is still shown, and structured values compare by content', () => {
  const steps = buildEditingSequence({ toneCurve: [[0, 0], [1, 1]], futureSlider: 1 }, { toneCurve: [[0, 0], [1, 1]], futureSlider: 2 });
  assert.deepEqual(steps.map((s) => [s.key, s.group]), [['futureSlider', 'other']]);
});

test('Watch plays a prefix and Learn applies only accepted steps; all steps give the final recipe', () => {
  const before = { exposure: 0, shadows: 0, vibrance: 0 };
  const after = { exposure: 1, shadows: 10, vibrance: 5 };
  const steps = buildEditingSequence(before, after);
  assert.deepEqual(applySteps(before, steps, () => true), after);
  assert.deepEqual(applySteps(before, steps, (_, i) => i < 1), { exposure: 1, shadows: 0, vibrance: 0 });
  assert.deepEqual(applySteps(before, steps, (s) => s.key !== 'shadows'), { exposure: 1, shadows: 0, vibrance: 5 });
  assert.deepEqual(applySteps({ toneCurve: [1] } as Record<string, unknown>, buildEditingSequence({ toneCurve: [1] }, {}), () => true), {});
});

test('Co-pilot and Auto-pilot use the person’s lease and never take someone else’s photo', () => {
  const got = acquireLease(EMPTY_LEASE_BOARD, { photoId: 'p', accountId: 'ann', deviceId: 'd', token: 't', baseRevisionId: null }, 0);
  assert.ok(got.ok);
  const copilotForAnn = { id: 'c', kind: 'copilot' as const, displayName: 'Co-pilot', actingForAccountId: 'ann' };
  const copilotForBob = { ...copilotForAnn, actingForAccountId: 'bob' };
  assert.equal(mayModifyPhoto(copilotForAnn, true, got.lease), true);
  assert.equal(mayModifyPhoto(copilotForBob, true, got.lease), false);
  assert.equal(mayModifyPhoto({ id: 'b', kind: 'human-editor', displayName: 'Bob', accountId: 'bob' }, true, got.lease), false);
  assert.equal(mayModifyPhoto({ id: 'b', kind: 'human-editor', displayName: 'Bob', accountId: 'bob' }, true, undefined), false);
  assert.equal(mayModifyPhoto({ id: 'r', kind: 'human-reviewer', displayName: 'R', accountId: 'ann' }, true, got.lease), false);
  assert.equal(mayModifyPhoto({ id: 't', kind: 'tutorial-guide', displayName: 'Guide' }, false, undefined), false);
  assert.equal(mayModifyPhoto({ ...copilotForBob, kind: 'autopilot' }, false, undefined), true, 'unshared projects keep today’s behaviour');
});

test('cursor positions are relative to the photograph, so zoom and screen size do not move them', () => {
  const desktop200 = { left: -500, top: -300, width: 4000, height: 2666 };
  const ipad = { left: 20, top: 40, width: 800, height: 533 };
  const eye = screenToPhoto(-500 + 0.62 * 4000, -300 + 0.31 * 2666, desktop200)!;
  const onIpad = photoToScreen(eye, ipad);
  assert.ok(Math.abs(onIpad.x - (20 + 0.62 * 800)) < 1e-6 && Math.abs(onIpad.y - (40 + 0.31 * 533)) < 1e-6);
  assert.equal(screenToPhoto(0, 0, ipad), null, 'off the photograph sends nothing');
  assert.equal(screenToPhoto(10, 10, { left: 0, top: 0, width: 0, height: 0 }), null);
  assert.equal(shouldSendCursor(null, 0), true);
  assert.equal(shouldSendCursor(0, CURSOR_MIN_INTERVAL_MS - 1), false);
  assert.equal(shouldSendCursor(0, CURSOR_MIN_INTERVAL_MS), true);
  assert.ok(1000 / CURSOR_MIN_INTERVAL_MS <= 15);
});

test('initials identify a participant without relying on colour', () => {
  assert.equal(initialsOf('Dave Leitch'), 'DL');
  assert.equal(initialsOf('co-pilot'), 'CO');
  assert.equal(initialsOf('  '), '?');
  assert.equal(initialsOf('Ann Marie Smith'), 'AS');
});
