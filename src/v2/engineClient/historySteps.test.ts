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

test('old long edit histories do not mislabel the earliest saved checkpoint as imported Original', () => {
  let current = frame;
  for (let i = 1; i <= 70; i++) {
    current = recordEdit(current, { edit: { exposure: i / 100 } as never }, i * 1000);
  }
  const info = describeHistory(current.editHistory)!;
  assert.equal(info.steps.length, 60);
  assert.equal(info.originalAvailable, false);
  assert.equal(current.editHistory?.discarded, 10);
  const short = describeHistory(recordEdit(frame, { edit: { exposure: 0.1 } as never }, 1000).editHistory)!;
  assert.equal(short.originalAvailable, true);
});


test('actual changes to photo text and watermark appear in History, not a fake generic adjustment', () => {
  const withOverlay = recordEdit({ ...frame, overlay: { textEnabled: false } }, { overlay: { textEnabled: true } }, 1000);
  const info = describeHistory(withOverlay.editHistory)!;
  assert.deepEqual(info.steps.map(step => step.label), ['Text and watermark']);
  assert.equal(info.cursor, 1);
  const back = jumpToStep(withOverlay, 0);
  assert.deepEqual(back.overlay, { textEnabled: false });
});


test('split/rejoin steps are labelled accurately, without pretending to change image pixels', () => {
  let current = recordEdit(frame, { formatSplits: { 'orig-3x2': { enabled: true, offset: 0 } } }, 1000);
  current = recordEdit(current, { formatSplits: { 'orig-3x2': { enabled: true, offset: 0, count: 3 } } }, 1100);
  current = recordEdit(current, { formatSplits: {} }, 1200);
  const info = describeHistory(current.editHistory)!;
  assert.deepEqual(info.steps.map(step => step.label), [
    'Split or rejoin frames', 'Split or rejoin frames', 'Split or rejoin frames',
  ]);
  assert.equal(info.cursor, 3);
  assert.deepEqual(jumpToStep(current, 2).formatSplits, { 'orig-3x2': { enabled: true, offset: 0, count: 3 } });
});

test('a step Auto made says so, lists what changed with real values and gives Auto\'s reasons; it is never merged', () => {
  let current = recordEdit(frame, { edit: { exposure: 0, warmth: 0, colour: 0, shadows: 0.2 } as never }, 1000);
  current = recordEdit(current, { edit: { exposure: 1.75, warmth: 0, colour: 0, shadows: 0.7 } as never }, 1100,
    { by: 'auto', notes: ['The bird was a stop too dark.', 'Shadows lifted to keep the feathers readable.'] });
  const info = describeHistory(current.editHistory)!;
  assert.equal(info.steps.length, 2, 'Auto\'s step is its own, even within half a second');
  const auto = info.steps[1];
  assert.equal(auto.label, 'Auto');
  assert.equal(auto.by, 'auto');
  assert.deepEqual(auto.changes, [
    { label: 'Exposure', from: '0.00 EV', to: '+0.70 EV' },
    { label: 'Shadows', from: '+10', to: '+35' },
  ]);
  assert.deepEqual(auto.why, ['The bird was a stop too dark.', 'Shadows lifted to keep the feathers readable.']);
  assert.equal(info.steps[0].by, undefined);
});

test('a Lightroom import step is labelled as such', () => {
  const current = recordEdit(frame, { edit: { exposure: 1, warmth: 0, colour: 0 } as never }, 1000, { by: 'lightroom' });
  const [step] = describeHistory(current.editHistory)!.steps;
  assert.equal(step.label, 'Brought in from Lightroom');
  assert.equal(step.why, undefined);
});
