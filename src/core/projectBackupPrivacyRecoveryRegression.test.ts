import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoShootState } from './cullingEngine';
import { encodeProjectBackup, restoreProjectBackup } from './projectBackup';

test('portable backup never exports local OCR/search evidence, including after cold reopen', () => {
  const project = createDemoShootState(1);
  const frame = project.frames[0];
  frame.searchEvidence = {
    schema: 1, sourceStableKey: 'fixture-original', modelRevision: 'fixture-v1', indexedAt: 1000,
    ocr: [{ value: 'private registration on original', status: 'confirmed' }], subjects: [],
  };
  const originalEvidence = structuredClone(frame.searchEvidence);
  const bytes = new TextEncoder().encode(encodeProjectBackup(project));
  const saved = new TextDecoder().decode(bytes);
  assert.equal(saved.includes('private registration on original'), false);
  const restored = restoreProjectBackup(saved, 'offline-copy', 1000);
  assert.equal(restored.frames[0].searchEvidence, undefined);
  assert.deepEqual(project.frames[0].searchEvidence, originalEvidence);
});

test('portable restore requires local source reauthorisation rather than trusting saved file access', () => {
  for (const sourceKind of ['file', 'directory-handle'] as const) {
    const project = createDemoShootState(1);
    project.frames[0].isDemo = false;
    project.frames[0].sourceKind = sourceKind;
    delete project.frames[0].demoVariant;
    const restored = restoreProjectBackup(encodeProjectBackup(project), 'offline-copy', 1000);
    assert.equal(restored.shoot.needsFileReselect, sourceKind === 'file');
    assert.equal(restored.shoot.needsFolderRegrant, sourceKind === 'directory-handle');
    assert.equal(restored.frames[0].sourceKind, sourceKind);
  }
});

test('tampered selection links restore to null without changing the live project', () => {
  const project = createDemoShootState(2);
  project.selectedFrameId = project.frames[0].id;
  project.compareRightFrameId = project.frames[1].id;
  const saved = JSON.parse(encodeProjectBackup(project));
  saved.project.selectedFrameId = 'nonexistent-photo';
  saved.project.compareRightFrameId = 'nonexistent-comparison';
  const restored = restoreProjectBackup(JSON.stringify(saved), 'offline-copy');
  assert.equal(restored.selectedFrameId, null);
  assert.equal(restored.compareRightFrameId, null);
  assert.equal(project.selectedFrameId, project.frames[0].id);
  assert.equal(project.compareRightFrameId, project.frames[1].id);
});
