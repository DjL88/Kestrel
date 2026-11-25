import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runEngineTask, type EngineTaskStore } from './taskManager.ts';
import { createEngineScheduler } from '../core/engineScheduler.ts';
import { createTaskStore } from '../core/taskStore.ts';

function scheduled() {
  const store = createTaskStore();
  const scheduler = createEngineScheduler({ taskStore: store, limits: { cpu: 1, gpu: 1, io: 1 } });
  return { store, scheduler };
}

function fakeStore() {
  const calls: { started: string[]; finished: string[]; failed: string[] } = { started: [], finished: [], failed: [] };
  const store: EngineTaskStore = {
    start(title) {
      calls.started.push(title);
      return {
        id: 1,
        progress: () => {},
        finish: (detail) => { calls.finished.push(detail ?? ''); },
        fail: (message) => { calls.failed.push(message); },
        cancelled: false,
      };
    },
  };
  return { store, calls };
}

describe('runEngineTask', () => {
  it('starts and finishes the task on success, recording the capability and runner', async () => {
    const { store, calls } = fakeStore();
    const result = await runEngineTask('vision-scene', 'device', 'Reading scene', async () => 42, { store });
    assert.equal(result, 42);
    assert.deepEqual(calls.started, ['Reading scene']);
    assert.deepEqual(calls.finished, ['vision-scene (device)']);
    assert.deepEqual(calls.failed, []);
  });

  it('fails the task and rethrows when the work throws', async () => {
    const { store, calls } = fakeStore();
    await assert.rejects(
      runEngineTask('denoise', 'cloud-gemini', 'Denoising', async () => { throw new Error('model unavailable'); }, { store }),
      /model unavailable/,
    );
    assert.deepEqual(calls.failed, ['model unavailable']);
    assert.deepEqual(calls.finished, []);
  });

  it('records a non-Error throw as a string message', async () => {
    const { store, calls } = fakeStore();
    await assert.rejects(runEngineTask('mask', 'device', 'Masking', async () => { throw 'boom'; }, { store }));
    assert.deepEqual(calls.failed, ['boom']);
  });
});

describe('runEngineTask through the Task Manager', () => {
  it('runs on its own as one scheduled task and returns the result', async () => {
    const { store, scheduler } = scheduled();
    const result = await runEngineTask('mask', 'device', 'Applying masks', async () => 7, { scheduler });
    assert.equal(result, 7);
    const rows = store.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'Applying masks');
    assert.equal(rows[0].state, 'done');
  });

  it('rethrows the work\'s own error and marks the task failed', async () => {
    const { store, scheduler } = scheduled();
    await assert.rejects(
      runEngineTask('denoise', 'device', 'Denoising', async () => { throw new Error('model unavailable'); }, { scheduler }),
      /model unavailable/,
    );
    assert.equal(store.list()[0].state, 'failed');
  });

  it('waits its turn behind a heavy batch that is already running', async () => {
    const { scheduler } = scheduled();
    const order: string[] = [];
    let release!: () => void;
    const ticket = await scheduler.submit({
      title: 'Export', kind: 'export', resource: 'gpu', snapshot: undefined, items: ['a'], itemId: x => x, itemLabel: x => x,
      runItem: () => new Promise<void>(resolve => { release = () => { order.push('export'); resolve(); }; }),
    });
    const engine = runEngineTask('upscale', 'device', 'Upscaling', async () => { order.push('upscale'); }, { scheduler });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(order, []);
    release();
    await ticket.finished;
    await engine;
    assert.deepEqual(order, ['export', 'upscale']);
  });

  it('runs inside the batch that called it: no second row, and no wait for its own slot', async () => {
    const { store, scheduler } = scheduled();
    let inner: number | undefined;
    const ticket = await scheduler.submit({
      title: 'Export', kind: 'export', resource: 'gpu', snapshot: undefined, items: ['a'], itemId: x => x, itemLabel: x => x,
      runItem: async (_item, _snapshot, ctx) => {
        inner = await runEngineTask('upscale', 'device', 'Upscaling', async () => 2, { scheduler, signal: ctx.signal });
      },
    });
    const result = await Promise.race([ticket.finished, new Promise(resolve => setTimeout(() => resolve('stuck'), 2000))]);
    assert.equal(result, 'done');
    assert.equal(inner, 2);
    assert.deepEqual(store.list().map(task => task.title), ['Export']);
  });

  it('stops when the caller cancels, with an AbortError', async () => {
    const { store, scheduler } = scheduled();
    const controller = new AbortController();
    let release!: () => void;
    await scheduler.submit({
      title: 'Export', kind: 'export', resource: 'gpu', snapshot: undefined, items: ['a'], itemId: x => x, itemLabel: x => x,
      runItem: () => new Promise<void>(resolve => { release = resolve; }),
    });
    const engine = runEngineTask('mask', 'device', 'Applying masks', async () => 1, { scheduler, signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort();
    await assert.rejects(engine, (error: Error) => error.name === 'AbortError');
    release();
    assert.equal(store.list().find(task => task.title === 'Applying masks')?.state, 'cancelled');
  });
});
