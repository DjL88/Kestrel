import assert from 'node:assert/strict';
import test from 'node:test';
import { frameSource, type StackFrame, type StackSource } from '../core/focusStack.ts';
import { runFocusStackRequest, stackFocusOffThread, type FocusStackMessage, type StackWorkerLike } from './focusStackOffThread.ts';

function rng(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }
const W = 96, H = 64;
function frames(): StackFrame[] {
  const rand = rng(4);
  const base = Float32Array.from({ length: W * H }, rand);
  return [0, 1].map((i) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sharp = (x < W / 2) === (i === 0);
      let v = base[y * W + x];
      if (!sharp) { let s = 0, n = 0; for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) { const yy = Math.min(H - 1, Math.max(0, y + oy)), xx = Math.min(W - 1, Math.max(0, x + ox)); s += base[yy * W + xx]; n++; } v = s / n; }
      const p = (y * W + x) * 4; data[p] = data[p + 1] = data[p + 2] = Math.round(v * 255); data[p + 3] = 255;
    }
    return { width: W, height: H, data };
  });
}

/** A worker that runs the real worker handler in this process, with frames standing in for bitmaps. */
function fakeWorker(sources: StackSource[], hooks: { terminated?: () => void } = {}): StackWorkerLike {
  const worker: StackWorkerLike = {
    onmessage: null, onerror: null,
    postMessage(message) {
      const request = message as { bitmaps: unknown[]; options: object };
      let i = 0;
      void runFocusStackRequest({ bitmaps: request.bitmaps as ImageBitmap[], options: request.options },
        (reply) => setTimeout(() => worker.onmessage?.({ data: reply }), 0), () => sources[i++]);
    },
    terminate() { hooks.terminated?.(); },
  };
  return worker;
}

const bitmapStandIn = async () => ({ close() {} }) as unknown as ImageBitmap;

test('the stack runs in the worker, reports progress there, and gives the same picture as this thread', async () => {
  const f = frames();
  const seen: string[] = [];
  let terminated = 0;
  const off = await stackFocusOffThread([{} as CanvasImageSource, {} as CanvasImageSource], {
    createWorker: () => fakeWorker(f.map(frameSource), { terminated: () => { terminated++; } }), toBitmap: bitmapStandIn,
    hereSources: () => { throw new Error('should not run here'); },
    onProgress: (done, total, stage) => seen.push(`${stage}:${done}/${total}`),
  });
  assert.equal(off.onMainThread, false);
  assert.ok(off.result.ok);
  assert.ok(seen.includes('blending:5/5'));
  assert.equal(terminated, 1, 'the worker is stopped when it has finished');
  const here = await stackFocusOffThread([], { createWorker: () => { throw new Error('no workers'); }, hereSources: () => f.map(frameSource) });
  assert.equal(here.onMainThread, true);
  assert.ok(here.result.ok && off.result.ok);
  if (here.result.ok && off.result.ok) assert.deepEqual(off.result.data, here.result.data);
});

test('a worker that stops falls back to this thread; Cancel stops the worker and does not run here', async () => {
  const f = frames();
  const lost: StackWorkerLike = { onmessage: null, onerror: null, postMessage() { setTimeout(() => lost.onerror?.({}), 0); }, terminate() {} };
  const fallback = await stackFocusOffThread([{} as CanvasImageSource], { createWorker: () => lost, toBitmap: bitmapStandIn, hereSources: () => f.map(frameSource) });
  assert.equal(fallback.onMainThread, true);
  assert.ok(fallback.result.ok);

  const controller = new AbortController();
  let terminated = false;
  const silent: StackWorkerLike = { onmessage: null, onerror: null, postMessage() { setTimeout(() => controller.abort(new Error('stopped')), 0); }, terminate() { terminated = true; } };
  await assert.rejects(stackFocusOffThread([{} as CanvasImageSource], {
    createWorker: () => silent, toBitmap: bitmapStandIn, signal: controller.signal, hereSources: () => { throw new Error('should not run here'); },
  }), /stopped/);
  assert.equal(terminated, true);
});

test('the worker side posts a refusal as a result and an error as a message, and closes its bitmaps', async () => {
  const messages: FocusStackMessage[] = [];
  let closed = 0;
  const bitmap = { close: () => { closed++; } } as unknown as ImageBitmap;
  await runFocusStackRequest({ bitmaps: [bitmap], options: {} }, (m) => messages.push(m), () => frameSource(frames()[0]));
  assert.deepEqual(messages.at(-1), { type: 'result', result: { ok: false, reason: 'too-few' } });
  await runFocusStackRequest({ bitmaps: [bitmap, bitmap], options: {} }, (m) => messages.push(m), () => { throw new Error('unreadable'); });
  assert.deepEqual(messages.at(-1), { type: 'error', message: 'unreadable' });
  assert.equal(closed, 3);
});
