import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaskStore } from './taskStore.ts';
import { createEngineScheduler, limitsForDevice, type BatchDefinition } from './engineScheduler.ts';

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
  // The import resumes on the scheduler's next tick, not synchronously with the edit's completion.
  await until(() => order.length >= 3, 'import resumed after the edit');
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

const BUSY = { cpu: 1, availableMemoryBytes: 300 * 1024 ** 2, availableGpuBytes: 64 * 1024 ** 2, availableDiskBytes: 8 * 1024 ** 3 };

test('with other programs at 100% CPU and little memory, one job still runs and the next says why it waits', async () => {
  const store = createTaskStore();
  const scheduler = createEngineScheduler({ taskStore: store, limits: { cpu: 2, gpu: 1, io: 1 }, resourceSample: BUSY });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let first = 0; let second = 0;
  const one = await scheduler.submit(batch('Develop full size', 1, async () => { first += 1; await held; }));
  await until(() => first === 1, 'the first job starts on a busy computer');
  const two = await scheduler.submit(batch('Colour check', 1, async () => { second += 1; }));
  const waiting = store.list().find(task => task.id === two.taskId);
  assert.equal(waiting?.state, 'queued', 'a second job does not pile onto a busy computer');
  assert.match(waiting?.detail ?? '', /^Waiting: (the computer is busy|memory is low)/);
  release();
  assert.equal(await one.finished, 'done');
  assert.equal(await two.finished, 'done', 'it runs when the first is done');
  assert.equal(second, 1);
  // Quality is never lowered: the same work ran, just one at a time.
  assert.equal(scheduler.resourceStatus().measured, true);
});

test('a job the person started (TrueDetail on one photo) starts at once beside background work on a busy computer', async () => {
  const store = createTaskStore();
  const scheduler = createEngineScheduler({ taskStore: store, limits: { cpu: 2, gpu: 1, io: 1 }, resourceSample: BUSY });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let background = 0; let denoised = false;
  const scan = await scheduler.submit(batch('Checking colour', 3, async () => { background += 1; await held; }));
  await until(() => background === 1, 'background work runs');
  const denoise = await scheduler.submit(batch('Denoising', 1, async () => { denoised = true; }, { interactive: true }));
  assert.equal(await denoise.finished, 'done', 'it did not wait for the background work or the machine');
  assert.equal(denoised, true);
  release();
  assert.equal(await scan.finished, 'done');
});

