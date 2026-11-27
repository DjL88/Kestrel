import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PhotoEdit } from '../core/photoEdits';
import type { Raw16Working } from './rawMaster16';

/** A stand-in worker: records each message and whether it carried the 16-bit picture, and answers with a 1x1 picture. */
const messages: { picture: number; carried: boolean }[] = [];
let forget = false;
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(message: { id: number; picture: number; data?: ArrayBuffer }) {
    messages.push({ picture: message.picture, carried: Boolean(message.data) });
    const reply = forget && !message.data ? { id: message.id, missing: true } : { id: message.id, width: 1, height: 1, rgba: new ArrayBuffer(4) };
    queueMicrotask(() => this.onmessage?.({ data: reply } as MessageEvent));
  }
  terminate() {}
}
(globalThis as unknown as { Worker: typeof FakeWorker }).Worker = FakeWorker;

const { renderRaw16Screen } = await import('./raw16Render');
const working = (): Raw16Working => ({ picture: { width: 2, height: 1, data: new Uint16Array(6) }, turn: 0 } as Raw16Working);
const edit = { exposure: 0.5 } as unknown as PhotoEdit;

test('the 16-bit copy goes to the worker once per photo, not with every edit', async () => {
  messages.length = 0;
  const photo = working();
  for (let i = 0; i < 4; i += 1) assert.ok(await renderRaw16Screen('slot', photo, edit, undefined));
  assert.deepEqual(messages.map((message) => message.carried), [true, false, false, false]);
  // Another photo sends its own copy once.
  assert.ok(await renderRaw16Screen('slot', working(), edit, undefined));
  assert.equal(messages.at(-1)?.carried, true);
});

test('a copy the worker has let go is sent once more, with the same edit, and the picture still comes back', async () => {
  messages.length = 0;
  const photo = working();
  assert.ok(await renderRaw16Screen('slot', photo, edit, undefined));
  forget = true;
  try {
    assert.ok(await renderRaw16Screen('slot', photo, edit, undefined));
  } finally {
    forget = false;
  }
  assert.deepEqual(messages.map((message) => message.carried), [true, false, true]);
});
