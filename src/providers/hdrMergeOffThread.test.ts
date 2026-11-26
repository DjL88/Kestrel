import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeHdrOffThread, rgb16Source, runHdrMergeRequest, type HdrMergeMessage, type HdrWorkerLike } from './hdrMergeOffThread';
import { encodeLinear } from '../core/photoEdits';

const W = 96, H = 72;
function rgb16(ev: number): Uint16Array {
  const data = new Uint16Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const L = 0.01 * Math.pow(400, x / (W - 1)) * (1 + 0.3 * Math.sin(x / 3.7) * Math.sin(y / 4.1));
    const v = Math.round(encodeLinear(L * 2 ** ev) * 65535);
    data.set([v, v, v], (y * W + x) * 3);
  }
  return data;
}

test('a 16-bit RGB picture reads back as RGBA rows', () => {
  const data = Uint16Array.from({ length: 4 * 2 * 3 }, (_, i) => i);
  const rows = rgb16Source(4, 2, data).readRows(1, 1) as Uint16Array;
  assert.deepEqual([...rows.slice(0, 4)], [12, 13, 14, 65535]);
});

test('the worker side merges 16-bit develops and hands the result back', async () => {
  const messages: HdrMergeMessage[] = [];
  await runHdrMergeRequest({ frames: [-2, 0, 2].map((ev) => ({ kind: 'rgb16' as const, width: W, height: H, data: rgb16(ev) })), options: {} }, (m) => messages.push(m));
  const result = messages.find((m) => m.type === 'result');
  assert.ok(result && result.type === 'result' && result.result.ok);
  assert.equal(result.result.ok && result.result.sourceBits, 16);
  assert.ok(messages.some((m) => m.type === 'progress' && m.stage === 'merging'));
});

test('without a worker the merge runs here and says so', async () => {
  const frames = [-2, 0, 2].map((ev) => ({ kind: 'rgb16' as const, width: W, height: H, data: rgb16(ev) }));
  const { result, onMainThread } = await mergeHdrOffThread(frames, {
    createWorker: () => { throw new Error('no worker'); },
    hereSources: () => frames.map((f) => rgb16Source(f.width, f.height, f.data)),
  });
  assert.equal(onMainThread, true);
  assert.equal(result.ok, true);
});

test('a worker that runs posts its result; Cancel stops it', async () => {
  const frames = [-2, 0, 2].map((ev) => ({ kind: 'rgb16' as const, width: W, height: H, data: rgb16(ev) }));
  let terminated = 0;
  const fake = (): HdrWorkerLike => {
    const worker: HdrWorkerLike = {
      onmessage: null, onerror: null, terminate: () => { terminated++; },
      postMessage: (message) => { void runHdrMergeRequest(message as never, (m) => worker.onmessage?.({ data: m })); },
    };
    return worker;
  };
  const { result, onMainThread } = await mergeHdrOffThread(frames, { createWorker: fake, hereSources: () => [] });
  assert.equal(onMainThread, false);
  assert.equal(result.ok, true);
  assert.ok(terminated >= 1);
  // The originals' pictures are not handed away: a copy crosses.
  assert.equal(frames[0].data.length, W * H * 3);

  const controller = new AbortController();
  const hung = (): HdrWorkerLike => ({ onmessage: null, onerror: null, terminate: () => { terminated++; }, postMessage: () => { setTimeout(() => controller.abort(), 5); } });
  await assert.rejects(mergeHdrOffThread(frames, { createWorker: hung, hereSources: () => [], signal: controller.signal }));
});