test('a second job the person started waits for the first, never two at once', async () => {
  const store = createTaskStore();
  const scheduler = createEngineScheduler({ taskStore: store, limits: { cpu: 2, gpu: 1, io: 1 }, resourceSample: BUSY });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const order: string[] = [];
  const a = await scheduler.submit(batch('Denoising A', 1, async () => { order.push('a'); await held; }, { interactive: true }));
  await until(() => order.length === 1, 'first interactive job starts');
  const b = await scheduler.submit(batch('Denoising B', 1, async () => { order.push('b'); }, { interactive: true }));
  assert.equal(store.list().find(task => task.id === b.taskId)?.state, 'queued');
  release();
  assert.equal(await a.finished, 'done');
  assert.equal(await b.finished, 'done');
  assert.deepEqual(order, ['a', 'b']);
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

test('measured low memory never stops the only job, and a second waits until memory clears', async () => {
  const store = createTaskStore();
  const scheduler = createEngineScheduler({ taskStore: store, limits:{cpu:2,gpu:1,io:1},
    resourceSample:{cpu:0.1,availableMemoryBytes: 600 * 1024 ** 2,availableGpuBytes:3*1024**3,availableDiskBytes:3*1024**3} });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let started = 0;
  const first = await scheduler.submit(batch('RAW import',1,async()=>{ started += 1; await held; }, {priority:100}));
  await until(() => started === 1, 'the only job runs despite low memory');
  const second = await scheduler.submit(batch('Thumbnails',1,async()=>{ started += 1; }));
  const waiting = store.list().find(task => task.id === second.taskId);
  assert.equal(waiting?.state, 'queued');
  assert.match(waiting?.detail ?? '', /^Waiting: memory is low/);
  scheduler.updateResourceSample({cpu:0.1,availableMemoryBytes: 2*1024**3,availableGpuBytes:3*1024**3,availableDiskBytes:3*1024**3});
  assert.equal(await second.finished, 'done', 'it starts beside the first once memory clears');
  release();
  assert.equal(await first.finished, 'done');
});

test('retry of journalled partial failure reuses the original fingerprint and verifies saved outputs', async () => {
  const { scheduler } = build();
  const persisted = new Map<string, string>();
  const saved = new Set<number>();
  const attempts: number[] = [];
  let fail = true;
  const first = await scheduler.submit(batch('Recoverable export', 3, async n => {
    attempts.push(n);
    if (n === 2 && fail) throw new Error('Temporary destination failure');
    saved.add(n);
  }, { recovery: { key: 'retry-journal', journal: {
    getItem: key => persisted.get(key) ?? null,
    setItem: (key, value) => { persisted.set(key, value); },
  }, verifyCompleted: async n => saved.has(n) } }));
  assert.equal(await first.finished, 'failed');
  fail = false;
  const retry = await first.retryFailed();
  assert.ok(retry);
  assert.equal(await retry.finished, 'done');
  assert.deepEqual(attempts, [1, 2, 3, 2]);
  assert.equal(await first.retryFailed(), null, 'same failure cannot be retried twice');
  assert.deepEqual(JSON.parse(persisted.get('retry-journal')!).completed, ['1', '2', '3']);
});

test('raising the CPU limit (photos-at-once policy) starts a waiting job; an invalid limit is ignored', async () => {
  // Only with measured capacity: without a sample the scheduler keeps one heavy job at a time, whatever the plan.
  const scheduler = createEngineScheduler({ taskStore: createTaskStore(), limits: { cpu: 1, gpu: 1, io: 1 },
    resourceSample: { cpu: 0.1, availableMemoryBytes: 16 * 1024 ** 3, availableGpuBytes: 4 * 1024 ** 3, availableDiskBytes: 50 * 1024 ** 3 } });
  const started: string[] = [];
  const gates: Array<() => void> = [];
  const hold = (name: string) => batch(name, 1, async () => { started.push(name); await new Promise<void>((resolve) => gates.push(resolve)); });
  await scheduler.submit(hold('first'));
  await scheduler.submit(hold('second'));
  await until(() => started.length === 1, 'first job starts');
  await pause(5);
  assert.deepEqual(started, ['first']);
  scheduler.setCpuLimit(0);
  assert.equal(scheduler.cpuLimit(), 1);
  scheduler.setCpuLimit(2);
  await until(() => started.length === 2, 'second job starts once the limit allows two');
  gates.forEach((release) => release());
});

test('without measured capacity a higher plan limit still runs one heavy job at a time', async () => {
  const { scheduler } = build();
  const started: string[] = [];
  const gates: Array<() => void> = [];
  const hold = (name: string) => batch(name, 1, async () => { started.push(name); await new Promise<void>((resolve) => gates.push(resolve)); });
  scheduler.setCpuLimit(20);
  await scheduler.submit(hold('first'));
  await scheduler.submit(hold('second'));
  await until(() => started.length === 1, 'first job starts');
  await pause(10);
  assert.deepEqual(started, ['first']);
  gates.forEach((release) => release());
});

test('without measured capacity Select subject starts beside a shoot-wide Auto pick that cannot pause', async () => {
  const { scheduler } = build();
  const started: string[] = [];
  const gates: Array<() => void> = [];
  const hold = (name: string) => async () => { started.push(name); await new Promise<void>((resolve) => gates.push(resolve)); };
  await scheduler.submit(batch('Auto pick 1200 photos', 1, hold('cull'), { kind: 'cull', priority: 5, pauseable: false }));
  await until(() => started.length === 1, 'auto pick starts');
  await scheduler.submit(batch('Find subject', 1, hold('mask'), { kind: 'mask', resource: 'gpu', priority: 18, interactive: true }));
  await scheduler.submit(batch('Deep look', 1, hold('vision'), { kind: 'vision', resource: 'gpu', priority: 15, interactive: true }));
  await scheduler.submit(batch('Background develop', 1, hold('develop'), { kind: 'raw', resource: 'gpu', priority: 2 }));
  await until(() => started.length === 2, 'the mask starts while auto pick runs');
  await pause(10);
  // Only one interactive job beside the background one, and no further background work on top.
  assert.deepEqual(started, ['cull', 'mask']);
  gates.forEach((release) => release());
});

test('cancelling a task whose photo never finishes gives its processing slot back at once', async () => {
  const { scheduler, store } = build();
  let committed = false;
  // A hung analysis: ignores the stop and never resolves (the owner's stuck "Auto pick and analyse").
  const stuck = await scheduler.submit(batch('Auto pick and analyse', 1, async (_n, _s, ctx) => {
    await new Promise(() => undefined);
    ctx.commitIfCurrent(() => { committed = true; });
  }, { kind: 'cull' }));
  await until(() => scheduler.runningResourceCount().cpu === 1, 'analysis running');
  const develops: number[] = [];
  const develop = await scheduler.submit(batch('Developing RAW files', 3, async n => { develops.push(n); }, { kind: 'raw', priority: 2 }));
  await pause(5);
  assert.deepEqual(develops, [], 'waiting for the slot while the analysis holds it');
  scheduler.cancel(stuck.taskId);
  assert.equal(await stuck.finished, 'cancelled');
  assert.equal(scheduler.runningResourceCount().cpu, 0, 'the slot is free straight away');
  assert.equal(await develop.finished, 'done');
  assert.deepEqual(develops, [1, 2, 3]);
  assert.equal(store.list().find(t => t.id === stuck.taskId)?.state, 'cancelled');
  assert.equal(committed, false);
});

test('a photo that finishes after its task was cancelled commits nothing and frees no second slot', async () => {
  const { scheduler } = build();
  let finishLate!: () => void;
  let committed = false;
  const late = await scheduler.submit(batch('Import', 2, async (_n, _s, ctx) => {
    await new Promise<void>(resolve => { finishLate = resolve; });
    ctx.commitIfCurrent(() => { committed = true; });
  }, { kind: 'import' }));
  await until(() => scheduler.runningResourceCount().cpu === 1, 'import running');
  let blockerRelease!: () => void;
  scheduler.cancel(late.taskId);
  const next = await scheduler.submit(batch('Develop', 1, async () => { await new Promise<void>(resolve => { blockerRelease = resolve; }); }, { kind: 'raw' }));
  await until(() => scheduler.runningResourceCount().cpu === 1, 'the next task holds the slot');
  finishLate();
  await pause(5);
  assert.equal(committed, false, 'a cancelled photo never lands');
  assert.equal(scheduler.runningResourceCount().cpu, 1, 'the late finish does not release the next task\'s slot');
  blockerRelease();
  assert.equal(await next.finished, 'done');
  assert.equal(scheduler.runningResourceCount().cpu, 0);
});

test('a paused task holds no slot, and cancelling it while paused leaves the others running', async () => {
  const { scheduler } = build();
  let release!: () => void;
  const first = new Promise<void>(resolve => { release = resolve; });
  const imported: number[] = [];
  const ingest = await scheduler.submit(batch('Import', 5, async n => { imported.push(n); if (n === 1) await first; }, { kind: 'import', priority: 11, pauseable: true }));
  await until(() => imported.length === 1, 'import started');
  scheduler.pause(ingest.taskId);
  release();
  await until(() => scheduler.runningResourceCount().cpu === 0, 'paused after the current photo, slot given back');
  const developed: number[] = [];
  const develop = await scheduler.submit(batch('Develop', 2, async n => { developed.push(n); }, { kind: 'raw', priority: 2 }));
  assert.equal(await develop.finished, 'done', 'runs while the import is paused');
  scheduler.cancel(ingest.taskId);
  assert.equal(await ingest.finished, 'cancelled');
  assert.deepEqual(imported, [1]);
  const after = await scheduler.submit(batch('Develop again', 1, async () => undefined, { kind: 'raw' }));
  assert.equal(await after.finished, 'done');
  assert.equal(scheduler.runningResourceCount().cpu, 0);
});

test('the watchdog fails a photo that shows no progress for its limit, frees the slot and the task carries on', async () => {
  // An injected clock and an on-demand check: no real waiting, so CI's speed cannot change the outcome.
  let clock = 0;
  const store = createTaskStore();
  const scheduler = createEngineScheduler({ taskStore: store, limits: { cpu: 1, gpu: 1, io: 1 }, now: () => clock, watchdogMs: 0 });
  let committed = false;
  const ran: number[] = [];
  const job = await scheduler.submit(batch('Auto pick', 3, async (n, _s, ctx) => {
    ran.push(n);
    if (n === 2) { await new Promise(() => undefined); ctx.commitIfCurrent(() => { committed = true; }); } // hung model
  }, { kind: 'cull', stallMs: 60_000 }));
  const develops: number[] = [];
  const develop = await scheduler.submit(batch('Develop', 1, async n => { develops.push(n); }, { kind: 'raw', priority: -1 }));
  await until(() => ran.length === 2, 'photo 2 is running (and hangs)');
  clock += 59_000;
  scheduler.checkStalls();
  assert.equal(scheduler.runningResourceCount().cpu, 1, 'not stuck yet: under its limit');
  clock += 2_000;
  scheduler.checkStalls();
  assert.equal(await job.finished, 'failed', 'stuck photo 2 fails; photos 1 and 3 still ran');
  assert.deepEqual(ran, [1, 2, 3]);
  const task = store.list().find(t => t.id === job.taskId)!;
  const stuck = task.items?.find(item => item.id === '2');
  assert.equal(stuck?.state, 'failed');
  assert.match(stuck?.detail ?? '', /no progress/);
  assert.equal(await develop.finished, 'done', 'nothing else waits for ever');
  assert.deepEqual(develops, [1]);
  assert.equal(committed, false);
  assert.equal(scheduler.runningResourceCount().cpu, 0);
});

test('work that keeps reporting progress is never stopped by the watchdog, however long it takes', async () => {
  let clock = 0;
  const scheduler = createEngineScheduler({ taskStore: createTaskStore(), limits: { cpu: 1, gpu: 1, io: 1 }, now: () => clock, watchdogMs: 0 });
  const job = await scheduler.submit(batch('Denoise', 1, async (_n, _s, ctx) => {
    for (let step = 0; step < 12; step += 1) {
      clock += 30_000; // 6 minutes in all against a 1-minute limit, with progress every 30 s
      scheduler.checkStalls();
      ctx.reportProgress(step, 12, 'tiles');
      await Promise.resolve();
    }
  }, { kind: 'denoise', stallMs: 60_000 }));
  assert.equal(await job.finished, 'done', 'alive throughout, so never stopped');
});
