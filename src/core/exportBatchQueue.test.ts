import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportBatchQueue, exportFolderName, snapshotExportRecipe } from './exportBatchQueue.ts';
import { createTaskStore } from './taskStore.ts';
import { createEngineScheduler } from './engineScheduler.ts';

const photos = [
  { sourceId: 'nef-01', filename: 'one.jpg', subfolder: 'Instagram' },
  { sourceId: 'nef-02', filename: 'two.jpg', subfolder: 'Facebook' },
];
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('snapshot survives later editor changes; complete only after files saved', async () => {
  const store = createTaskStore();
  const queue = createExportBatchQueue(store);
  const recipe = { watermark: { text: '© Photographer' }, quality: 90 };
  const saved: string[] = [];
  const ticket = queue.enqueue({ title: 'Export', items: photos, recipe }, {
    async render(item, snapshot) { await tick(); return `${item.filename}:${snapshot.watermark.text}:${snapshot.quality}`; },
    async save(item, output) { await tick(); saved.push(`${item.subfolder}/${output}`); },
  });
  recipe.watermark.text = 'Changed';
  assert.equal(await ticket.done, 'completed');
  assert.deepEqual(saved, ['Instagram/one.jpg:© Photographer:90', 'Facebook/two.jpg:© Photographer:90']);
  assert.equal(store.list()[0].state, 'done');
  assert.equal(store.list()[0].done, 2);
});

test('multiple exports run sequentially, not concurrently', async () => {
  const queue = createExportBatchQueue(createTaskStore());
  const steps: string[] = [];
  const adapter = {
    async render(item: { filename: string }) { steps.push('render ' + item.filename); await tick(); return item.filename; },
    async save(item: { filename: string }) { steps.push('save ' + item.filename); await tick(); },
  };
  const first = queue.enqueue({ title: 'First', items: [photos[0]], recipe: {} }, adapter);
  const second = queue.enqueue({ title: 'Second', items: [photos[1]], recipe: {} }, adapter);
  assert.equal(await first.done, 'completed');
  assert.equal(await second.done, 'completed');
  assert.deepEqual(steps, ['render one.jpg', 'save one.jpg', 'render two.jpg', 'save two.jpg']);
});

test('stopping a queued export settles immediately without rendering or writing', async () => {
  const store = createTaskStore();
  const queue = createExportBatchQueue(store);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const first = queue.enqueue({ title: 'First', items: [photos[0]], recipe: {} }, {
    async render() { await blocked; return 'first'; }, async save() {},
  });
  let touched = false;
  const second = queue.enqueue({ title: 'Second', items: [photos[1]], recipe: {} }, {
    async render() { touched = true; return 'second'; }, async save() { touched = true; },
  });
  assert.equal(store.cancel(store.list()[1].id), true);
  try {
    assert.equal(await Promise.race([second.done, tick()]), 'cancelled');
    assert.equal(second.cancel(), false);
  } finally { release(); }
  assert.equal(await first.done, 'completed');
  assert.equal(touched, false);
});

test('write failures are not incorrectly counted as completed', async () => {
  const store = createTaskStore();
  const ticket = createExportBatchQueue(store).enqueue({ title: 'Export', items: photos, recipe: {} }, {
    async render() { return 'result'; },
    async save(item) { if (item.filename === 'two.jpg') throw new Error('Drive disconnected'); },
  });
  assert.equal(await ticket.done, 'failed');
  assert.equal(store.list()[0].done, 1);
  assert.equal(store.list()[0].state, 'failed');
  assert.match(store.list()[0].detail ?? '', /Drive disconnected/);
});

test('deep copy of recipe cannot be changed by editing after submission', () => {
  const live = { array: [{ value: 'original' }], nested: { enabled: true } };
  const snapshot = snapshotExportRecipe(live);
  live.array[0].value = 'changed';
  assert.equal(snapshot.array[0].value, 'original');
  assert.ok(Object.isFrozen(snapshot.nested));
});

