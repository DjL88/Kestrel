import assert from 'node:assert/strict';
import test from 'node:test';
import { createCullObservationPool, type CullWorkerLike } from './cullObservationPool';
import { computeCullObservation, type Context2D } from './cullObservationCompute';
import { cullPoolSize, looksLikePhone } from '../core/cullPoolSize';
import { scorePreview, scoreWithSubjects } from '../core/autoCull';
import { OUTPUT_ROWS } from '../core/objectDetection';

test('pool size: every core but one, at most 4 on phones, at least 1', () => {
  assert.equal(cullPoolSize(8, false), 7);
  assert.equal(cullPoolSize(16, false), 8);
  assert.equal(cullPoolSize(8, true), 4);
  assert.equal(cullPoolSize(4, true), 3);
  assert.equal(cullPoolSize(1, false), 1);
  assert.equal(cullPoolSize(undefined, false), 1);
  assert.equal(cullPoolSize(Number.NaN, true), 1);
  assert.equal(looksLikePhone('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), true);
  assert.equal(looksLikePhone('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), false);
});

/** A worker stand-in: messages are structured-cloned, replies arrive later, and it records what it was given. */
class FakeWorker implements CullWorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  jobs: Array<{ id: number; frameId: string }> = [];
  constructor(private readonly behaviour: { failInit?: boolean; failRun?: (frameId: string) => boolean } = {}) {}
  postMessage(message: unknown): void {
    const copy = structuredClone(message) as { type: string; id: number; frameId: string };
    setTimeout(() => {
      if (this.terminated) return;
      if (copy.type === 'init') {
        this.onmessage?.({ data: this.behaviour.failInit ? { type: 'error', message: 'no OffscreenCanvas' } : { type: 'ready', loadMs: 5 } });
        return;
      }
      this.jobs.push({ id: copy.id, frameId: copy.frameId });
      const base = { frameId: copy.frameId, decision: null, confidence: 'low', score: 0.5, reason: 'detail' };
      setTimeout(() => {
        if (this.terminated) return;
        this.onmessage?.({ data: this.behaviour.failRun?.(copy.frameId)
          ? { type: 'error', id: copy.id, message: 'decode failed' }
          : { type: 'result', id: copy.id, runMs: [3], observation: { result: base, base, detectorFailed: false } } });
      }, 1);
    }, 0);
  }
  terminate(): void { this.terminated = true; }
}

test('pool spreads photos across workers, keeps each answer with its photo, and reports failures per photo', async () => {
  const workers: FakeWorker[] = [];
  const pool = await createCullObservationPool({
    size: 3, idleMs: 50,
    createWorker: () => { const worker = new FakeWorker({ failRun: (id) => id === 'f4' }); workers.push(worker); return worker; },
  });
  assert.equal(pool.size, 3);
  const blob = new Blob([new Uint8Array([1, 2, 3])]);
  const ids = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'];
  const settled = await Promise.allSettled(ids.map((id) => pool.observe(id, blob, true)));
  settled.forEach((outcome, index) => {
    if (ids[index] === 'f4') assert.equal(outcome.status, 'rejected');
    else assert.equal(outcome.status === 'fulfilled' && outcome.value.result.frameId, ids[index]);
  });
  // All three workers took part, and no photo was given to two workers.
  assert.ok(workers.every((worker) => worker.jobs.length >= 1));
  assert.deepEqual(workers.flatMap((worker) => worker.jobs.map((job) => job.frameId)).sort(), [...ids].sort());
  pool.close();
  assert.ok(workers.every((worker) => worker.terminated));
  await assert.rejects(pool.observe('late', blob, true));
});

test('a worker that cannot start means no pool (the caller keeps the main-thread path)', async () => {
  const workers: FakeWorker[] = [];
  await assert.rejects(createCullObservationPool({
    size: 2, createWorker: () => { const worker = new FakeWorker({ failInit: workers.length === 1 }); workers.push(worker); return worker; },
  }));
  assert.ok(workers.every((worker) => worker.terminated));
});

test('an idle pool closes itself, freeing its detector copies', async () => {
  let closed = 0;
  const workers: FakeWorker[] = [];
  const pool = await createCullObservationPool({
    size: 2, idleMs: 10, onClosed: () => { closed++; },
    createWorker: () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
  });
  await pool.observe('a', new Blob([]), false);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(closed, 1);
  assert.ok(workers.every((worker) => worker.terminated));
});

/** A 2D context stand-in that returns a fixed synthetic picture at whatever size is asked for. */
function fakeContext(width: number, height: number): Context2D {
  return {
    drawImage() {},
    getImageData(_x, _y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = ((x >> 2) + (y >> 2)) % 2 ? 220 : 30; // a fine checkerboard: plenty of detail
        data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
      }
      void width; void height;
      return { data };
    },
  };
}

test('worker compute matches the main-thread detail score at 256 px, and a detector failure is never hidden', async () => {
  const picture = { width: 1620, height: 1080 };
  const detailOnly = await computeCullObservation('p1', picture, fakeContext, null);
  const expected = scorePreview('p1', fakeContext(256, 171).getImageData(0, 0, 256, 171).data, 256, 171);
  assert.deepEqual(detailOnly.base, expected);
  assert.deepEqual(detailOnly.result, expected);
  assert.equal(detailOnly.detectorFailed, false);

  const broken = await computeCullObservation('p1', picture, fakeContext, async () => { throw new Error('model gone'); });
  assert.equal(broken.detectorFailed, true);
  assert.deepEqual(broken.result, expected);

  // A detector that sees nothing: the same answer the main thread gives for "no subject found".
  const empty = await computeCullObservation('p1', picture, fakeContext, async () => new Float32Array(OUTPUT_ROWS * 85));
  assert.equal(empty.detectorFailed, false);
  assert.deepEqual(empty.result, scoreWithSubjects(expected, []));
});
