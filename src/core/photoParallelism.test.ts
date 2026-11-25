import assert from 'node:assert/strict';
import test from 'node:test';
import { photoParallelism } from './photoParallelism';

const big = { cores: 64, memoryGB: 256 };

test('desktop ceilings: Basic 5, Pro 20, Pro with cloud 50 (local 20 + 30 asked of the cloud)', () => {
  assert.deepEqual(photoParallelism({ desktop: true, paid: false, cloud: false, ...big }), { ceiling: 5, local: 5, cloudRequest: 0, heldBy: null });
  assert.deepEqual(photoParallelism({ desktop: true, paid: true, cloud: false, ...big }), { ceiling: 20, local: 20, cloudRequest: 0, heldBy: null });
  assert.deepEqual(photoParallelism({ desktop: true, paid: true, cloud: true, ...big }), { ceiling: 50, local: 20, cloudRequest: 30, heldBy: null });
});

test('phone ceilings: Basic 1, Pro 3, and the cloud takes the rest up to 50', () => {
  assert.equal(photoParallelism({ desktop: false, paid: false, cloud: false, ...big }).local, 1);
  assert.equal(photoParallelism({ desktop: false, paid: true, cloud: false, ...big }).local, 3);
  assert.deepEqual(photoParallelism({ desktop: false, paid: true, cloud: true, ...big }), { ceiling: 50, local: 3, cloudRequest: 47, heldBy: null });
});

test('cloud is never asked without a paid licence, and Basic never gets the cloud ceiling', () => {
  assert.deepEqual(photoParallelism({ desktop: true, paid: false, cloud: true, ...big }), { ceiling: 5, local: 5, cloudRequest: 0, heldBy: null });
});

test('the device is held to its memory: a 2 GB model on a 16 GB laptop runs 7, not 20', () => {
  const plan = photoParallelism({ desktop: true, paid: true, cloud: false, cores: 16, memoryGB: 16, perPhotoBytes: 2 * 1024 ** 3 });
  assert.equal(plan.local, 7);
  assert.equal(plan.heldBy, 'memory');
  // With the cloud on, what the laptop cannot hold is asked of the cloud instead.
  assert.equal(photoParallelism({ desktop: true, paid: true, cloud: true, cores: 16, memoryGB: 16, perPhotoBytes: 2 * 1024 ** 3 }).cloudRequest, 43);
});

test('held to cores (one kept for the interface), never below one photo, unknown hardware keeps the ceiling', () => {
  assert.deepEqual(photoParallelism({ desktop: true, paid: true, cloud: false, cores: 8, memoryGB: 64 }), { ceiling: 20, local: 7, cloudRequest: 0, heldBy: 'cores' });
  assert.equal(photoParallelism({ desktop: false, paid: true, cloud: false, cores: 1, memoryGB: 1 }).local, 1);
  assert.equal(photoParallelism({ desktop: true, paid: true, cloud: false }).local, 20);
});
