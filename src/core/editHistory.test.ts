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
