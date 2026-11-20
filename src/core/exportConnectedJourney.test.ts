import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportBatchQueue } from './exportBatchQueue.ts';
import { createExportRunSession } from './exportRunSession.ts';
import { createTaskStore } from './taskStore.ts';
import { memoryConnector } from './storageConnectors.ts';

const runId = '00000000-0000-4000-8000-000000000007';

test('500-photo destination job saves 1,000 original-independent outputs in one run', async () => {
  const store = createTaskStore();
  const connector = memoryConnector();
  const destination = createExportRunSession(connector, new Date(2026, 10, 20, 16, 0), runId);
  const items = Array.from({ length: 500 }, (_, i) => [
    { sourceId: String(i), filename: `photo-${i}.jpg`, subfolder: 'Instagram' },
    { sourceId: String(i), filename: `photo-${i}.jpg`, subfolder: 'Facebook' },
  ]).flat();
  const settings = { watermark: { text: '© Owner' }, jpgQuality: 94 };
  let renders = 0;
  const ticket = createExportBatchQueue(store).enqueue({ title: '500 wildlife photos', items, recipe: settings }, {
    async render(item, recipe, signal) {
      signal.throwIfAborted();
      renders += 1;
      return new File([`${item.sourceId}:${recipe.watermark.text}`], item.filename, { type: 'image/jpeg' });
    },
    save: (item, file, signal) => destination.save(file, item.subfolder, signal),
  });
  settings.watermark.text = 'Unintended editor change';
  assert.equal(await ticket.done, 'completed');
  assert.equal(renders, 1000);
  assert.equal(connector.files.size, 1000);
  assert.equal(store.list()[0].done, 1000);
  assert.equal(store.list()[0].state, 'done');
  assert.ok([...connector.files.keys()].every(key => key.startsWith(destination.folder + '/')));
  assert.ok([...connector.files.keys()].every(key => key.includes('/Instagram/') || key.includes('/Facebook/')));
  const first = connector.files.get(destination.folder + '/Instagram/photo-0.jpg');
  assert.equal(new TextDecoder().decode(first), '0:© Owner');
});

test('connector failure stops after confirmed writes and never reports full completion', async () => {
  const store = createTaskStore();
  let successful = 0;
  const connector = { async put() { successful += 1; if (successful === 4) throw new Error('NAS access revoked'); } };
  const destination = createExportRunSession(connector, new Date(2026, 10, 20), runId);
  const items = Array.from({ length: 10 }, (_, i) => ({
    sourceId: String(i), filename: `file-${i}.jpg`, subfolder: 'Instagram',
  }));
  const ticket = createExportBatchQueue(store).enqueue({ title: 'Interrupted export', items, recipe: {} }, {
    async render(item) { return new File(['bytes'], item.filename); },
    save: (item, file, signal) => destination.save(file, item.subfolder, signal),
  });
  assert.equal(await ticket.done, 'failed');
  assert.equal(store.list()[0].state, 'failed');
  assert.equal(store.list()[0].done, 3);
  assert.match(store.list()[0].detail ?? '', /NAS access revoked/);
});

test('cancelled render is not allowed to write a destination file', async () => {
  const store = createTaskStore();
  const connector = memoryConnector();
  const destination = createExportRunSession(connector, new Date(2026, 10, 20), runId);
  let unlock!: () => void;
  const gate = new Promise<void>(resolve => { unlock = resolve; });
  const ticket = createExportBatchQueue(store).enqueue({
    title: 'Cancelled export',
    items: [{ sourceId: 'bird', filename: 'bird.jpg', subfolder: 'Instagram' }],
    recipe: {},
  }, {
    async render() { await gate; return new File(['never written'], 'bird.jpg'); },
    save: (item, file, signal) => destination.save(file, item.subfolder, signal),
  });
  assert.equal(ticket.cancel(), true);
  unlock();
  assert.equal(await ticket.done, 'cancelled');
  assert.equal(store.list()[0].state, 'cancelled');
  assert.equal(connector.files.size, 0);
});
