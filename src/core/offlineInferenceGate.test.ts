import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOfflineInferenceGate, type InferenceRequest } from './offlineInferenceGate';

function fixture() {
  let opens = 0, executions = 0, bundles = 0;
  const runtime = { async open(_id: string, _bundled: () => Promise<Uint8Array | undefined>) {
    opens++;
    return { bytes: new Uint8Array([1, 2]), source: 'active' as const };
  } };
  const gate = createOfflineInferenceGate(runtime);
  const request: InferenceRequest<string> = {
    mode: 'glide', explicitlyRequested: false, soarOptIn: false,
    model: { id: 'bird-mask', rightsApproved: true, estimatedRamBytes: 1024, backend: 'cpu' },
    device: { availableRamBytes: 8192, maxModelRamBytes: 4096, onBattery: false, allowedBackends: ['cpu'] },
    bundled: async () => { bundles++; return undefined; },
    runLocal: async (bytes) => { executions++; assert.deepEqual(bytes, new Uint8Array([1, 2])); return 'reversible suggestion'; },
    classical: () => 'classical suggestion',
  };
  return { gate, request, get opens() { return opens; }, get executions() { return executions; },
    get bundles() { return bundles; } };
}
test('Glide uses verified offline bytes without requesting a download', async () => {
  const f = fixture();
  const result = await f.gate.propose(f.request);
  assert.deepEqual(result, { value: 'reversible suggestion', source: 'local-model',
    assetSource: 'active', backend: 'cpu' });
  assert.equal(f.opens, 1); assert.equal(f.executions, 1); assert.equal(f.bundles, 0);
});
test('Fly Solo is manual-only and Soar requires opt-in', async () => {
  const f = fixture();
  assert.equal((await f.gate.propose({ ...f.request, mode: 'fly-solo' })).reason, 'permission');
  assert.equal((await f.gate.propose({ ...f.request, mode: 'soar' })).reason, 'permission');
  assert.equal(f.opens, 0);
  assert.equal((await f.gate.propose({ ...f.request, mode: 'fly-solo', explicitlyRequested: true })).source, 'local-model');
});
test('rights, memory and backend constraints refuse model execution', async () => {
  const f = fixture();
  assert.equal((await f.gate.propose({ ...f.request, model: { ...f.request.model, rightsApproved: false } })).reason, 'rights');
  assert.equal((await f.gate.propose({ ...f.request, device: { ...f.request.device, availableRamBytes: 1024 } })).reason, 'device-budget');
  assert.equal((await f.gate.propose({ ...f.request, device: { ...f.request.device, allowedBackends: ['coreml'] } })).reason, 'device-budget');
  assert.equal((await f.gate.propose({ ...f.request, device: { ...f.request.device, onBattery: true, batteryPercent: 8 } })).reason, 'device-budget');
  assert.equal(f.opens, 0); assert.equal(f.executions, 0);
});
test('missing assets and failed adapters use deterministic classical fallback', async () => {
  const f = fixture();
  const missing = createOfflineInferenceGate({ open: async () => ({ bytes: undefined, source: 'unavailable' as const }) });
  assert.equal((await missing.propose(f.request)).reason, 'missing-asset');
  const failed = await f.gate.propose({ ...f.request, runLocal: async () => { throw Error('GPU lost'); } });
  assert.equal(failed.source, 'classical'); assert.equal(failed.reason, 'model-error');
});
test('concurrent jobs cannot overcommit device memory', async () => {
  const f = fixture();
  let release!: (value: string) => void;
  const running = f.gate.propose({ ...f.request, runLocal: async () => new Promise<string>(resolve => { release = resolve; }) });
  // Await until the model adapter has started without relying on timers.
  for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
  assert.equal(typeof release, 'function');
  assert.equal((await f.gate.propose(f.request)).reason, 'busy');
  release('done');
  assert.equal((await running).source, 'local-model');
  assert.equal((await f.gate.propose(f.request)).source, 'local-model');
});
test('abort before admission or after execution never returns model suggestions', async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  assert.equal((await f.gate.propose({ ...f.request, signal: controller.signal })).reason, 'cancelled');
  assert.equal(f.opens, 0);
  const late = new AbortController();
  assert.equal((await f.gate.propose({ ...f.request, signal: late.signal,
    runLocal: async () => { late.abort(); return 'stale suggestion'; } })).reason, 'cancelled');
});
