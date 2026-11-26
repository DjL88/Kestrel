import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PhotoEdit } from '../core/photoEdits';
import { createLiveDraftClient, type LiveDraftReply, type LiveDraftRequest } from './liveDraft';

/** A stand-in worker that records what it was sent and answers only when told to. */
function fakeWorker() {
  const sent: LiveDraftRequest[] = [];
  const worker = {
    onmessage: null as ((event: MessageEvent<LiveDraftReply>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage(message: LiveDraftRequest) { sent.push(message); },
    terminate() {},
  };
  const draws = () => sent.filter((message): message is Extract<LiveDraftRequest, { type: 'draw' }> => message.type === 'draw');
  const answer = (id: number) => worker.onmessage?.({ data: { id, bitmap: { close() {} } as unknown as ImageBitmap, ms: 1 } } as MessageEvent<LiveDraftReply>);
  return { worker, sent, draws, answer };
}

const edit = (exposure: number) => ({ exposure } as unknown as PhotoEdit);
const base = { close() {} } as unknown as ImageBitmap;
const lens = { x: 0.5, y: 0.5, r: 0.6 };

test('a drag step with no picture in the worker comes back empty at once, so the page draws it itself', async () => {
  const fake = fakeWorker();
  const client = createLiveDraftClient(() => fake.worker);
  assert.equal(await client.draw('a', 'key', 1200, edit(1)), null);
  assert.equal(fake.draws().length, 0);
});

test('while one step is drawn, only the newest waiting step is sent; the overtaken ones never are', async () => {
  const fake = fakeWorker();
  const client = createLiveDraftClient(() => fake.worker);
  client.sendBase('a', 'key', base, lens);
  const first = client.draw('a', 'key', 1200, edit(1));
  const second = client.draw('a', 'key', 1200, edit(2));
  const third = client.draw('a', 'key', 1200, edit(3));
  assert.equal(fake.draws().length, 1, 'one draw at a time per picture');
  assert.equal(await second, null, 'the step overtaken while waiting is dropped');
  fake.answer(fake.draws()[0].id);
  assert.ok(await first);
  assert.equal(fake.draws().length, 2);
  assert.deepEqual(fake.draws()[1].edit, edit(3), 'the newest step is the one drawn next');
  fake.answer(fake.draws()[1].id);
  assert.ok(await third);
});

test('Before and After draw side by side: a step for one picture never waits behind the other', () => {
  const fake = fakeWorker();
  const client = createLiveDraftClient(() => fake.worker);
  client.sendBase('a', 'one', base, lens);
  client.sendBase('b', 'two', base, lens);
  void client.draw('a', 'one', 900, edit(1));
  void client.draw('b', 'two', 900, edit(1));
  assert.equal(fake.draws().length, 2);
});

test('a worker that fails answers every waiting step with null and forgets its pictures', async () => {
  const fake = fakeWorker();
  const client = createLiveDraftClient(() => fake.worker);
  client.sendBase('a', 'key', base, lens);
  const waiting = client.draw('a', 'key', 1200, edit(1));
  fake.worker.onerror?.({ preventDefault() {} } as ErrorEvent);
  assert.equal(await waiting, null);
  assert.equal(client.baseKey('a'), undefined, 'the picture is sent again before the next drag');
});

test('a picture whose framing or photo changed is not drawn from the old base', async () => {
  const fake = fakeWorker();
  const client = createLiveDraftClient(() => fake.worker);
  client.sendBase('a', 'old', base, lens);
  assert.equal(await client.draw('a', 'new', 1200, edit(1)), null);
  assert.equal(fake.draws().length, 0);
});
