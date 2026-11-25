import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoShootState } from '../../core/cullingEngine';
import { photoSidecar } from '../../core/photoSidecar';
import { applySidecarImports, planXmpImports, sidecarFailureText, xmpScope } from './xmpOps';
import { SidecarImportError } from '../../core/xmpImportPlan';
import type { CullingState } from '../../core/types';

function shoot(): CullingState {
  const base = createDemoShootState(3);
  return {
    ...base,
    frames: base.frames.map((frame, i) => ({ ...frame, isDemo: false, removedAt: undefined, filename: `DSC_000${i}.jpg`, decision: 'unreviewed', rating: 0, tags: [], autoTags: [] })),
  };
}

test('xmpScope covers the selection when two or more are selected, otherwise the whole project', () => {
  const state = shoot();
  const [a, b, c] = state.frames;
  assert.deepEqual(xmpScope(state.frames, [a.id]).map((f) => f.id), [a.id, b.id, c.id]);
  assert.deepEqual(xmpScope(state.frames, [a.id, c.id]).map((f) => f.id), [a.id, c.id]);
  const removed = state.frames.map((f) => (f.id === b.id ? { ...f, removedAt: Date.now() } : f));
  assert.deepEqual(xmpScope(removed, []).map((f) => f.id), [a.id, c.id], 'removed photos are never written or read');
});

// Node has no DOMParser, so these inject the parser result; the real XML round trip is in tests/v2-xmp.spec.ts.
test('matching sidecars apply rating, flag and tags to that photo only', async () => {
  const source = shoot();
  const kept = { ...source.frames[0], rating: 4, decision: 'keep' as const, tags: ['Kestrel'] };
  const written = photoSidecar(kept);
  const file = new File([new Uint8Array(written.bytes)], written.filename, { type: 'application/rdf+xml' });
  const target = shoot();
  const planned = await planXmpImports([file], xmpScope(target.frames, []), target.frames, async () => ({ rating: 4, decision: 'keep', keywords: ['Kestrel'] }));
  assert.equal(planned.length, 1);
  const after = applySidecarImports(target, planned);
  const frame = after.frames.find((f) => f.id === target.frames[0].id)!;
  assert.equal(frame.rating, 4);
  assert.equal(frame.decision, 'keep');
  assert.deepEqual(frame.tags, ['Kestrel']);
  assert.ok(after.frames.slice(1).every((f) => f.rating === 0 && f.decision === 'unreviewed'), 'other photos are untouched');
});

test('a sidecar that would set aside a flagged photo changes nothing and says why', async () => {
  const state = shoot();
  const aside = photoSidecar({ ...state.frames[0], decision: 'reject' });
  const file = new File([new Uint8Array(aside.bytes)], aside.filename);
  const flagged = { ...state, frames: state.frames.map((f, i) => (i === 0 ? { ...f, decision: 'keep' as const } : f)) };
  await assert.rejects(planXmpImports([file], flagged.frames, flagged.frames, async () => ({ decision: 'reject', keywords: [] })), (error) => error instanceof SidecarImportError && error.reason === 'keeper');
  assert.match(sidecarFailureText(new SidecarImportError('keeper')), /flagged/);
  assert.match(sidecarFailureText(new Error('x')), /Nothing was changed/);
});
