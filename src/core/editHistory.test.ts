import test from 'node:test';
import assert from 'node:assert/strict';
import { recordEdit, stepEdit } from './editHistory';
import { generateDemoShootFrames } from './cullingEngine';
import { DEFAULT_FRAMING } from './photoFraming';

test('edit history groups nearby slider changes and restores crop and colour independently', () => {
  const [frame] = generateDemoShootFrames(1);
  const first = recordEdit(frame, { edit: { exposure: 0.1, warmth: 0, colour: 0 } }, 100);
  const second = recordEdit(first, { edit: { exposure: 0.2, warmth: 0, colour: 0 } }, 200);
  const crop = recordEdit(second, { framing: { ...DEFAULT_FRAMING, ratio: 1 } }, 250);
  assert.deepEqual(crop.editHistory?.steps.map((step) => step.kind), ['light', 'crop']);
  const undone = stepEdit(crop, -1);
  assert.equal(undone.framing, undefined);
  assert.equal(stepEdit(undone, -1).edit, undefined);
  assert.equal(stepEdit(undone, 1).framing?.ratio, 1);
  const alternative = recordEdit(undone, { edit: { exposure: 0.2, warmth: 1, colour: 0 } }, 280);
  assert.deepEqual(alternative.editHistory?.steps.map((step) => step.kind), ['light', 'warmth']);
});

import { jumpToStep, recipeAt } from './editHistory';
import type { PhotoFrame } from './types';

function editedPhoto() {
  let frame = { id: 'f' } as PhotoFrame;
  frame = recordEdit(frame, { edit: { exposure: 1, warmth: 0, colour: 0 } }, 1000);
  frame = recordEdit(frame, { edit: { exposure: 1, warmth: 0, colour: 1 } }, 5000);
  frame = recordEdit(frame, { framing: { ratio: 1, turns: 0, straighten: 0, x: 0.5, y: 0.5 } }, 9000);
  return frame;
}

test('jumping back restores the recipe at that step and keeps later steps to redo', () => {
  const frame = editedPhoto();
  assert.equal(frame.editHistory?.cursor, 3);
  const back = jumpToStep(frame, 1);
  assert.equal(back.edit?.exposure, 1);
  assert.equal(back.edit?.colour, 0);
  assert.equal(back.framing, undefined);
  assert.equal(back.editHistory?.cursor, 1);
  assert.equal(back.editHistory?.steps.length, 3);
  const forward = jumpToStep(back, 3);
  assert.equal(forward.edit?.colour, 1);
  assert.equal(forward.framing?.ratio, 1);
});

test('step zero is the original, and out of range steps are clamped', () => {
  const frame = editedPhoto();
  const original = jumpToStep(frame, 0);
  assert.equal(original.edit, undefined);
  assert.equal(original.framing, undefined);
  assert.equal(jumpToStep(frame, 99).editHistory?.cursor, 3);
  assert.equal(jumpToStep(frame, -4).editHistory?.cursor, 0);
  assert.equal(jumpToStep(frame, 3), frame, 'jumping to where you already are changes nothing');
});

test('recipeAt reads a past recipe without changing anything', () => {
  const frame = editedPhoto();
  assert.equal(recipeAt(frame.editHistory!, 2)?.edit?.colour, 1);
  assert.equal(recipeAt(frame.editHistory!, 0)?.edit, undefined);
  assert.equal(recipeAt({ cursor: 0, steps: [] }, 0), undefined);
  assert.equal(frame.editHistory?.cursor, 3);
});
