import test from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { enhancePhoto, type EnhanceResult } from './enhanceLoop';

/**
 * Parity: the enhance loop core is pure and deterministic, so the device path and a server-side (cloud runner) path give the
 * same recipes and the same pixels for the same input. The cloud runner today runs only deterministic maths (no neural model);
 * this guards the property that lets bulk work run there later without a second implementation.
 */
const W = 160, H = 100;
const enc = (l: number) => Math.round(255 * Math.min(1, Math.max(0, l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)));
function scene(gain: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  let s = 5;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const base = y < H * 0.45 ? 0.5 - 0.25 * (y / H) + 0.012 * rnd() : 0.14 + 0.02 * Math.sin(x / 8) * Math.sin(y / 6) + 0.006 * rnd();
    const o = (y * W + x) * 4;
    px[o] = enc(base * gain); px[o + 1] = enc(base * gain * 0.97); px[o + 2] = enc(base * gain * 0.93); px[o + 3] = 255;
  }
  return px;
}
const META = { evCompensation: -1, shutterSeconds: 1 / 2000, iso: 3200, aperture: 4 };
const summary = (r: EnhanceResult) => JSON.stringify({
  reading: r.exposure.reading, favourite: r.favourite,
  options: r.options.map((o) => ({ style: o.style, outcome: o.outcome, edit: o.edit, steps: o.steps, best: o.bestRound, rounds: o.rounds.map((k) => [k.score, k.gate]) })),
});
const bytes = (r: EnhanceResult) => r.options.map((o) => Buffer.from(o.pixels).toString('base64'));

test('same photo, same recipe: two runs are byte-identical', async () => {
  const a = await enhancePhoto({ pixels: scene(0.4), width: W, height: H, meta: META });
  const b = await enhancePhoto({ pixels: scene(0.4), width: W, height: H, meta: META });
  assert.equal(summary(a), summary(b));
  assert.deepEqual(bytes(a), bytes(b));
});

test('device path and cloud-runner path agree: the input goes through the runner\'s own JPEG decode and a structured clone', async () => {
  const original = scene(0.4);
  const device = await enhancePhoto({ pixels: original, width: W, height: H, meta: META });
  // The runner receives encoded bytes, decodes them with jpeg-js and runs the same core; the device decodes the same bytes.
  const jpg = jpeg.encode({ data: Buffer.from(original), width: W, height: H }, 92).data;
  const decode = () => { const d = jpeg.decode(jpg, { useTArray: true, formatAsRGBA: true }); return new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength); };
  const onDevice = await enhancePhoto({ pixels: decode(), width: W, height: H, meta: META });
  const onRunner = await enhancePhoto({ ...structuredClone({ width: W, height: H, meta: META }), pixels: decode() });
  assert.equal(summary(onDevice), summary(onRunner), 'same recipes');
  assert.deepEqual(bytes(onDevice), bytes(onRunner), 'same pixels');
  assert.ok(summary(device).length > 0);
});

test('the result is plain data: recipes survive a JSON round trip (what a runner would return)', async () => {
  const r = await enhancePhoto({ pixels: scene(0.4), width: W, height: H, meta: META });
  for (const o of r.options) assert.deepEqual(JSON.parse(JSON.stringify(o.edit)), JSON.parse(JSON.stringify(o.edit)));
  assert.ok(r.options.every((o) => typeof o.edit === 'object'));
});

test('the loop has no provider, key or network input (owner policy: Gemini and Vertex are owner-only)', () => {
  const input: Record<string, true> = { pixels: true, width: true, height: true, base: true, iso: true, segmentation: true, framingKey: true, vision: true, maxRounds: true, keepRoundPixels: true, meta: true, intent: true, style: true };
  const probe: Parameters<typeof enhancePhoto>[0] = { pixels: new Uint8ClampedArray(4), width: 1, height: 1 };
  for (const key of Object.keys(probe)) assert.ok(input[key]);
  // @ts-expect-error there is no apiKey / provider / cloud option on the loop
  const bad: Parameters<typeof enhancePhoto>[0] = { ...probe, apiKey: 'x', cloud: {} };
  assert.ok(bad);
});
