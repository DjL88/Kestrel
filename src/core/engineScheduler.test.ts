import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaskStore } from './taskStore.ts';
import { createEngineScheduler, limitsForDevice, NonRetryableTaskError, type BatchDefinition } from './engineScheduler.ts';

const pause = (ms = 1) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, reason: string, tries = 1000) {
  for (let i = 0; i < tries; i++) { if (check()) return; await pause(); }
  assert.fail(`Timed out: ${reason}`);
}
function build() {
  const store = createTaskStore();
  const scheduler = createEngineScheduler({ taskStore: store, limits: { cpu: 1, gpu: 1, io: 1 } });
  return { store, scheduler };
}
function batch(title: string, count: number, work: BatchDefinition<number, { mark: string }>['runItem'],
  rest: Partial<BatchDefinition<number, { mark: string }>> = {}): BatchDefinition<number, { mark: string }> {
  return { title, kind: 'export', resource: 'cpu', snapshot: { mark: 'unchanged' },
    items: Array.from({ length: count }, (_, i) => i + 1), itemId: n => String(n),
    itemLabel: n => `photo ${n}`, runItem: work, ...rest };
}

test('300-photo import stays queued while an interactive edit jumps ahead at the next photo', async () => {
  const { scheduler, store } = build();
  let release!: () => void;
  const firstItem = new Promise<void>(resolve => { release = resolve; });
  const order: string[] = [];
  const ingest = await scheduler.submit(batch('Import 300', 300, async n => {
    order.push(`import:${n}`);
    if (n === 1) await firstItem;
  }, { kind: 'import', priority: 1 }));
  await until(() => order.length === 1, 'import started');
  const edit = await scheduler.submit(batch('Interactive editor', 1, async n => { order.push(`edit:${n}`); }, { kind: 'auto-edit', priority: 20 }));
  assert.equal(store.list().find(t => t.id === edit.taskId)?.state, 'queued');
  release();
  assert.equal(await edit.finished, 'done');
  assert.deepEqual(order.slice(0, 3), ['import:1', 'edit:1', 'import:2']);
  assert.equal(await ingest.finished, 'done');
  assert.equal(store.list().find(t => t.id === ingest.taskId)?.done, 300);
});

test('50 exports pause after 18, prioritise five photos and resume without redoing 18 files', async () => {
  const { scheduler, store } = build();
  const original: number[] = [];
  const priority: number[] = [];
  let release18!: () => void;
  const eighteenth = new Promise<void>(resolve => { release18 = resolve; });
  const a = await scheduler.submit(batch('Fifty', 50, async n => { original.push(n); if (n === 18) await eighteenth; }));
  await until(() => original.length === 18, 'reached photo 18');
  assert.equal(a.pause(), true);
  const b = await scheduler.submit(batch('Priority five', 5, async n => { priority.push(n); }));
  assert.equal(b.jumpQueue(), true);
  release18();
  await until(() => store.list().find(t => t.id === a.taskId)?.state === 'paused', 'paused after photo 18');
  assert.equal(await b.finished, 'done');
  assert.deepEqual(priority, [1, 2, 3, 4, 5]);
  assert.equal(original.length, 18);
  assert.equal(a.resume(), true);
  assert.equal(await a.finished, 'done');
  assert.deepEqual(original, Array.from({ length: 50 }, (_, i) => i + 1));
});

test('cancel queued work and in-flight stage without applying its late result', async () => {
  const { scheduler, store } = build();
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const holder = await scheduler.submit(batch('Masking', 1, async (_, __, ctx) => {
    await waiting;
    ctx.commitIfCurrent(() => { throw new Error('Cancelled result must not apply'); });
  }));
  const started: number[] = [];
  const queued = await scheduler.submit(batch('Queued cull', 5, async n => { started.push(n); }));
  assert.equal(store.list().find(t => t.id === queued.taskId)?.state, 'queued');
  assert.equal(queued.cancel(), true);
  assert.equal(await queued.finished, 'cancelled');
  assert.deepEqual(started, []);
  assert.equal(holder.cancel(), true);
  release();
  assert.equal(await holder.finished, 'cancelled');
  assert.equal(store.list().find(t => t.id === holder.taskId)?.state, 'cancelled');
});

test('failed items are independently reported and retried without repeating successful deliveries', async () => {
  const { scheduler, store } = build();
  const performed: number[] = [];
  let broken = true;
  const a = await scheduler.submit(batch('Batch', 5, async n => {
    performed.push(n);
    if (n === 3 && broken) throw new Error('Disk is full');
  }));
  assert.equal(await a.finished, 'failed');
  const snapshot = store.list().find(t => t.id === a.taskId)!;
  assert.equal(snapshot.done, 4);
  assert.equal(snapshot.items?.find(x => x.id === '3')?.detail, 'Disk is full');
  broken = false;
  const retry = await scheduler.retryFailed(a.taskId);
  assert.ok(retry);
  assert.equal(await retry.finished, 'done');
  assert.deepEqual(performed, [1, 2, 3, 4, 5, 3]);
});

