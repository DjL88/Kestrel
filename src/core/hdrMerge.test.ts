import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HDR_TONE, mergeHdr, toneHdr, type HdrSource, type HdrSuccess, type HdrTone } from './hdrMerge';
import { encodeLinear } from './photoEdits';

/** Synthetic brackets: a scene in linear light spanning about 11 stops, photographed at several exposures into 8-bit sRGB. */
const W = 160, H = 120;
function sceneAt(x: number, y: number): number {
  // Left to right from deep shadow (0.004) to far beyond white (8), with texture in both directions to line up on.
  const base = 0.004 * Math.pow(2000, x / (W - 1));
  const texture = 1 + 0.35 * Math.sin(x / 4.3) * Math.sin(y / 5.1) + 0.2 * Math.sin((x + 2 * y) / 9.7);
  const block = (x % 40 < 12 && y % 30 < 10) ? 0.6 : 1;
  return base * texture * block;
}

interface Bird { x: number; y: number; size: number; radiance: number }
function frame(ev: number, opts: { dx?: number; dy?: number; bird?: Bird; scene?: (x: number, y: number) => number; w?: number; h?: number } = {}): Uint8ClampedArray {
  const w = opts.w ?? W, h = opts.h ?? H;
  const data = new Uint8ClampedArray(w * h * 4);
  const scene = opts.scene ?? sceneAt;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // The camera moved by (dx, dy): frame pixel (x, y) saw scene point (x - dx, y - dy).
    const sx = x - (opts.dx ?? 0), sy = y - (opts.dy ?? 0);
    let L = scene(Math.max(0, Math.min(w - 1, sx)), Math.max(0, Math.min(h - 1, sy)));
    const b = opts.bird;
    if (b && sx >= b.x && sx < b.x + b.size && sy >= b.y && sy < b.y + b.size) L = b.radiance;
    const v = Math.round(encodeLinear(L * 2 ** ev) * 255);
    const i = (y * w + x) * 4;
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
  }
  return data;
}
function source(data: Uint8ClampedArray | Uint16Array, w = W, h = H, bits: 8 | 16 = 8): HdrSource {
  return { width: w, height: h, bits, readRows: (y0, rows) => data.slice(y0 * w * 4, (y0 + rows) * w * 4) };
}
const at = (r: HdrSuccess, x: number, y: number) => r.data[(y * r.width + x) * 3 + 1];
/** What the tone step makes of a true scene value at the reference exposure. */
function expected(L: number, tone: HdrTone = DEFAULT_HDR_TONE): number {
  const b = new Float32Array([L, L, L, 1]);
  toneHdr(b, tone);
  return Math.round(b[1] * 65535);
}
async function ok(sources: HdrSource[], options = {}): Promise<HdrSuccess> {
  const r = await mergeHdr(sources, options);
  assert.equal(r.ok, true, `refused: ${JSON.stringify(r)}`);
  return r as HdrSuccess;
}

test('a three-frame bracket measures each exposure from its pixels and picks the middle as reference', async () => {
  const r = await ok([frame(0), frame(-2), frame(2)].map((d) => source(d)));
  assert.equal(r.referenceIndex, 0);
  assert.ok(Math.abs(r.exposureEv[1] + 2) < 0.15, `dark frame ${r.exposureEv[1]}`);
  assert.ok(Math.abs(r.exposureEv[2] - 2) < 0.15, `bright frame ${r.exposureEv[2]}`);
  assert.equal(r.width, W); assert.equal(r.height, H);
  assert.equal(r.data.length, W * H * 3, 'full size, never smaller');
});

test('the merge recovers scene light the reference clipped or crushed, close to the truth', async () => {
  const r = await ok([frame(-2), frame(0), frame(2)].map((d) => source(d)));
  let worst = 0;
  for (let y = 4; y < H - 4; y += 7) for (let x = 2; x < W - 2; x += 5) {
    const L = sceneAt(x, y);
    if (L * 4 > 0.97) continue; // the darkest frame clipped here too
    worst = Math.max(worst, Math.abs(at(r, x, y) - expected(L, r.tone)) / 65535);
  }
  assert.ok(worst < 0.03, `largest error ${worst.toFixed(4)} of full scale`);
  // Where the reference is blown (scene 2 and scene 4 are both white in it), the merge still tells them apart.
  const two = expected(2, r.tone), four = expected(4, r.tone);
  assert.ok(r.tone.white > 3.5, `white ${r.tone.white}`);
  assert.ok(four - two > 1500, `${two} vs ${four}`);
  const ref = frame(0);
  assert.equal(ref[(60 * W + 150) * 4], 255, 'the reference really is clipped there');
});

