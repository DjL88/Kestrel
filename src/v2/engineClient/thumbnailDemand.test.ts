import assert from 'node:assert/strict';
import test from 'node:test';
import { ThumbnailDemand } from './thumbnailDemand';

test('large catalogue only queues retained viewport tiles', () => {
  const demand = new ThumbnailDemand();
  const catalogue = Array.from({ length: 10000 }, (_, i) => String(i));
  for (const id of catalogue.slice(100, 120)) demand.retain(id);
  assert.deepEqual(demand.next(8, '115'), ['115','100','101','102','103','104','105','106']);
  assert.equal(demand.next(10000).length, 20);
});

test('grid and filmstrip share demand without duplicate reads', () => {
  const demand = new ThumbnailDemand();
  const grid = demand.retain('photo');
  const filmstrip = demand.retain('photo');
  assert.deepEqual(demand.next(8), ['photo']);
  grid(); grid();
  assert.equal(demand.has('photo'), true);
  filmstrip();
  assert.equal(demand.has('photo'), false);
  assert.deepEqual(demand.next(8), []);
});

test('rapid scroll drops unstarted requests and cached tiles do not requeue', () => {
  const demand = new ThumbnailDemand();
  const release = demand.retain('old');
  demand.retain('cached');
  demand.mark('cached');
  release();
  demand.retain('new');
  assert.deepEqual(demand.next(8), ['new']);
  demand.invalidate('cached');
  assert.deepEqual(demand.next(8), ['cached','new']);
});
