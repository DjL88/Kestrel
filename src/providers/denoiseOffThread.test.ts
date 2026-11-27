import assert from 'node:assert/strict';
import test from 'node:test';
import { createDenoiseCompute, MAIN_THREAD_DENOISE_NOTE, type DenoiseWorkerLike } from './denoiseOffThread';
import { createDenoiseWorkerState, handleDenoiseWorkerMessage, learnedVerdicts, openDenoiseSession, type DenoiseJob } from '../v2/engineClient/denoiseCompute';
import { estimateNoiseSigma } from '../core/noiseEstimate';
import { createSubjectMask, type SubjectGrid } from '../core/maskTypes';
import { DEFAULT_EDIT } from '../core/photoEdits';
import { fullContext, maskAlpha } from '../core/masks';
import type { Pixels } from '../core/colourCheck';
import { regionalDenoiseMasks, runDenoiseAction } from '../engine/denoiseAction';
import { composeDenoiseRecipe, renderDenoiseRecipe, verifyDenoiseRecipe } from '../v2/engineClient/denoiseRecipe';
import { blendLearned, trueDetailAiWeight } from '../core/trueDetailAi';

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
  const compute = createDenoiseCompute({ createWorker: () => { throw new Error('Workers unavailable'); }, runOnPage: true });
  const session = await compute.open(job(photo, false));
  const local = openDenoiseSession(job(photo, false));
  assert.deepEqual((await session.render({ denoise: 0.8 }, [])).data, local.render({ denoise: 0.8 }, []).data);
  assert.equal(compute.onMainThread, true);
  assert.match(MAIN_THREAD_DENOISE_NOTE, /could not denoise in the background/);
});

test('a worker that fails mid-job falls back to the main thread for that job', async () => {
  const photo = syntheticPhoto(64, 48, 5);
  let broken: ClonedWorker | null = null;
  const compute = createDenoiseCompute({ createWorker: () => (broken = new ClonedWorker()), runOnPage: true });
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

test('a TrueDetail learned result is blended in the worker exactly as the in-thread render blends it', async () => {
  const photo = syntheticPhoto(96, 72, 17);
  // A stand-in for the learned denoiser's working-size picture: a smoother copy of the photo.
  const learned = new Uint8ClampedArray(syntheticPhoto(96, 72, 1).data.map((v, i) => i % 4 === 3 ? 255 : Math.round(v * 0.5 + 64)));
  const base = job(photo, true);
  const compute = createDenoiseCompute({ createWorker: () => new ClonedWorker() });
  const remote = await compute.open({ ...base, learned });
  const subject = { maskId: base.recipeId, grid: discGrid(), framingKey: 'frame', confidence: 'high' as const, alpha: base.subjectAlpha! };
  const masks = regionalDenoiseMasks(subject, { background: 0.6, subject: 0.2, eyes: 0.2 }, base.lumaPerStrength);
  const edit = { denoise: 0 };
  const blend = { subject: 1, eyes: 1 };
  // Main's in-thread TrueDetail render, written out independently of denoiseCompute.
  const recipe = composeDenoiseRecipe(base.baseEdit, base.recipeId, 0, masks, base.lumaPerStrength);
  const data = new Uint8ClampedArray(photo.data);
  blendLearned(data, learned, trueDetailAiWeight({ maskId: base.recipeId, ...blend }, recipe.masks, photo.width, photo.height, fullContext(photo.width, photo.height)));
  const expected = renderDenoiseRecipe({ data, width: photo.width, height: photo.height }, recipe);
  const viaWorker = await remote.render(edit, masks, blend);
  assert.deepEqual(viaWorker.data, expected.data, 'same blended pixels');
  assert.notDeepEqual(viaWorker.data, (await remote.render(edit, masks)).data, 'the blend changed the subject');
  assert.deepEqual(await remote.assess(edit, masks, blend), openDenoiseSession({ ...base, learned }).assess(edit, masks, blend));
  compute.dispose();
});

test('the full-size learned check gives the same verdicts in the worker as in-thread, and without Workers', async () => {
  const photo = syntheticPhoto(96, 72, 21);
  // A "learned" result that smooths everything: box-blurred copy of the photo.
  const blurred = new Uint8ClampedArray(photo.data);
  for (let y = 1; y < photo.height - 1; y++) for (let x = 1; x < photo.width - 1; x++) for (let c = 0; c < 3; c++) {
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += photo.data[((y + dy) * photo.width + x + dx) * 4 + c];
    blurred[(y * photo.width + x) * 4 + c] = Math.round(sum / 9);
  }
  const learned = { data: blurred, width: photo.width, height: photo.height };
  const alpha = new Float32Array(photo.width * photo.height).fill(1);
  const expected = learnedVerdicts(photo, learned, alpha, [1, 0.6]);
  const worker = new ClonedWorker();
  const viaWorker = await createDenoiseCompute({ createWorker: () => worker }).qualifyLearned(photo, learned, alpha, [1, 0.6]);
  assert.deepEqual(viaWorker, expected);
  assert.ok(worker.received > 0, 'the check went to the worker');
  const fallback = createDenoiseCompute({ createWorker: () => { throw new Error('Workers unavailable'); }, runOnPage: true });
  assert.deepEqual(await fallback.qualifyLearned(photo, learned, alpha, [1, 0.6]), expected);
  assert.equal(fallback.onMainThread, true);
});

test('in the app, denoise never runs on the page: with no worker the job stops with a plain message and nothing runs', async () => {
  const photo = syntheticPhoto(64, 48, 11);
  const compute = createDenoiseCompute({ createWorker: () => { throw new Error('Workers unavailable'); } });
  await assert.rejects(compute.open(job(photo, false)), /could not denoise in the background, so nothing was changed/);
  await assert.rejects(compute.measureNoise(photo.data, photo.width, photo.height), /nothing was changed/);
  assert.equal(compute.onMainThread, false, 'no pixel work ran on the page');
});
