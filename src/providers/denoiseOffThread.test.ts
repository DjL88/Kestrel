import assert from 'node:assert/strict';
import test from 'node:test';
import { createDenoiseCompute, MAIN_THREAD_DENOISE_NOTE, type DenoiseWorkerLike } from './denoiseOffThread';
import { createDenoiseWorkerState, handleDenoiseWorkerMessage, openDenoiseSession, type DenoiseJob } from '../v2/engineClient/denoiseCompute';
import { estimateNoiseSigma } from '../core/noiseEstimate';
import { createSubjectMask, type SubjectGrid } from '../core/maskTypes';
import { DEFAULT_EDIT } from '../core/photoEdits';
import { fullContext, maskAlpha } from '../core/masks';
import type { Pixels } from '../core/colourCheck';
import { runDenoiseAction } from '../engine/denoiseAction';
import { verifyDenoiseRecipe } from '../v2/engineClient/denoiseRecipe';

/** A seeded, noisy synthetic photograph: a soft gradient with a bright disc for a subject. */
function syntheticPhoto(width: number, height: number, seed = 7): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  let state = seed;
  const noise = () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return ((state >> 8) % 31) - 15; };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const disc = Math.hypot(x - width / 2, y - height / 2) < width / 5;
    const base = disc ? 190 : 60 + (x / width) * 80;
    data[i] = base + noise(); data[i + 1] = base * 0.9 + noise(); data[i + 2] = base * 0.8 + noise(); data[i + 3] = 255;
  }
  return { data, width, height };
}

function discGrid(): SubjectGrid {
  const size = 16;
  const cells = Array.from({ length: size * size }, (_, i) => Math.hypot(i % size - size / 2 + 0.5, Math.floor(i / size) - size / 2 + 0.5) < size / 5 ? 255 : 0);
  return { w: size, h: size, data: btoa(String.fromCharCode(...cells)) };
}

/** Behaves like a real dedicated Worker: every message is structured-cloned across, replies arrive asynchronously. */
class ClonedWorker implements DenoiseWorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  received = 0;
  private readonly state = createDenoiseWorkerState();
  postMessage(message: unknown, transfer: Transferable[] = []): void {
    const copy = structuredClone(message, { transfer });
    this.received += 1;
    setTimeout(() => {
      if (this.terminated) return;
      const { reply, transfer: back } = handleDenoiseWorkerMessage(this.state, copy as never);
      const cloned = structuredClone(reply, { transfer: back });
      setTimeout(() => { if (!this.terminated) this.onmessage?.({ data: cloned }); }, 0);
    }, 0);
  }
  terminate(): void { this.terminated = true; }
}

function job(original: Pixels, withSubject: boolean): DenoiseJob {
  const subject = createSubjectMask('auto-denoise-p', discGrid(), 'frame', 'high');
  return {
    original, baseEdit: { ...DEFAULT_EDIT, exposure: 0.2 }, recipeId: 'auto-denoise-p', newLayers: [],
    lumaPerStrength: 0.5, subjects: withSubject ? [subject] : [],
    subjectAlpha: withSubject ? maskAlpha(subject, original.width, original.height, fullContext(original.width, original.height)) : undefined,
  };
}

test('worker and in-thread denoise give identical pixels, noise and verification on a synthetic photo', async () => {
  const photo = syntheticPhoto(96, 72);
  const worker = new ClonedWorker();
  const compute = createDenoiseCompute({ createWorker: () => worker });
  assert.equal(await compute.measureNoise(photo.data, photo.width, photo.height), estimateNoiseSigma(photo.data, photo.width, photo.height));
  for (const withSubject of [false, true]) {
    const local = openDenoiseSession(job(photo, withSubject));
    const remote = await compute.open(job(photo, withSubject));
    assert.deepEqual(remote.baseline.data, local.baseline.data);
    const masks = withSubject
      ? [{ ...createSubjectMask('auto-denoise-p-background', discGrid(), 'frame', 'high'), invert: true, edit: { denoise: 0.8 } }]
      : [];
    for (const strength of [0.8, 0.4]) {
      const edit = { denoise: withSubject ? 0 : strength };
      const [pixels, expected] = [await remote.render(edit, masks), local.render(edit, masks)];
      assert.equal(pixels.width, expected.width);
      assert.deepEqual(pixels.data, expected.data, 'same output pixels');
      assert.notDeepEqual(pixels.data, local.baseline.data, 'denoise changed something');
      assert.deepEqual(await remote.assess(edit, masks), local.assess(edit, masks));
      assert.equal(await remote.composedOk(edit, masks), local.composedOk(edit, masks));
    }
    remote.close();
  }
  assert.ok(worker.received > 0, 'the work went to the worker');
  assert.equal(compute.onMainThread, false);
  compute.dispose();
  assert.equal(worker.terminated, true);
});

test('without Workers it runs on the main thread, says so, and gives the same result', async () => {
  const photo = syntheticPhoto(64, 48, 11);
  const compute = createDenoiseCompute({ createWorker: () => { throw new Error('Workers unavailable'); } });
  const session = await compute.open(job(photo, false));
  const local = openDenoiseSession(job(photo, false));
  assert.deepEqual((await session.render({ denoise: 0.8 }, [])).data, local.render({ denoise: 0.8 }, []).data);
  assert.equal(compute.onMainThread, true);
  assert.match(MAIN_THREAD_DENOISE_NOTE, /could not denoise in the background/);
});

test('a worker that fails mid-job falls back to the main thread for that job', async () => {
  const photo = syntheticPhoto(64, 48, 5);
  let broken: ClonedWorker | null = null;
  const compute = createDenoiseCompute({ createWorker: () => (broken = new ClonedWorker()) });
  const session = await compute.open(job(photo, false));
  broken!.terminate();
  queueMicrotask(() => broken!.onerror?.({ message: 'crashed' }));
  const local = openDenoiseSession(job(photo, false));
  assert.deepEqual(await session.assess({ denoise: 0.8 }, []), local.assess({ denoise: 0.8 }, []));
  assert.equal(compute.onMainThread, true);
});

test('cancelling stops the worker and rejects the pending work', async () => {
  const photo = syntheticPhoto(64, 48, 3);
  const controller = new AbortController();
  const worker = new ClonedWorker();
  const compute = createDenoiseCompute({ createWorker: () => worker, signal: controller.signal });
  const session = await compute.open(job(photo, false));
  const pending = session.render({ denoise: 0.8 }, []);
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(worker.terminated, true);
  await assert.rejects(session.assess({ denoise: 0.8 }, []), { name: 'AbortError' });
});

test('runDenoiseAction reaches the same verified recipe through the worker as through in-thread rendering', async () => {
  const photo = syntheticPhoto(96, 72, 13);
  const local = openDenoiseSession(job(photo, false));
  const compute = createDenoiseCompute({ createWorker: () => new ClonedWorker() });
  const remote = await compute.open(job(photo, false));
  const common = { backgroundDenoise: 2, original: local.baseline, verifyCandidate: (after: Pixels) => verifyDenoiseRecipe(local.baseline, after, []) };
  const inThread = await runDenoiseAction({ ...common, render: async (edit, masks) => local.render(edit, masks) });
  const viaWorker = await runDenoiseAction({ ...common, render: async () => { throw new Error('pixels must not come back'); }, assess: remote.assess });
  assert.deepEqual(viaWorker, inThread);
  compute.dispose();
});