test('a 16-bit result, not 8-bit levels: smooth shadows hold many more than 256 distinct values', async () => {
  const r = await ok([frame(-2), frame(0), frame(2)].map((d) => source(d)));
  const levels = new Set<number>();
  for (let i = 1; i < r.data.length; i += 3) levels.add(r.data[i]);
  assert.ok(levels.size > 1000, `${levels.size} levels`);
});

test('a camera that moved between frames is lined up to within a fraction of a pixel', async () => {
  const r = await ok([source(frame(-2, { dx: 3, dy: -2 })), source(frame(0)), source(frame(2, { dx: -4, dy: 1 }))]);
  assert.ok(Math.abs(r.alignment[0].dx - 3) < 0.5 && Math.abs(r.alignment[0].dy + 2) < 0.5, JSON.stringify(r.alignment[0]));
  assert.ok(Math.abs(r.alignment[2].dx + 4) < 0.5 && Math.abs(r.alignment[2].dy - 1) < 0.5, JSON.stringify(r.alignment[2]));
  assert.deepEqual([r.alignment[1].dx, r.alignment[1].dy], [0, 0]);
  // And the merge still matches the truth in the middle tones away from the edges.
  for (const [x, y] of [[40, 60], [80, 40], [100, 90]]) {
    assert.ok(Math.abs(at(r, x, y) - expected(sceneAt(x, y), r.tone)) / 65535 < 0.04, `at ${x},${y}`);
  }
});

test('a bird that moved is taken from one frame only, so it never doubles', async () => {
  const bird = (x: number): Bird => ({ x, y: 50, size: 14, radiance: 0.01 });
  // A textured mid-tone sky, so the frames can still be lined up on it.
  const sky = (x: number, y: number) => 0.25 * (1 + 0.3 * Math.sin(x / 4.3) * Math.sin(y / 5.1));
  const frames = [frame(-1.5, { bird: bird(20), scene: sky }), frame(0, { bird: bird(70), scene: sky }), frame(1.5, { bird: bird(120), scene: sky })];
  const clean = await ok(frames.map((d) => source(d)));
  const skyAt = (x: number, y: number) => expected(sky(x, y), clean.tone);
  // The reference's bird is there; where the other frames had it, only sky.
  assert.ok(at(clean, 77, 57) < skyAt(77, 57) * 0.6, `reference bird kept: ${at(clean, 77, 57)} vs sky ${skyAt(77, 57)}`);
  for (const x of [27, 127]) {
    const want = skyAt(x, 57);
    assert.ok(Math.abs(at(clean, x, 57) - want) / want < 0.03, `ghost at ${x}: ${at(clean, x, 57)} vs sky ${want}`);
  }
  assert.ok(clean.ghostShare[0] > 0 && clean.ghostShare[2] > 0);
  assert.ok(clean.warnings.some((w) => w.code === 'ghosts-removed'));
  // Without ghost removal the same frames do double: proof the test can see it.
  const doubled = await ok(frames.map((d) => source(d)), { ghostRemoval: false });
  assert.ok(Math.abs(at(doubled, 127, 57) - skyAt(127, 57)) / skyAt(127, 57) > 0.1, `ghost visible without masks: ${at(doubled, 127, 57)} vs ${skyAt(127, 57)}`);
});

test('reading in small bands gives exactly the same picture as one big band', async () => {
  const frames = [frame(-2), frame(0), frame(2)];
  const big = await ok(frames.map((d) => source(d)));
  const small = await ok(frames.map((d) => source(d)), { maxWorkingBytes: 1 });
  assert.deepEqual(small.data, big.data);
});