test('unsafe subfolders, filenames and case-insensitive collisions are refused', () => {
  assert.throws(() => exportFolderName('../Photos'), /Invalid/);
  assert.equal(exportFolderName('Instagram'), 'Instagram');
  const queue = createExportBatchQueue(createTaskStore());
  const adapter = { async render() { return null; }, async save() {} };
  assert.throws(() => queue.enqueue({ title: 'Bad', recipe: {}, items: [photos[0], { ...photos[0], filename: 'ONE.JPG' }] }, adapter), /same filename/);
  assert.throws(() => queue.enqueue({ title: 'Bad', recipe: {}, items: [{ ...photos[0], filename: '../foo.jpg' }] }, adapter), /invalid/);
});

test('desktop retry saves only remaining files and keeps the original export recipe', async () => {
  const store = createTaskStore();
  const queue = createExportBatchQueue(store);
  const calls: string[] = [];
  const recipe = { title: 'Original' };
  let connected = false;
  const adapter = {
    async render(item: { filename: string }, settings: { title: string }) {
      calls.push(`render:${item.filename}:${settings.title}`);
      return item.filename;
    },
    async save(item: { filename: string }) {
      calls.push('save:' + item.filename);
      if (item.filename === 'two.jpg' && !connected) throw new Error('Drive disconnected');
    },
  };
  const first = queue.enqueue({ title: 'Export', items: photos, recipe, retrySafe: true }, adapter);
  recipe.title = 'Later edit';
  assert.equal(await first.done, 'failed');
  const failed = store.list().find(task => task.state === 'failed')!;
  assert.equal(failed.done, 1);
  assert.equal(queue.canRetryTask(failed.id), true);
  connected = true;
  const second = queue.retryTask(failed.id);
  assert.ok(second);
  assert.equal(queue.retryTask(failed.id), null, 'one failure cannot be retried twice');
  assert.equal(await second.done, 'completed');
  assert.equal(store.list().some(task => task.id === failed.id), false, 'resolved failure dismissed, other failures untouched');
  assert.equal(store.list().find(task => task.state === 'done')?.done, 2);
  assert.deepEqual(calls, [
    'render:one.jpg:Original', 'save:one.jpg',
    'render:two.jpg:Original', 'save:two.jpg',
    'render:two.jpg:Original', 'save:two.jpg',
  ], 'earlier completed file is never rewritten, and retry does not use new editor state');
});

test('non-exclusive destinations never offer retry after ambiguous remote writes', async () => {
  const store = createTaskStore();
  const queue = createExportBatchQueue(store);
  const ticket = queue.enqueue({ title: 'Remote', items: photos, recipe: {} }, {
    async render() { return new Blob(); },
    async save() { throw new Error('Remote PUT may already have committed'); },
  });
  assert.equal(await ticket.done, 'failed');
  assert.equal(queue.canRetryTask(store.list()[0].id), false);
  assert.equal(queue.retryTask(store.list()[0].id), null);
});

