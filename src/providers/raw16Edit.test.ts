import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameAndEditRgb16, type Rgb16Image } from '../core/master16';
import { DEFAULT_EDIT, type PhotoEdit } from '../core/photoEdits';
import { frameAndEditOffThread, type StartWorker } from './raw16Edit';

const edit: PhotoEdit = { ...DEFAULT_EDIT, exposure: 0.7, contrast: 20 };

/** A picture laid out as the RAW decoder hands it over: an 8-byte header, then the pixels, in one buffer. */
function decoded(width = 12, height = 8): Rgb16Image {
  const buffer = new ArrayBuffer(8 + width * height * 6);
  const data = new Uint16Array(buffer, 8, width * height * 3);
  for (let i = 0; i < data.length; i += 1) data[i] = (i * 2741) % 65536;
  return { width, height, data };
}
const copyOf = (image: Rgb16Image): Rgb16Image => ({ ...image, data: image.data.slice() });

/** A stand-in worker that runs the real worker's code path, handing buffers over (and back) the way postMessage does. */
function fakeWorker(behaviour: 'work' | 'fail' | 'hang' = 'work') {
  const log = { terminated: 0, posted: 0 };
  const start: StartWorker = () => {
    const worker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
      terminate: () => { log.terminated += 1; },
      postMessage(message: { width: number; height: number; data: ArrayBuffer; offset: number; length: number; turn: number; edit: PhotoEdit; framing?: undefined }, transfer: ArrayBuffer[]) {
        log.posted += 1;
        const received = structuredClone(message, { transfer });
        if (behaviour === 'hang') return;
        queueMicrotask(() => {
          if (behaviour === 'fail') { worker.onerror?.({ preventDefault() {} } as ErrorEvent); return; }
          const result = frameAndEditRgb16({ width: received.width, height: received.height, data: new Uint16Array(received.data, received.offset, received.length) }, received.turn, received.edit, received.framing);
          const reply = structuredClone({ width: result.width, height: result.height, data: result.data.buffer, offset: result.data.byteOffset, length: result.data.length }, { transfer: [result.data.buffer as ArrayBuffer] });
          worker.onmessage?.({ data: reply } as MessageEvent);
        });
      },
    };
    return worker as unknown as Worker;
  };
  return { start, log };
}

test('the worker gives exactly the main thread\'s pixels, for a picture with the decoder\'s header', async () => {
  for (const turn of [0, 90]) {
    const expected = frameAndEditRgb16(copyOf(decoded()), turn, edit, undefined);
    const { start, log } = fakeWorker();
    const result = await frameAndEditOffThread(decoded(), turn, edit, undefined, {}, start);
    assert.deepEqual([result.width, result.height], [expected.width, expected.height]);
    assert.deepEqual(Array.from(result.data), Array.from(expected.data), `turn ${turn}`);
    assert.equal(log.terminated, 1, 'one job per worker, ended when done');
  }
});

test('a shared picture is copied for the worker and left untouched; an owned one is handed over', async () => {
  const shared = decoded();
  const before = Array.from(shared.data);
  await frameAndEditOffThread(shared, 0, edit, undefined, { shared: true }, fakeWorker().start);
  assert.deepEqual(Array.from(shared.data), before, 'the next format still gets the unedited decode');

  const owned = decoded();
  await frameAndEditOffThread(owned, 0, edit, undefined, {}, fakeWorker().start);
  assert.equal(owned.data.buffer.byteLength, 0, 'its 270 MB buffer moved to the worker instead of being copied');
});

test('cancelling ends the worker at once and rejects', async () => {
  const { start, log } = fakeWorker('hang');
  const controller = new AbortController();
  const job = frameAndEditOffThread(decoded(), 0, edit, undefined, { signal: controller.signal }, start);
  controller.abort();
  await assert.rejects(job);
  assert.equal(log.terminated, 1);
  // An already-cancelled export starts no worker.
  const again = fakeWorker();
  await assert.rejects(frameAndEditOffThread(decoded(), 0, edit, undefined, { signal: controller.signal }, again.start));
  assert.equal(again.log.posted, 0);
});

test('a worker that stops says so in plain words', async () => {
  const { start, log } = fakeWorker('fail');
  await assert.rejects(frameAndEditOffThread(decoded(), 0, edit, undefined, {}, start), /background worker stopped/);
  assert.equal(log.terminated, 1);
});

test('without workers it runs here with the same result, and a shared picture is still left untouched', async () => {
  const expected = frameAndEditRgb16(copyOf(decoded()), 90, edit, undefined);
  const shared = decoded();
  const before = Array.from(shared.data);
  const result = await frameAndEditOffThread(shared, 90, edit, undefined, { shared: true }, () => null);
  assert.deepEqual(Array.from(result.data), Array.from(expected.data));
  assert.deepEqual(Array.from(shared.data), before);
});
