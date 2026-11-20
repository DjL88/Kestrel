import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportRunSession } from './exportRunSession.ts';
import { memoryConnector } from './storageConnectors.ts';

const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
const when = new Date(2026, 10, 20, 13, 15);
const file = (name = 'kingfisher.jpg') => new File(['real export bytes'], name, { type: 'image/jpeg' });

test('platform batches use a distinct dated run folder, never overwrite older runs', async () => {
  const connector = memoryConnector();
  const a = createExportRunSession(connector, when, first);
  const b = createExportRunSession(connector, when, second);
  await a.save(file(), 'Instagram', new AbortController().signal);
  await a.save(file('bird.jpg'), 'Facebook', new AbortController().signal);
  await b.save(file(), 'Instagram', new AbortController().signal);
  assert.equal(connector.files.size, 3);
  assert.notEqual(a.folder, b.folder);
  assert.ok(connector.files.has(a.folder + '/Instagram/kingfisher.jpg'));
  assert.ok(connector.files.has(a.folder + '/Facebook/bird.jpg'));
  assert.ok(connector.files.has(b.folder + '/Instagram/kingfisher.jpg'));
});

test('a cancelled job never writes to the configured destination', async () => {
  const connector = memoryConnector();
  const job = createExportRunSession(connector, when, first);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(job.save(file(), 'Instagram', aborted.signal), /abort/i);
  assert.equal(connector.files.size, 0);
});

test('unsafe filenames, subfolder traversal and forged run ids fail closed', async () => {
  const connector = memoryConnector();
  assert.throws(() => createExportRunSession(connector, when, '../../private'), /Invalid export run/);
  const job = createExportRunSession(connector, when, first);
  await assert.rejects(job.save(file('../photo.jpg'), 'Instagram', new AbortController().signal), /unsafe/);
  await assert.rejects(job.save(file(), '../Photos', new AbortController().signal), /Invalid export subfolder/);
  assert.equal(connector.files.size, 0);
});

test('failed connector write cannot be reported as a successful file', async () => {
  const job = createExportRunSession({ put: async () => { throw new Error('Drive disconnected'); } }, when, first);
  await assert.rejects(job.save(file(), 'Instagram', new AbortController().signal), /Drive disconnected/);
});

test('a write confirmed while stopping still counts as saved', async () => {
  const controller = new AbortController();
  const job = createExportRunSession({ put: async () => { controller.abort(); } }, when, first);
  await job.save(file(), 'Instagram', controller.signal);
  assert.equal(controller.signal.aborted, true);
});