test('a downscaled alignment copy (a big picture) still lines up and measures exposure', async () => {
  const r = await ok([source(frame(-2, { dx: 4, dy: 2 })), source(frame(0)), source(frame(2))], { alignEdge: 80 });
  assert.ok(Math.abs(r.alignment[0].dx - 4) < 1 && Math.abs(r.alignment[0].dy - 2) < 1, JSON.stringify(r.alignment[0]));
  assert.ok(Math.abs(r.exposureEv[0] + 2) < 0.2);
});

test('16-bit sources merge too', async () => {
  const to16 = (d: Uint8ClampedArray) => Uint16Array.from(d, (v) => v * 257);
  const r = await ok([frame(-2), frame(0), frame(2)].map((d) => source(to16(d), W, H, 16)));
  assert.equal(r.sourceBits, 16);
  assert.ok(Math.abs(r.exposureEv[0] + 2) < 0.15);
});

test('refuses rather than guesses', async () => {
  assert.deepEqual(await mergeHdr([source(frame(0))]), { ok: false, reason: 'too-few' });
  assert.equal((await mergeHdr(Array.from({ length: 8 }, () => source(frame(0))))).ok, false);
  const other = frame(0, { w: 80, h: 60 });
  assert.deepEqual(await mergeHdr([source(frame(0)), source(other, 80, 60)]), { ok: false, reason: 'size-mismatch', frameNumber: 2 });
  assert.deepEqual(await mergeHdr([source(frame(0)), source(frame(0.1))]), { ok: false, reason: 'same-exposure' });
  let seed = 7;
  const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const unrelated = frame(2, { scene: () => 0.02 + noise() * 0.2 });
  const refused = await mergeHdr([source(frame(0)), source(unrelated)]);
  assert.equal(refused.ok, false);
  assert.equal((refused as { reason: string }).reason, 'unrelated');
});

test('the originals are only read, never written', async () => {
  const frames = [frame(-2), frame(0), frame(2)];
  const copies = frames.map((d) => Uint8ClampedArray.from(d));
  await ok(frames.map((d) => ({ width: W, height: H, bits: 8 as const, readRows: (y0: number, rows: number) => d.subarray(y0 * W * 4, (y0 + rows) * W * 4) })));
  frames.forEach((d, i) => assert.deepEqual(d, copies[i]));
});

test('Cancel stops the merge', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(mergeHdr([frame(-2), frame(0)].map((d) => source(d)), { signal: controller.signal }));
});

test('the tone step keeps order, puts the measured white at white and clips nothing below it', () => {
  const tone = { ...DEFAULT_HDR_TONE, white: 8 };
  let last = -1;
  for (const L of [0, 0.001, 0.01, 0.1, 0.5, 1, 2, 4, 7.9]) {
    const v = expected(L, tone);
    assert.ok(v > last || L === 0, `monotonic at ${L}`);
    last = v;
  }
  assert.ok(expected(7.9, tone) < 65535);
  // Highlight texture survives: 4 and 5 stay clearly apart.
  assert.ok(expected(5, tone) - expected(4, tone) > 600);
});

test('the recipe records the bracket and survives a round trip; a tampered one is refused', async () => {
  const { hdrMergeRecipe, readHdrMergeRecipe } = await import('./hdrMergeRecipe');
  const r = await ok([frame(-2), frame(0), frame(2)].map((d) => source(d)));
  const refs = ['a', 'b', 'c'].map((id) => ({ frameId: id, stableKey: `k-${id}`, filename: `${id}.png`, originalSha256: 'f'.repeat(64) }));
  const recipe = hdrMergeRecipe(r, refs, 'original', 1);
  const back = readHdrMergeRecipe(JSON.parse(JSON.stringify(recipe)));
  assert.ok(back);
  assert.equal(back.generatedPixels, false);
  assert.deepEqual(back.sources.map((s) => s.filename), ['a.png', 'b.png', 'c.png']);
  assert.ok(Math.abs(back.exposureEv[0] + 2) < 0.15);
  assert.equal(readHdrMergeRecipe({ ...recipe, generatedPixels: true }), null);
  assert.equal(readHdrMergeRecipe({ ...recipe, exposureEv: [0, 0] }), null);
  assert.equal(readHdrMergeRecipe({ ...recipe, output: { ...recipe.output, format: 'jpeg' } }), null);
});
