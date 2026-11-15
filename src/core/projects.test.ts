import test from 'node:test';
import assert from 'node:assert/strict';
import { appendProjectPhotos, createEmptyProject } from './projects';
import { generateDemoShootFrames } from './cullingEngine';

test('adding photos is additive, keeps decisions, and deduplicates originals across imports', () => {
  const [a, b] = generateDemoShootFrames(2);
  const empty = createEmptyProject('shoot', 'Dogs');
  const first = appendProjectPhotos(empty, [{ ...a, decision: 'keep', rating: 5 }], 'first');
  const second = appendProjectPhotos(first, [a, b], 'second');
  assert.equal(second.shoot.title, 'Dogs');
  assert.equal(second.shoot.totalFrames, 2);
  assert.equal(second.selectedFrameId, first.selectedFrameId);
  assert.equal(second.frames[0].decision, 'keep');
  assert.equal(second.frames[0].rating, 5);
  assert.equal(second.frames[1].sequenceIndex, 2);
  assert.notEqual(second.frames[0].id, second.frames[1].id);
});