test('explicit retries are bounded and cancelled jobs are never retried automatically', async () => {
  const store = createTaskStore();
  const queue = createExportBatchQueue(store);
  const failures = { count: 0 };
  let ticket = queue.enqueue({ title: 'Disk error', items: [photos[0]], recipe: {}, retrySafe: true }, {
    async render() { return ''; },
    async save() { failures.count++; throw new Error('Still offline'); },
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    assert.equal(await ticket.done, 'failed');
    const failed = store.list().find(task => task.state === 'failed')!;
    if (attempt === 3) {
      assert.equal(queue.canRetryTask(failed.id), false, 'after three retries the user must start a new deliberate export');
      break;
    }
    assert.equal(queue.canRetryTask(failed.id), true);
    ticket = queue.retryTask(failed.id)!;
    assert.ok(ticket);
  }
  assert.equal(failures.count, 4);
  const stopped = queue.enqueue({ title: 'Stop', items: [photos[0]], recipe: {}, retrySafe: true }, {
    async render() { return ''; }, async save() {},
  });
  assert.equal(await stopped.done, 'completed');
  assert.equal(queue.canRetryTask(store.list().at(-1)!.id), false);
});


test('Task Manager stays running until durable finalization commits', async () => {
  const store = createTaskStore();
  const queue = createExportBatchQueue(store);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let finalizing = false;
  const ticket = queue.enqueue({ title: 'Durable', items: [photos[0]], recipe: {} }, {
    async render() { return 'pixels'; },
    async save() {},
    async finalize() { finalizing = true; await gate; },
  });
  for (let i = 0; i < 10 && !finalizing; i++) await tick();
  assert.equal(finalizing, true);
  assert.notEqual(store.list()[0].state, 'done', 'rendered bytes are not a committed batch');
  release();
  assert.equal(await ticket.done, 'completed');
  assert.equal(store.list()[0].state, 'done');
});

test('durable finalization failure leaves a visible failed Task Manager job', async () => {
  const store = createTaskStore();
  const queue = createExportBatchQueue(store);
  const ticket = queue.enqueue({ title: 'Durable', items: [photos[0]], recipe: {} }, {
    async render() { return 'pixels'; },
    async save() {},
    async finalize() { throw new Error('Checkpoint disk full'); },
  });
  assert.equal(await ticket.done, 'failed');
  assert.equal(store.list()[0].state, 'failed');
  assert.match(store.list()[0].detail ?? '', /Checkpoint disk full/);
});

test('cancelling a waiting export never marks its Task Manager entry completed', async () => {
  const store = createTaskStore();
  const queue = createExportBatchQueue(store);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let firstStarted = false;
  const first = queue.enqueue({ title: 'First', items: [photos[0]], recipe: {} }, {
    async render() { firstStarted = true; await gate; return 'pixels'; },
    async save() {},
  });
  for (let i = 0; i < 10 && !firstStarted; i++) await tick();
  assert.equal(firstStarted, true);
  let secondRendered = false;
  const second = queue.enqueue({ title: 'Waiting', items: [photos[0]], recipe: {} }, {
    async render() { secondRendered = true; return 'pixels'; },
    async save() {},
  });
  assert.equal(second.cancel(), true);
  assert.equal(await second.done, 'cancelled');
  assert.equal(secondRendered, false);
  assert.notEqual(store.list().find(task => task.title === 'Waiting')?.state, 'done');
  release();
  assert.equal(await first.done, 'completed');
});

test('cancellation is refused once durable finalisation starts; failed commit stays failed', async () => {
  const store = createTaskStore();
  const queue = createExportBatchQueue(store);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let finalizing = false;
  const ticket = queue.enqueue({ title: 'Interrupted commit', items: [photos[0]], recipe: {} }, {
    async render() { return 'pixels'; },
    async save() {},
    async finalize() { finalizing = true; await gate; throw new Error('Interrupted checkpoint'); },
  });
  for (let i = 0; i < 10 && !finalizing; i++) await tick();
  assert.equal(finalizing, true);
  assert.equal(ticket.cancel(), false, 'the irreversible commit boundary has started');
  assert.equal(store.cancel(store.list()[0].id), false, 'Task Manager must also refuse cancellation');
  assert.equal(store.list()[0].cancellable, false);
  release();
  assert.equal(await ticket.done, 'failed');
  assert.equal(store.list()[0].state, 'failed');
  assert.notEqual(store.list()[0].state, 'done');
});

test('late cancellation cannot contradict a successful durable export commit', async () => {
  const store = createTaskStore();
  const queue = createExportBatchQueue(store);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let finalizing = false;
  let commits = 0;
  const ticket = queue.enqueue({ title: 'Atomic', items: [photos[0]], recipe: {} }, {
    async render() { return 'pixels'; },
    async save() {},
    async finalize() { finalizing = true; await gate; commits++; },
  });
  for (let i = 0; i < 10 && !finalizing; i++) await tick();
  assert.equal(finalizing, true);
  assert.equal(ticket.cancel(), false);
  release();
  assert.equal(await ticket.done, 'completed');
  assert.equal(commits, 1);
  assert.equal(store.list()[0].state, 'done');
});

test('the legacy export lane never describes a waiting save as running', async () => {
  const store = createTaskStore();
  const queue = createExportBatchQueue(store);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const adapter = { async render(item: { filename: string }) {
    if (item.filename === 'one.jpg') await gate;
    return item.filename;
  }, async save() {} };
  const first = queue.enqueue({title:'First save',items:[photos[0]],recipe:{}}, adapter);
  const second = queue.enqueue({title:'Second save',items:[photos[1]],recipe:{}}, adapter);
  await tick();
  assert.equal(store.list()[0].state, 'running');
  assert.equal(store.list()[1].state, 'queued');
  release();
  assert.equal(await first.done, 'completed');
  assert.equal(await second.done, 'completed');
  assert.equal(store.list().find(task => task.title === 'Second save')?.state, 'done');
});

test('legacy exports and central jobs share a single CPU slot and one visible task per batch', async () => {
  const store = createTaskStore();
  const scheduler = createEngineScheduler({taskStore:store,limits:{cpu:1,gpu:1,io:1}});
  const queue = createExportBatchQueue(store,scheduler);
  let release!:()=>void;
  const gate = new Promise<void>(r=>{release=r;});
  const order:string[] = [];
  const raw = await scheduler.submit({
    title:'Develop RAW',kind:'raw',resource:'cpu',snapshot:{},items:['raw'],
    itemId:x=>x,itemLabel:x=>x,async runItem(){order.push('RAW');await gate;}
  });
  const exportJob = queue.enqueue({title:'Legacy export',items:photos,recipe:{}},{
    async render(item){order.push('render '+item.filename);return item.filename;},
    async save(item){order.push('save '+item.filename);}
  });
  await tick();
  assert.equal(store.list().length,2);
  assert.equal(store.list().find(x=>x.title==='Legacy export')?.state,'queued');
  assert.deepEqual(order,['RAW']);
  release();
  assert.equal(await raw.finished,'done');
  assert.equal(await exportJob.done,'completed');
  assert.deepEqual(order,['RAW','render one.jpg','save one.jpg','render two.jpg','save two.jpg']);
});

test('interactive work takes priority between legacy export photographs', async () => {
  const store = createTaskStore();
  const scheduler = createEngineScheduler({taskStore:store,limits:{cpu:1,gpu:1,io:1}});
  const queue = createExportBatchQueue(store,scheduler);
  let release!:()=>void;
  const gate = new Promise<void>(r=>{release=r;});
  const order:string[]=[];
  const job=queue.enqueue({title:'Legacy',items:photos,recipe:{}},{
    async render(item){order.push(item.filename);if(item.filename==='one.jpg')await gate;return item.filename;},
    async save(){}
  });
  await tick();
  const edit=await scheduler.submit({
    title:'Interactive edit',kind:'auto-edit',resource:'cpu',priority:20,snapshot:{},items:['edit'],
    itemId:x=>x,itemLabel:x=>x,async runItem(){order.push('edit');}
  });
  assert.deepEqual(order,['one.jpg']);
  release();
  assert.equal(await edit.finished,'done');
  assert.equal(await job.done,'completed');
  assert.deepEqual(order,['one.jpg','edit','two.jpg']);
});

test('legacy export waiting for a shared slot can cancel without rendering', async () => {
  const store=createTaskStore();
  const scheduler=createEngineScheduler({taskStore:store,limits:{cpu:1,gpu:1,io:1}});
  const queue=createExportBatchQueue(store,scheduler);
  let release!:()=>void;
  const gate=new Promise<void>(r=>{release=r;});
  const raw=await scheduler.submit({title:'RAW',kind:'raw',resource:'cpu',snapshot:{},items:[1],
    itemId:String,itemLabel:String,async runItem(){await gate;}});
  let rendered=false;
  const job=queue.enqueue({title:'Waiting',items:photos,recipe:{}},{
    async render(){rendered=true;return '';},async save(){}
  });
  assert.equal(job.cancel(),true);
  assert.equal(await job.done,'cancelled');
  assert.equal(rendered,false);
  release();
  assert.equal(await raw.finished,'done');
  assert.deepEqual(scheduler.runningResourceCount(),{cpu:0,gpu:0,io:0});
});
