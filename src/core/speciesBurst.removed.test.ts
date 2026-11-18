import test from 'node:test';
import assert from 'node:assert/strict';
import { burstMates, tagFrames } from './speciesBurst';
import { generateDemoShootFrames } from './cullingEngine';

test('epoch-zero removed photos never appear as burst mates or receive batch species tags', () => {
  const [base, removed, live, unrelated] = generateDemoShootFrames(4);
  const frames = [
    { ...base, burstGroupId: 'burst-a' },
    { ...removed, burstGroupId: 'burst-a', removedAt: 0 },
    { ...live, burstGroupId: 'burst-a' },
    { ...unrelated, burstGroupId: 'burst-b' },
  ];
  const original = structuredClone(frames);
  assert.deepEqual(burstMates(frames, frames[0]).map((frame) => frame.id), [frames[2].id]);
  assert.deepEqual(burstMates(frames, frames[1]), [], 'removed current photo cannot drive burst actions');
  const tagged = tagFrames(frames, frames.map((frame) => frame.id), 'Red kite', 'wildlife');
  assert.equal(tagged[1], frames[1], 'removed frame retains original object and metadata');
  assert.equal(tagged[0].tags?.includes('Red kite'), true);
  assert.equal(tagged[2].tags?.includes('Red kite'), true);
  assert.deepEqual(frames, original, 'source catalogue remains untouched');
});

test('removed photos with a normal timestamp remain excluded and live photos can still be tagged', () => {
  const [a, b] = generateDemoShootFrames(2);
  const frames = [{ ...a, removedAt: 123, burstGroupId: 'burst' }, { ...b, burstGroupId: 'burst' }];
  assert.deepEqual(burstMates(frames, frames[1]), []);
  assert.equal(tagFrames(frames, [a.id, b.id], 'Red kite', 'wildlife')[0], frames[0]);
});
