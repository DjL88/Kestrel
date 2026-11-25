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


test('copy retains current recipe and formats without inheriting branches, delivery history or mutable recipe references', () => {
  const [frame] = generateDemoShootFrames(1);
  const original = { ...frame, originalSha256: 'a'.repeat(64),
    edit: { exposure: 1, warmth: 0, colour: 0 },
    editVersions: { version: 1 as const, activeId: 'fork', versions: [] },
    lastExport: { at: 100 }, formatHistory: [{ at: 10 }],
    overlay: { text: 'Original caption' }, sizeCrops: { square: { zoom: 2 } },
    v2EditGroups: { groups: [{ id: 'group', name: 'Print' }] } };
  const copy = createVirtualCopy(original, [original], 'copy-1');
  assert.equal(copy.originalSha256, original.originalSha256);
  assert.equal(copy.editVersions, undefined);
  assert.equal(copy.formatHistory, undefined);
  assert.equal(copy.lastExport, undefined);
  assert.deepEqual(copy.sizeCrops, original.sizeCrops);
  assert.notEqual(copy.sizeCrops, original.sizeCrops);
  assert.deepEqual(copy.v2EditGroups, original.v2EditGroups);
  (copy.overlay as { text: string }).text = 'Copy caption';
  assert.equal(original.overlay.text, 'Original caption');
});
