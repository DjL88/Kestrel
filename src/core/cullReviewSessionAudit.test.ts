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
  state.frames[1] = { ...state.frames[1], stableKey: state.frames[0].stableKey, virtualCopy: { originalFrameId: state.frames[0].id, number: 1 } };
  assert.equal(auditReviewSession(state).issues.some((issue) => issue.code === 'duplicate-original'), false);
});

test('epoch-zero removal timestamp is not mistaken for an active photo', () => {
  const state = createDemoShootState(500);
  const removedId = state.frames[0].id;
  state.frames[0] = { ...state.frames[0], removedAt: 0, decision: 'keep' };
  const before = JSON.stringify(state);
  const audit = auditReviewSession(state);
  assert.equal(audit.active, 499);
  assert.equal(audit.keep, 0);
  assert.equal(audit.unreviewed, 499);
  assert.ok(audit.issues.some((issue) => issue.code === 'removed-selection' && issue.frameId === removedId));
  assert.equal(audit.safeForAutomaticDecisions, false);
  assert.equal(JSON.stringify(state), before);
});

test('epoch-zero removed comparison is flagged instead of silently accepted', () => {
  const state = createDemoShootState(3);
  state.frames[1] = { ...state.frames[1], removedAt: 0 };
  state.compareRightFrameId = state.frames[1].id;
  const audit = auditReviewSession(state);
  assert.ok(audit.issues.some((issue) => issue.code === 'removed-compare'));
});

test('epoch-zero removed photos cannot masquerade as valid undo targets', () => {
  const state = createDemoShootState(3);
  state.frames[1] = { ...state.frames[1], removedAt: 0 };
  state.undoStack.push({
    frameId: state.frames[1].id, prevDecision: 'unreviewed', nextDecision: 'keep',
    prevSelectedId: state.selectedFrameId, nextSelectedId: state.selectedFrameId,
  });
  assert.ok(auditReviewSession(state).issues.some((issue) => issue.code === 'history-removed'));
});

test('dangling virtual-copy source fails closed without changing the 500-photo review', () => {
  const state = createDemoShootState(500);
  state.frames[10] = { ...state.frames[10], virtualCopy: { originalFrameId: 'missing-original', number: 1 } };
  const before = JSON.stringify(state);
  const audit = auditReviewSession(state);
  assert.equal(audit.active, 500);
  assert.equal(audit.safeForAutomaticDecisions, false);
  assert.ok(audit.issues.some((issue) => issue.code === 'virtual-copy-missing-source' && issue.frameId === state.frames[10].id));
  assert.equal(JSON.stringify(state), before);
});

test('virtual copy cannot use itself as its source', () => {
  const state = createDemoShootState(2);
  state.frames[1] = { ...state.frames[1], virtualCopy: { originalFrameId: state.frames[1].id, number: 1 } };
  const audit = auditReviewSession(state);
  assert.ok(audit.issues.some((issue) => issue.code === 'virtual-copy-self-source'));
  assert.equal(audit.safeForAutomaticDecisions, false);
});

test('ambiguous duplicate source identity is not accepted as a virtual-copy source', () => {
  const state = createDemoShootState(3);
  const originalId = state.frames[0].id;
  state.frames[1] = { ...state.frames[1], id: originalId };
  state.frames[2] = { ...state.frames[2], virtualCopy: { originalFrameId: originalId, number: 1 } };
  const audit = auditReviewSession(state);
  assert.ok(audit.issues.some((issue) => issue.code === 'virtual-copy-missing-source' && issue.frameId === state.frames[2].id));
});

test('valid virtual-copy source passes preflight', () => {
  const state = createDemoShootState(3);
  state.frames[2] = { ...state.frames[2], virtualCopy: { originalFrameId: state.frames[0].id, number: 1 } };
  assert.equal(auditReviewSession(state).safeForAutomaticDecisions, true);
});
