import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PhotoFrame } from '../core/types';
import { loadAnalysisPicture, type AnalysisProvider, type ScreenDevelop } from './analysisPicture';

const raw = { id: 'f1', stableKey: 'k1', filename: 'DSC_0001.NEF', originalSha256: 'a'.repeat(64) } as PhotoFrame;
const picture = (blob: Blob) => ({ from: blob }) as unknown as HTMLImageElement;

function setup(options: { stored?: boolean; original?: boolean; storeOk?: boolean } = {}) {
  const log: string[] = [];
  let review: Blob | null = options.stored ? new Blob(['stored']) : null;
  const provider: AnalysisProvider = {
    developedReview: async () => (review ? { thumbnail: new Blob(['t']), review } : null),
    ensureOriginal: async () => { log.push('original'); return options.original === false ? null : new Blob(['raw']); },
    storeDevelopedPicture: async (_frame, _original, developed) => {
      log.push('store');
      if (options.storeOk === false) return false;
      review = developed;
      return true;
    },
  } as AnalysisProvider;
  const steps: ScreenDevelop = {
    develop: async (_original, extension) => { log.push(`develop ${extension}`); await new Promise((r) => setTimeout(r, 5)); return new Blob(['screen']); },
    orient: async (developed) => { log.push('orient'); return developed; },
    decode: async (blob) => picture(blob),
  };
  return { provider, steps, log };
}

test('a stored screen develop is used as it is: nothing is developed', async () => {
  const { provider, steps, log } = setup({ stored: true });
  const image = await loadAnalysisPicture(raw, provider, undefined, steps);
  assert.equal(await (image as unknown as { from: Blob }).from.text(), 'stored');
  assert.deepEqual(log, []);
});

test('with none stored, a screen-size develop is made, turned, stored and used, once however many ask', async () => {
  const { provider, steps, log } = setup();
  const [a, b] = await Promise.all([loadAnalysisPicture(raw, provider, undefined, steps), loadAnalysisPicture(raw, provider, undefined, steps)]);
  assert.equal(await (a as unknown as { from: Blob }).from.text(), 'screen');
  assert.notEqual(a, b, 'each caller gets its own picture');
  assert.deepEqual(log, ['original', 'develop NEF', 'orient', 'store']);
  // Next time it is simply the stored one.
  await loadAnalysisPicture(raw, provider, undefined, steps);
  assert.deepEqual(log, ['original', 'develop NEF', 'orient', 'store']);
});

test('no picture, rather than a guess, when the original is missing or the source changed meanwhile', async () => {
  const missing = setup({ original: false });
  assert.equal(await loadAnalysisPicture(raw, missing.provider, undefined, missing.steps), null);
  assert.deepEqual(missing.log, ['original']);
  const changed = setup({ storeOk: false });
  assert.equal(await loadAnalysisPicture(raw, changed.provider, undefined, changed.steps), null);
});

test('only RAWs: JPEGs and demo photos are left to their own path', async () => {
  const { provider, steps, log } = setup();
  assert.equal(await loadAnalysisPicture({ ...raw, filename: 'photo.jpg' } as PhotoFrame, provider, undefined, steps), null);
  assert.equal(await loadAnalysisPicture({ ...raw, isDemo: true } as PhotoFrame, provider, undefined, steps), null);
  assert.deepEqual(log, []);
});

test('a cancelled analysis stops before developing', async () => {
  const { provider, steps, log } = setup();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadAnalysisPicture(raw, provider, controller.signal, steps));
  assert.deepEqual(log, []);
});
