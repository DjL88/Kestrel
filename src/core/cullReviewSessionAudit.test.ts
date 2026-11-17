import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoShootState } from './cullingEngine';
import { auditReviewSession } from './cullReviewSessionAudit';

test('500-photo synthetic shoot audits without changing decisions or originals', () => {
  const state = createDemoShootState(500);
  const original = JSON.stringify(state);
  const audit = auditReviewSession(state);
  assert.equal(audit.active, 500);
  assert.equal(audit.unreviewed, 500);
  assert.equal(audit.reviewed, 0);
  assert.equal(audit.safeForAutomaticDecisions, true);
  assert.deepEqual(audit.issues, []);
  assert.equal(JSON.stringify(state), original);
});

test('duplicate frame identities are reported, never silently resolved', () => {
  const state = createDemoShootState(3);
  state.frames[1] = { ...state.frames[1], id: state.frames[0].id };
  const audit = auditReviewSession(state);
  assert.ok(audit.issues.some((issue) => issue.code === 'duplicate-id'));
  assert.equal(audit.safeForAutomaticDecisions, false);
});

test('duplicate original identities are reported independently of frame IDs', () => {
  const state = createDemoShootState(3);
  state.frames[1] = { ...state.frames[1], stableKey: state.frames[0].stableKey };
  assert.ok(auditReviewSession(state).issues.some((issue) => issue.code === 'duplicate-original'));
});

test('removed photos are excluded from progress and cannot remain selected', () => {
  const state = createDemoShootState(3);
  state.frames[0] = { ...state.frames[0], removedAt: Date.now() };
  const audit = auditReviewSession(state);
  assert.equal(audit.active, 2);
  assert.ok(audit.issues.some((issue) => issue.code === 'removed-selection'));
});

test('stale compare identities are flagged without changing compare state', () => {
  const state = createDemoShootState(3);
  state.compareRightFrameId = 'missing-photo';
  assert.ok(auditReviewSession(state).issues.some((issue) => issue.code === 'invalid-compare'));
  assert.equal(state.compareRightFrameId, 'missing-photo');
});

test('history entries referencing absent photographs are flagged', () => {
  const state = createDemoShootState(3);
  state.undoStack.push({
    frameId: 'lost-photo', prevDecision: 'unreviewed', nextDecision: 'keep',
    prevSelectedId: state.selectedFrameId, nextSelectedId: state.selectedFrameId,
  });
  assert.ok(auditReviewSession(state).issues.some((issue) => issue.code === 'history-missing'));
});

test('manual review progress counts only active keep/reject decisions', () => {
  const state = createDemoShootState(4);
  state.frames[0] = { ...state.frames[0], decision: 'keep' };
  state.frames[1] = { ...state.frames[1], decision: 'reject' };
  state.frames[2] = { ...state.frames[2], decision: 'keep', removedAt: Date.now() };
  const audit = auditReviewSession(state);
  assert.deepEqual([audit.active, audit.reviewed, audit.keep, audit.reject, audit.unreviewed], [3, 2, 1, 1, 1]);
});

test('virtual copies do not falsely collide with their source original', () => {
  const state = createDemoShootState(2);
  state.frames[1] = { ...state.frames[1], stableKey: state.frames[0].stableKey, virtualCopy: true };
  assert.equal(auditReviewSession(state).issues.some((issue) => issue.code === 'duplicate-original'), false);
});
