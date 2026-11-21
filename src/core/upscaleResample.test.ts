import test from 'node:test';
import assert from 'node:assert/strict';
import { resampleLanczos3, axisWeights, type PixelBuffer } from './upscaleResample';
import { planTiles, upscaleTiled, type TileModel } from './upscaleTiles';
import { psnr, ssim } from './imageMetrics';

const synth = (w: number, h: number, wide = false): PixelBuffer<Uint8ClampedArray> => {
  const data = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 128 + 70 * Math.sin(x / 5) * Math.cos(y / 7) + ((Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? 40 : -40);
    for (let c = 0; c < 3; c++) data[(y * w + x) * 3 + c] = v + c * 5;
  }
  void wide;
  return { data, width: w, height: h, channels: 3 };
};
const bilinear = (s: PixelBuffer<Uint8ClampedArray>, W: number, H: number): PixelBuffer<Uint8ClampedArray> => {
  const out = new Uint8ClampedArray(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = Math.min(s.width - 1, Math.max(0, (x + 0.5) * s.width / W - 0.5)), fy = Math.min(s.height - 1, Math.max(0, (y + 0.5) * s.height / H - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(s.width - 1, x0 + 1), y1 = Math.min(s.height - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    for (let c = 0; c < 3; c++) {
      const p = (xx: number, yy: number) => s.data[(yy * s.width + xx) * 3 + c];
      out[(y * W + x) * 3 + c] = (p(x0, y0) * (1 - tx) + p(x1, y0) * tx) * (1 - ty) + (p(x0, y1) * (1 - tx) + p(x1, y1) * tx) * ty;
    }
  }
  return { data: out, width: W, height: H, channels: 3 };
};

test('weights sum to one', () => {
  const a = axisWeights(10, 40);
  for (let o = 0; o < 40; o++) { let t = 0; for (let k = 0; k < a.count[o]; k++) t += a.weights[o * a.stride + k]; assert.ok(Math.abs(t - 1) < 1e-5); }
});

test('flat 16-bit image stays flat and keeps 16-bit values; input untouched', () => {
  const data = new Uint16Array(6 * 5 * 3).fill(43210);
  const copy = data.slice();
  const out = resampleLanczos3({ data, width: 6, height: 5, channels: 3 }, 24, 20, { sharpen: 0.3 });
  assert.ok(out.data instanceof Uint16Array);
  assert.ok(out.data.every((v) => v === 43210));
  assert.deepEqual(data, copy);
});

test('tiny scratch budget gives the same pixels as a large one', () => {
  const s = synth(40, 30);
  const a = resampleLanczos3(s, 160, 120, { sharpen: 0.2 });
  const b = resampleLanczos3(s, 160, 120, { sharpen: 0.2, scratchSamples: 1 });
  assert.deepEqual(a.data, b.data);
});

test('cancel and bad sizes throw', () => {
  const s = synth(8, 8);
  const c = new AbortController(); c.abort();
  assert.throws(() => resampleLanczos3(s, 16, 16, { signal: c.signal }));
  assert.throws(() => resampleLanczos3(s, 0, 16));
  assert.throws(() => resampleLanczos3({ ...s, width: 9 }, 16, 16));
});

test('Lanczos beats bilinear on a synthetic 2x round trip (measured)', () => {
  const truth = synth(128, 128);
  const small = resampleLanczos3(truth, 64, 64);
  const lan = resampleLanczos3(small, 128, 128, { sharpen: 0.2 });
  const bil = bilinear(small, 128, 128);
  const r = { lanPsnr: psnr(truth, lan), bilPsnr: psnr(truth, bil), lanSsim: ssim(truth, lan), bilSsim: ssim(truth, bil) };
  console.log('upscale 2x synthetic', JSON.stringify(r));
  assert.ok(r.lanPsnr > r.bilPsnr && r.lanSsim > r.bilSsim);
});

test('tile plan covers the image and overlaps', () => {
  const p = planTiles(300, 200, 2, 128, 16);
  assert.equal(p.tiles.at(-1)!.x + 128, 300);
  assert.equal(p.tiles.at(-1)!.y + 128, 200);
});

test('feathered tiles match a whole-image result closely and report progress', async () => {
  const s = synth(70, 50);
  const model: TileModel = async (t) => resampleLanczos3(t, t.width * 2, t.height * 2);
  const seen: number[] = [];
  const out = await upscaleTiled(s, 2, model, { tile: 32, overlap: 8, onProgress: (f) => seen.push(f) });
  const whole = resampleLanczos3(s, 140, 100);
  assert.equal(out.width, 140);
  assert.ok(psnr(whole, out) > 35, `psnr ${psnr(whole, out)}`);
  assert.equal(seen.at(-1), 1);
});

test('wrong tile size and cancel reject', async () => {
  const s = synth(40, 40);
  await assert.rejects(upscaleTiled(s, 2, async (t) => t, { tile: 32, overlap: 8 }));
  const c = new AbortController();
  await assert.rejects(upscaleTiled(s, 2, async (t) => { c.abort(); return resampleLanczos3(t, t.width * 2, t.height * 2); }, { tile: 32, overlap: 8, signal: c.signal }));
});
