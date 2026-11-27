import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideCloudHelp, deviceIsBusy, parseCloudHelp, DEFAULT_CLOUD_HELP } from './cloudHelp';
import { createEngineScheduler } from './engineScheduler';

const load = (cpu: number, gpu: number, waiting = 0, io = 0) => ({ used: { cpu, gpu, io }, limits: { cpu: 3, gpu: 1, io: 2 }, waiting });

describe('cloud helps a busy device', () => {
  it('defaults to only when the device is busy', () => {
    assert.deepEqual(parseCloudHelp(undefined), DEFAULT_CLOUD_HELP);
    assert.equal(DEFAULT_CLOUD_HELP.denoise, 'when-busy');
  });
  it('keeps known choices and drops anything else', () => {
    assert.deepEqual(parseCloudHelp({ denoise: 'always', upscale: 'always' }), { denoise: 'always' });
    assert.deepEqual(parseCloudHelp({ denoise: 'sometimes' }), DEFAULT_CLOUD_HELP);
    assert.deepEqual(parseCloudHelp('off'), DEFAULT_CLOUD_HELP);
  });
  it('counts full processing or graphics slots, or a queue, as busy; disk work alone is not', () => {
    assert.equal(deviceIsBusy(load(0, 0)), false);
    assert.equal(deviceIsBusy(load(2, 0)), false);
    assert.equal(deviceIsBusy(load(3, 0)), true);
    assert.equal(deviceIsBusy(load(0, 1)), true);
    assert.equal(deviceIsBusy(load(0, 0, 1)), true);
    assert.equal(deviceIsBusy(load(0, 0, 0, 2)), false);
  });
  it('off never sends, always always sends, when-busy follows the device', () => {
    assert.deepEqual(decideCloudHelp('off', load(3, 1, 4)), { useCloud: false, reason: 'off' });
    assert.deepEqual(decideCloudHelp('always', load(0, 0)), { useCloud: true, reason: 'always' });
    assert.deepEqual(decideCloudHelp('when-busy', load(0, 0)), { useCloud: false, reason: 'not-busy' });
    assert.deepEqual(decideCloudHelp('when-busy', load(0, 1)), { useCloud: true, reason: 'busy' });
  });
  it('reads a real scheduler: idle, then busy while a graphics job runs and another waits', async () => {
    const scheduler = createEngineScheduler({ limits: { cpu: 1, gpu: 1, io: 1 }, watchdogMs: 0 });
    assert.equal(deviceIsBusy(scheduler.load()), false);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const def = (title: string) => ({ title, kind: 'denoise' as const, resource: 'gpu' as const, items: [{ id: title }], snapshot: undefined,
      itemId: (item: { id: string }) => item.id, itemLabel: (item: { id: string }) => item.id, runItem: () => gate });
    const first = await scheduler.submit(def('a'));
    const second = await scheduler.submit(def('b'));
    await new Promise(resolve => setTimeout(resolve, 0));
    const busy = scheduler.load();
    assert.equal(busy.used.gpu, 1);
    assert.equal(busy.waiting, 1);
    assert.equal(deviceIsBusy(busy), true);
    release();
    await first.finished; await second.finished;
    assert.equal(deviceIsBusy(scheduler.load()), false);
  });
});
