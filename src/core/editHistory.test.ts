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

test('long histories record compaction rather than misrepresenting earliest checkpoint as import', () => {
  let frame = { id: 'long-history' } as PhotoFrame;
  for (let i = 0; i < 65; i++) {
    frame = recordEdit(frame, { edit: { exposure: i / 100, warmth: 0, colour: 0 } }, 1000 + i * 1000);
  }
  assert.equal(frame.editHistory?.steps.length, 60);
  assert.equal(frame.editHistory?.discarded, 5);
  assert.equal(frame.editHistory?.cursor, 60);
  const earliest = recipeAt(frame.editHistory!, 0);
  assert.ok((earliest?.edit?.exposure ?? 0) > 0, 'retained step zero is NOT original');
});


test('overlay-only steps survive JSON reload, Undo, Redo and branching edits', () => {
  const original = { id: 'overlay', overlay: { textEnabled: false, textX: 12 } } as PhotoFrame;
  const edited = recordEdit(original, { overlay: { textEnabled: true, textX: 74 } }, 1000);
  assert.equal(edited.editHistory?.steps[0].kind, 'adjustments');
  assert.equal(edited.editHistory?.cursor, 1);
  const back = stepEdit(JSON.parse(JSON.stringify(edited)) as PhotoFrame, -1);
  assert.deepEqual(back.overlay, original.overlay);
  const forward = stepEdit(back, 1);
  assert.deepEqual(forward.overlay, { textEnabled: true, textX: 74 });
  assert.equal(forward.id, original.id);
  const another = recordEdit(back, { overlay: { textEnabled: true, textX: 20 } }, 3000);
  assert.equal(another.editHistory?.steps.length, 1, 'later undone steps are discarded when a new edit begins');
  assert.deepEqual(another.overlay, { textEnabled: true, textX: 20 });
});

test('legacy snapshots with no overlay keep current overlays rather than erasing them', () => {
  let frame = { id: 'old-catalogue' } as PhotoFrame;
  frame = recordEdit(frame, { edit: { exposure: 1, warmth: 0, colour: 0 } }, 1000);
  const legacy = JSON.parse(JSON.stringify(frame)) as PhotoFrame;
  legacy.overlay = { textX: 62 };
  assert.deepEqual(stepEdit(legacy, -1).overlay, { textX: 62 });
  assert.deepEqual(jumpToStep(legacy, 0).overlay, { textX: 62 });
});

test('rapid bulk template or watermark change never absorbs a distinct neighbouring image edit', () => {
  const base = { id: 'both', overlay: { textEnabled: false } } as PhotoFrame;
  const colour = recordEdit(base, { edit: { exposure: 1, warmth: 0, colour: 0, contrast: 0.3 } }, 1000);
  const overlay = recordEdit(colour, { overlay: { textEnabled: true } }, 1200);
  assert.equal(overlay.editHistory?.steps.length, 2, 'two separately reversible user intentions');
  const back = stepEdit(overlay, -1);
  assert.deepEqual(back.overlay, { textEnabled: false });
  assert.equal(back.edit?.exposure, 1);
  const first = stepEdit(back, -1);
  assert.equal(first.edit, undefined);
  assert.deepEqual(first.overlay, { textEnabled: false });
});
