import assert from 'node:assert/strict';
import test from 'node:test';
import type { PanoSource } from '../core/panorama.ts';
import { runPanoramaRequest, stitchPanoramaOffThread, type PanoramaMessage, type PanoWorkerLike } from './panoramaOffThread.ts';

function rng(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }
const W = 200, H = 140, SHIFT = 90;

/** Two flat crops of one blocky texture, SHIFT pixels apart, as a long-lens pair (cylinder ≈ plane). */
function frames(): PanoSource[] {
  const rand = rng(11);
  const TW = W + SHIFT, cell = 6, gw = Math.ceil(TW / cell), gh = Math.ceil(H / cell);
  const grid = Array.from({ length: gw * gh }, rand);
  const at = (x: number, y: number) => grid[Math.floor(y / cell) * gw + Math.floor(x / cell)];
  return [0, SHIFT].map((left) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4, v = Math.round(255 * at(x + left, y));
      data[p] = v; data[p + 1] = 255 - v; data[p + 2] = (v * 3) % 256; data[p + 3] = 255;
    }
    return { width: W, height: H, data, bits: 8 as const };
  });
}

/** A worker that runs the real worker handler in this process, with frames standing in for bitmaps. */
function fakeWorker(sources: PanoSource[], hooks: { terminated?: () => void } = {}): PanoWorkerLike {
  const worker: PanoWorkerLike = {
    onmessage: null, onerror: null,
    postMessage(message) {
      const request = message as { bitmaps: unknown[]; options: object };
      let i = 0;
      void runPanoramaRequest({ bitmaps: request.bitmaps as ImageBitmap[], options: request.options },
        (reply) => setTimeout(() => worker.onmessage?.({ data: reply }), 0), () => sources[i++]);
    },
    terminate() { hooks.terminated?.(); },
  };
  return worker;
}

const bitmapStandIn = async () => ({ close() {} }) as unknown as ImageBitmap;
const LONG_LENS = { focalPx: 50_000 };

test('stitching runs in the worker, reports progress there, and gives the same picture as this thread', async () => {
  const f = frames();
  const seen: string[] = [];
  let terminated = 0;
  const off = await stitchPanoramaOffThread([{} as CanvasImageSource, {} as CanvasImageSource], {
    ...LONG_LENS,
    createWorker: () => fakeWorker(f, { terminated: () => { terminated++; } }), toBitmap: bitmapStandIn,
    hereSources: () => { throw new Error('should not run here'); },
    onProgress: (done, total, stage) => seen.push(`${stage}:${done}/${total}`),
  });
  assert.equal(off.onMainThread, false);
  assert.ok(off.result.ok, JSON.stringify(off.result));
  assert.ok(seen.some((s) => s.startsWith('blending:')));
  assert.equal(terminated, 1, 'the worker is stopped when it has finished');
  const here = await stitchPanoramaOffThread([], { ...LONG_LENS, createWorker: () => { throw new Error('no workers'); }, hereSources: () => f });
  assert.equal(here.onMainThread, true);
  assert.ok(here.result.ok && off.result.ok);
  if (here.result.ok && off.result.ok) {
    assert.deepEqual(off.result.data, here.result.data);
    assert.ok(Math.abs(off.result.placements[1].du - SHIFT) < 1, `du ${off.result.placements[1].du}`);
  }
});

test('a worker that stops falls back to this thread; Cancel stops the worker and does not run here', async () => {
  const f = frames();
  const lost: PanoWorkerLike = { onmessage: null, onerror: null, postMessage() { setTimeout(() => lost.onerror?.({}), 0); }, terminate() {} };
  const fallback = await stitchPanoramaOffThread([{} as CanvasImageSource], { ...LONG_LENS, createWorker: () => lost, toBitmap: bitmapStandIn, hereSources: () => f });
  assert.equal(fallback.onMainThread, true);
  assert.ok(fallback.result.ok);

  const controller = new AbortController();
  let terminated = false;
  const silent: PanoWorkerLike = { onmessage: null, onerror: null, postMessage() { setTimeout(() => controller.abort(new Error('stopped')), 0); }, terminate() { terminated = true; } };
  await assert.rejects(stitchPanoramaOffThread([{} as CanvasImageSource], {
    createWorker: () => silent, toBitmap: bitmapStandIn, signal: controller.signal, hereSources: () => { throw new Error('should not run here'); },
  }), /stopped/);
  assert.equal(terminated, true);
});

test('the worker side posts a refusal as a result and an error as a message, and closes its bitmaps', async () => {
  const messages: PanoramaMessage[] = [];
  let closed = 0;
  const bitmap = { close: () => { closed++; } } as unknown as ImageBitmap;
  await runPanoramaRequest({ bitmaps: [bitmap], options: {} }, (m) => messages.push(m), () => frames()[0]);
  assert.deepEqual(messages.at(-1), { type: 'result', result: { ok: false, reason: 'too-few' } });
  await runPanoramaRequest({ bitmaps: [bitmap, bitmap], options: {} }, (m) => messages.push(m), () => { throw new Error('unreadable'); });
  assert.deepEqual(messages.at(-1), { type: 'error', message: 'unreadable' });
  assert.ok(closed >= 3);
});
