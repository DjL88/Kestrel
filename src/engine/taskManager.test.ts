import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runEngineTask, type EngineTaskStore } from './taskManager.ts';

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