test('restart only skips verified completed items, refusing changed recipes or uncertain destinations', async () => {
  const journal = new Map<string, string>();
  const adapter = { getItem: (key: string) => journal.get(key) ?? null, setItem: (key: string, value: string) => { journal.set(key, value); } };
  const saved = new Set<number>();
  const first = build().scheduler;
  const def = batch('Export', 5, async n => { saved.add(n); }, {
    recovery: { key: 'test-journal-1', journal: adapter, verifyCompleted: async n => saved.has(n) },
  });
  const submitted = await first.submit(def);
  assert.equal(await submitted.finished, 'done');
  const second = build().scheduler;
  const completed = await second.submit(batch('Recovered', 5, async n => { throw Error(`Duplicate ${n}`); }, {
    recovery: def.recovery,
  }));
  assert.equal(await completed.finished, 'done');
  await assert.rejects(() => second.submit({ ...def, snapshot: { mark: 'changed' } }), /does not match/);
  saved.delete(2);
  await assert.rejects(() => second.submit(def), /Cannot verify saved output/);
});

test('failed checkpoint never becomes a blindly retryable delivered file', async () => {
  const { scheduler } = build();
  const a = await scheduler.submit(batch('Export', 2, async () => {}, {
    recovery: { key: 'no-disk', journal: { getItem: () => null, setItem: () => { throw Error('Drive disconnected'); } }, verifyCompleted: async () => true },
  }));
  assert.equal(await a.finished, 'failed');
  assert.equal(await scheduler.retryFailed(a.taskId), null);
});

test('device resource limits are conservative on memory-constrained phones', () => {
  assert.deepEqual(limitsForDevice({ hardwareConcurrency: 8, deviceMemory: 2, mobile: true }), { cpu: 1, gpu: 1, io: 1 });
  assert.deepEqual(limitsForDevice({ hardwareConcurrency: 12, deviceMemory: 8 }), { cpu: 3, gpu: 1, io: 2 });
});

test('pause all preserves completed work until resume all', async () => {
  const { scheduler, store } = build();
  let resolve!: () => void;
  const hold = new Promise<void>(r => { resolve = r; });
  const jobs: number[] = [];
  const a = await scheduler.submit(batch('Import', 3, async n => { jobs.push(n); if (n === 1) await hold; }));
  await until(() => jobs.length === 1, 'first item');
  scheduler.pauseAll();
  resolve();
  await until(() => store.list().find(x => x.id === a.taskId)?.state === 'paused', 'paused');
  assert.deepEqual(jobs, [1]);
  scheduler.resumeAll();
  assert.equal(await a.finished, 'done');
  assert.deepEqual(jobs, [1, 2, 3]);
});

test('a confirmed native save remains checkpointed when cancel is requested during the write boundary', async () => {
  const { scheduler } = build();
  const persisted = new Map<string, string>();
  let release!: () => void;
  const saving = new Promise<void>(resolve => { release = resolve; });
  let entered = false;
  const ticket = await scheduler.submit(batch('Save outputs', 2, async (n, _, ctx) => {
    if (n !== 1) throw new Error('Cancelled batch must not start the next export.');
    entered = true;
    await saving;
    // Simulate a native destination which has just durably acknowledged its
    // write even though the person pressed cancel while the save was pending.
    ctx.acknowledgeCommitted();
  }, {
    recovery: { key: 'confirmed-save', journal: {
      getItem: key => persisted.get(key) ?? null,
      setItem: (key, value) => { persisted.set(key, value); },
    }, verifyCompleted: async () => true },
  }));
  await until(() => entered, 'entered native write');
  assert.equal(ticket.cancel(), true);
  release();
  assert.equal(await ticket.finished, 'cancelled');
  const checkpoint = JSON.parse(persisted.get('confirmed-save')!);
  assert.deepEqual(checkpoint.completed, ['1'], 'the native-acknowledged file must not be exported twice after restart');
});

test('scan-wide jobs expose individual photo stage updates without applying partial decisions', async () => {
  const { scheduler, store } = build();
  const ticket = await scheduler.submit(batch('Cull complete shoot', 1, async (_, __, ctx) => {
    ctx.setSubitems([{id: 'dog-one', label: 'dog-1.jpg'}, {id: 'dog-two', label: 'dog-2.jpg'}]);
    ctx.updateSubitem('dog-one', 'running', 'analysing');
    ctx.reportProgress(1, 2, 'Analysed first dog');
    ctx.updateSubitem('dog-one', 'done', 'analysed');
    ctx.updateSubitem('dog-two', 'done', 'analysed');
    ctx.reportProgress(2, 2, 'All evidence gathered');
  }, { kind: 'cull', pauseable: false }));
  assert.equal(await ticket.finished, 'done');
  const task = store.list().find(t => t.id === ticket.taskId)!;
  assert.equal(task.total, 2);
  assert.deepEqual(task.items?.map(item => [item.id, item.state]), [['dog-one','done'],['dog-two','done']]);
});

