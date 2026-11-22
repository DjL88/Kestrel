import assert from 'node:assert/strict';
import test from 'node:test';
import { describeHistory } from './historySteps.ts';
import { jumpToStep, recordEdit } from '../../core/editHistory.ts';
import type { PhotoFrame } from '../../core/types.ts';

const frame = { id: 'f', edit: undefined, framing: undefined } as unknown as PhotoFrame;

test('no history gives nothing to show', () => {
  assert.equal(describeHistory(undefined), undefined);
  assert.equal(describeHistory({ cursor: 0, steps: [] }), undefined);
});

test('steps are described in order with the cursor, and jumping back keeps later steps for redo', () => {
  let current = recordEdit(frame, { edit: { exposure: 0.5 } as never }, 1000);
  current = recordEdit(current, { edit: { exposure: 0.5, warmth: 10 } as never }, 5000);
  const info = describeHistory(current.editHistory)!;
  assert.deepEqual(info.steps.map((step) => step.label), ['Brightness', 'Warmth']);
  assert.equal(info.cursor, 2);
  const back = jumpToStep(current, 0);
  assert.equal(describeHistory(back.editHistory)!.cursor, 0);
  assert.equal(describeHistory(back.editHistory)!.steps.length, 2);
});
