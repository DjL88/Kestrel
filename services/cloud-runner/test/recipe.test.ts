import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { runJob, type RunnerStore } from '../src/run.ts';
import { parseCloudRecipe } from '../../../src/core/cloudRecipe.ts';

const store = (files: Record<string, Uint8Array>): RunnerStore & { files: Record<string, Uint8Array> } => ({
  files,
  read: async (name) => { if (!files[name]) throw new Error('missing'); return files[name]; },
  write: async (name, bytes) => { files[name] = bytes; },
});

/** A synthetic, under-exposed scene with some texture: a dark gradient with a brighter band. */
function darkJpeg(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  let seed = 11;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const base = 25 + Math.round((x / width) * 35) + (y > height / 3 && y < height / 2 ? 30 : 0) + ((seed >> 8) % 9);
    const i = (y * width + x) * 4;
    data[i] = base + 6; data[i + 1] = base; data[i + 2] = base - 4; data[i + 3] = 255;
  }
  return new Uint8Array(jpeg.encode({ data, width, height }, 90).data);
}

describe('cloud runner: recipe jobs', () => {
  it('turns a smart preview into a small recipe the app accepts, with no pixels in it', async () => {
    const files = store({ 'inputs/r1': darkJpeg(480, 320) });
    assert.equal(await runJob(files, 'r1', 'recipe', undefined, 'smart-preview'), true);
    const bytes = files.files['results/r1'];
    assert.ok(bytes.byteLength < 2048, `a few KB at most, got ${bytes.byteLength}`);
    const recipe = parseCloudRecipe(bytes, { jobId: 'r1', input: 'smart-preview' });
    assert.ok(recipe, 'the app reads the runner\'s answer');
    assert.equal(recipe.producer?.name, 'InFlight natural Auto (cloud runner)');
    assert.ok((recipe.settings.exposure ?? 0) > 0, 'a dark picture is brightened');
  });

  it('refuses a "smart preview" larger than 2,560 px, a RAW, and a job without its input kind', async () => {
    const big = store({ 'inputs/r2': darkJpeg(2600, 40) });
    assert.equal(await runJob(big, 'r2', 'recipe', undefined, 'smart-preview'), false);
    assert.ok(big.files['failed/r2'] && !big.files['results/r2']);
    const raw = store({ 'inputs/r3': new Uint8Array([0x49, 0x49, 0x2a, 0x00, 1, 2, 3]) });
    assert.equal(await runJob(raw, 'r3', 'recipe', undefined, 'original'), false);
    const unsaid = store({ 'inputs/r4': darkJpeg(64, 64) });
    assert.equal(await runJob(unsaid, 'r4', 'recipe'), false);
  });

  it('accepts a JPEG original only as an original, and says so in its answer', async () => {
    const files = store({ 'inputs/r5': darkJpeg(2600, 40) });
    assert.equal(await runJob(files, 'r5', 'recipe', undefined, 'original'), true);
    assert.ok(parseCloudRecipe(files.files['results/r5'], { jobId: 'r5', input: 'original' }));
    assert.equal(parseCloudRecipe(files.files['results/r5'], { jobId: 'r5', input: 'smart-preview' }), null);
  });
});