test('pressure defers background admission without lowering processing quality', async () => {
  const store = createTaskStore();
  const scheduler = createEngineScheduler({
    taskStore: store,
    limits: { cpu: 2, gpu: 1, io: 1 },
    resourceSample: {
      cpu: 0.96, availableMemoryBytes: 3 * 1024 ** 3,
      availableGpuBytes: 2 * 1024 ** 3, availableDiskBytes: 8 * 1024 ** 3,
    },
  });
  let ran = false;
  const ticket = await scheduler.submit(batch('Heavy import', 3, async () => { ran = true; }));
  assert.equal(store.list().find(task => task.id === ticket.taskId)?.state, 'queued');
  assert.equal(ran, false);
  assert.equal(scheduler.resourceStatus().measured, true);
  assert.equal(scheduler.resourceStatus().blockedReason, 'cpu');
  scheduler.updateResourceSample({
    cpu: 0.2, availableMemoryBytes: 3 * 1024 ** 3,
    availableGpuBytes: 2 * 1024 ** 3, availableDiskBytes: 8 * 1024 ** 3,
  });
  assert.equal(await ticket.finished, 'done');
  assert.equal(ran, true);
});

test('unknown device memory serialises CPU and GPU heavy jobs instead of inventing available RAM', async () => {
  const store = createTaskStore();
  const scheduler = createEngineScheduler({ taskStore: store, limits: { cpu: 3, gpu: 1, io: 2 } });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const order: string[] = [];
  const cpu = await scheduler.submit(batch('Import', 1, async () => { order.push('cpu start'); await held; }, {resource:'cpu'}));
  await until(() => order.length === 1, 'cpu active');
  const gpu = await scheduler.submit(batch('Denoise', 1, async () => { order.push('gpu start'); }, {resource:'gpu'}));
  assert.equal(store.list().find(task => task.id === gpu.taskId)?.state, 'queued');
  assert.equal(scheduler.resourceStatus().measured, false);
  release();
  assert.equal(await cpu.finished, 'done');
  assert.equal(await gpu.finished, 'done');
  assert.deepEqual(order, ['cpu start', 'gpu start']);
});

test('measured insufficient available RAM blocks even priority jobs until pressure clears', async () => {
  const store = createTaskStore();
  const scheduler = createEngineScheduler({ taskStore: store, limits:{cpu:1,gpu:1,io:1},
    resourceSample:{cpu:0.1,availableMemoryBytes: 600 * 1024 ** 2,availableGpuBytes:3*1024**3,availableDiskBytes:3*1024**3} });
  const ticket = await scheduler.submit(batch('RAW import',1,async()=>{}, {priority:100}));
  assert.equal(store.list().find(task => task.id === ticket.taskId)?.state, 'queued');
  scheduler.updateResourceSample({cpu:0.1,availableMemoryBytes: 2*1024**3,availableGpuBytes:3*1024**3,availableDiskBytes:3*1024**3});
  assert.equal(await ticket.finished, 'done');
});

test('deterministic ZIP capacity failure cannot offer unsafe repeated retry', async () => {
  const { scheduler, store } = build();
  const ticket = await scheduler.submit(batch('Oversized ZIP', 1, async () => {
    throw new NonRetryableTaskError('ZIP needs more memory than permitted.');
  }));
  assert.equal(await ticket.finished, 'failed');
  assert.match(store.list().find(task => task.id === ticket.taskId)?.items?.[0].detail ?? '', /more memory/);
  assert.equal(scheduler.canRetryFailed(ticket.taskId), false);
  assert.equal(await scheduler.retryFailed(ticket.taskId), null);
});

test('coalesced child-stage updates flush all final results even at a frozen clock', async () => {
  const store = createTaskStore(() => 1_000);
  const scheduler = createEngineScheduler({
    taskStore: store, limits: {cpu:1,gpu:1,io:1}, now: () => 1_000,
  });
  const ticket = await scheduler.submit(batch('A hundred thumbnails', 100, async (_, __, ctx) => {
    ctx.stage('Rendering thumbnail');
  }, {kind:'thumbnail', resource:'io'}));
  assert.equal(await ticket.finished, 'done');
  const record = store.list().find(task => task.id === ticket.taskId)!;
  assert.equal(record.done, 100);
  assert.equal(record.items?.length, 100);
  assert.equal(record.items?.filter(item => item.state === 'done').length, 100);
});
