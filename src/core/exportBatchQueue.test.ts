import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportBatchQueue, exportFolderName, snapshotExportRecipe } from './exportBatchQueue.ts';
import { createTaskStore } from './taskStore.ts';

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

test('cancelled queued export cannot render or write', async () => {
  const queue = createExportBatchQueue(createTaskStore());
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const first = queue.enqueue({ title: 'First', items: [photos[0]], recipe: {} }, {
    async render() { await blocked; return 'first'; }, async save() {},
  });
  let touched = false;
  const second = queue.enqueue({ title: 'Second', items: [photos[1]], recipe: {} }, {
    async render() { touched = true; return 'second'; }, async save() { touched = true; },
  });
  assert.equal(second.cancel(), true);
  release();
  assert.equal(await first.done, 'completed');
  assert.equal(await second.done, 'cancelled');
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
