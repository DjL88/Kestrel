import test from 'node:test';
import assert from 'node:assert/strict';
import { createVirtualCopy } from './virtualCopies';
import { generateDemoShootFrames } from './cullingEngine';

test('virtual copies share the source and start as independent edit versions', () => {
  const [frame] = generateDemoShootFrames(1);
  const original = { ...frame, filename: 'kite.NEF', decision: 'keep' as const, edit: { exposure: 1, warmth: 0, colour: 0 } };
  const first = createVirtualCopy(original, [original], 'copy-1');
  const second = createVirtualCopy(first, [original, first], 'copy-2');
  assert.equal(first.stableKey, original.stableKey);
  assert.equal(first.decision, 'unreviewed');
  assert.deepEqual(first.edit, original.edit);
  assert.notEqual(first.edit, original.edit);
  assert.equal(second.filename, 'kite · Copy 2.NEF');
  assert.equal(second.virtualCopy?.originalFrameId, original.id);
});
