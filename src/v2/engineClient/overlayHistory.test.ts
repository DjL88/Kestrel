import assert from 'node:assert/strict';
import test from 'node:test';
import { generateDemoShootFrames } from '../../core/cullingEngine';
import { stepEdit } from '../../core/editHistory';
import type { CullingState, PhotoFrame } from '../../core/types';
import { createDefaultOverlay } from '../ui/stub';
import { readOverlay } from './overlayOps';
import { addTemplate } from './overlayTemplates';
import { applyOverlayTemplateToProject, changePhotoOverlay } from './overlayHistory';

function catalogue() {
  const frames = generateDemoShootFrames(3);
  frames[1] = { ...frames[1], overlay: { ...createDefaultOverlay(false), textX: 15, textEnabled: true } };
  const state = { shoot: { lastUpdatedAt: 100 } as CullingState['shoot'], frames } as CullingState;
  return { frames, state };
}

test('a real overlay slider edit is saved, undoable and redoable without touching the image recipe', () => {
  const { frames } = catalogue();
  const original = frames[0];
  const changed = changePhotoOverlay(original, before => ({ ...before, textX: 44, textEnabled: true }), 1000);
  assert.notEqual(changed, original);
  assert.equal(readOverlay(changed.overlay).textX, 44);
  assert.equal(changed.edit, original.edit);
  assert.equal(changed.originalSha256, original.originalSha256);
  assert.equal(changed.editHistory?.cursor, 1);
  const reopened = JSON.parse(JSON.stringify(changed)) as PhotoFrame;
  const undone = stepEdit(reopened, -1);
  assert.equal(readOverlay(undone.overlay).textEnabled, false);
  assert.equal(undone.edit, original.edit);
  assert.equal(readOverlay(stepEdit(undone, 1).overlay).textX, 44);
  assert.equal(changePhotoOverlay(changed, before => before, 1200), changed,
    'no-op must not add fabricated history events');
});

test('bulk overlay templates change only live selected photos and can be undone on each after reopening', () => {
  const { frames, state } = catalogue();
  const template = addTemplate([], 'Proof watermark', {
    ...createDefaultOverlay(false), watermarkEnabled: true, watermarkX: 80, textEnabled: true,
  }, 'tpl-proof001', 800)![0];
  const originalSecond = readOverlay(frames[1].overlay);
  const removedThird = { ...frames[2], removedAt: 700 };
  const withRemoved = { ...state, frames: [frames[0], frames[1], removedThird] };
  const result = applyOverlayTemplateToProject(withRemoved, template,
    [frames[0].id, frames[1].id, frames[0].id, frames[2].id, 'missing'], 2000);
  assert.equal(result.changed, 2, 'each real live photograph is changed once');
  assert.equal(result.state.frames[2], removedThird, 'never change a removed photograph');
  assert.equal(result.state.shoot.lastUpdatedAt, 2000);
  assert.equal(readOverlay(result.state.frames[0].overlay).watermarkEnabled, true);
  assert.equal(readOverlay(result.state.frames[1].overlay).watermarkX, 80);
  assert.equal(readOverlay(frames[0].overlay).watermarkEnabled, false,
    'saved original object cannot be mutated by applying the template');
  const roundTrip = JSON.parse(JSON.stringify(result.state)) as CullingState;
  const backFirst = stepEdit(roundTrip.frames[0], -1);
  const backSecond = stepEdit(roundTrip.frames[1], -1);
  assert.equal(readOverlay(backFirst.overlay).watermarkEnabled, false);
  assert.deepEqual(readOverlay(backSecond.overlay), originalSecond);
  assert.equal(readOverlay(stepEdit(backFirst, 1).overlay).watermarkX, 80);
  assert.equal(readOverlay(roundTrip.frames[2].overlay).watermarkEnabled, false);
  const repeat = applyOverlayTemplateToProject(result.state, template, [frames[0].id, frames[1].id], 3000);
  assert.equal(repeat.changed, 0);
  assert.equal(repeat.state, result.state, 'an identical template does not change project save time');
});

test('overlay history coexists with a real edit, preserving both when Undo traverses the timeline', () => {
  const { frames } = catalogue();
  const withOverlay = changePhotoOverlay(frames[0], before => ({ ...before, watermarkEnabled: true }), 1000);
  const withEdit = {
    ...withOverlay,
    edit: { exposure: 1, warmth: 0, colour: 0 },
  };
  assert.equal(withEdit.edit?.exposure, 1);
  const back = stepEdit(withOverlay, -1);
  assert.equal(readOverlay(back.overlay).watermarkEnabled, false);
  assert.equal(withOverlay.edit, frames[0].edit);
  assert.equal(withEdit.originalSha256, frames[0].originalSha256);
});
