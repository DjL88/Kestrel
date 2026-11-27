import assert from 'node:assert/strict';
import test from 'node:test';
import { startNativeResourceSampling } from './nativeResourceSample';
import type { ResourceSample } from '../core/resourcePolicy';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('the desktop app\'s CPU load and free memory reach the scheduler, again every interval, until stopped', async () => {
  const seen: Array<ResourceSample | null> = [];
  let calls = 0;
  const stop = startNativeResourceSampling((sample) => seen.push(sample), 5,
    async () => { calls += 1; return { cpu: calls === 1 ? null : 0.4, availableMemoryBytes: 6e9 }; }, () => true);
  await wait(30);
  stop();
  assert.deepEqual(seen[0], { availableMemoryBytes: 6e9 }, 'no CPU figure on the first sample');
  assert.deepEqual(seen[1], { availableMemoryBytes: 6e9, cpu: 0.4 });
  assert.equal(seen.at(-1), null, 'stopping clears the measurement');
  const after = calls;
  await wait(20);
  assert.equal(calls, after, 'no more samples after stop');
});

test('no measurement in a browser, and an older build without the command falls back to one heavy job at a time', async () => {
  const browser: Array<ResourceSample | null> = [];
  startNativeResourceSampling((sample) => browser.push(sample), 5, async () => ({ availableMemoryBytes: 1 }), () => false);
  await wait(15);
  assert.deepEqual(browser, []);
  const old: Array<ResourceSample | null> = [];
  startNativeResourceSampling((sample) => old.push(sample), 5, async () => { throw new Error('unknown command'); }, () => true);
  await wait(15);
  assert.deepEqual(old, [null]);
});

test('with a measurement, the scheduler runs a second heavy job beside the first', async () => {
  const { createEngineScheduler } = await import('../core/engineScheduler');
  const { createTaskStore } = await import('../core/taskStore');
  const scheduler = createEngineScheduler({ taskStore: createTaskStore(), limits: { cpu: 3, gpu: 1, io: 1 } });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const first = await scheduler.submit({ title: 'Long job', kind: 'raw', resource: 'cpu', snapshot: null, items: [1], itemId: String, itemLabel: String, runItem: async () => held });
  let secondRan = false;
  const second = await scheduler.submit({ title: 'Second job', kind: 'cull', resource: 'cpu', snapshot: null, items: [1], itemId: String, itemLabel: String, runItem: async () => { secondRan = true; } });
  await wait(5);
  assert.equal(secondRan, false, 'unmeasured: one heavy job at a time');
  scheduler.updateResourceSample({ cpu: 0.3, availableMemoryBytes: 8e9 });
  assert.equal(await second.finished, 'done', 'measured with room: runs beside it');
  release();
  assert.equal(await first.finished, 'done');
});
