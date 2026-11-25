import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFinishing, applyFinishingRgb16, grainNoise, hasFinishing, validVignette } from './finishing';
import { calibrationMatrix, isNeutralCalibration, validCalibration } from './calibration';
import { applyDehaze, validDehaze } from './dehaze';
import { applyPhotoEdit, isNeutralEdit, isNeutralTone } from './photoEdits';
import { editRgb16, master16Blocker } from './master16';

const flat = (width: number, height: number, value: number) => { const p = new Uint8ClampedArray(width * height * 4).fill(value); for (let i = 3; i < p.length; i += 4) p[i] = 255; return p; };
const full = (w: number, h: number) => ({ aspect: h / w, view: { x: 0, y: 0, w: 1, h: 1 } });

test('vignette darkens corners, leaves the centre, can tint towards a colour and blur only the edges', () => {
  const w = 40, h = 30;
  const pixels = flat(w, h, 150);
  applyFinishing(pixels, w, h, { vignette: { amount: -1, size: 0.5 } }, full(w, h));
  assert.equal(pixels[((h / 2) * w + w / 2) * 4], 150);
  assert.ok(pixels[0] < 90, `corner ${pixels[0]}`);
  const tinted = flat(w, h, 150);
  applyFinishing(tinted, w, h, { vignette: { amount: 1, size: 0.5, colour: [1, 0, 0] } }, full(w, h));
  assert.ok(tinted[0] > 200 && tinted[1] < 60, `corner ${tinted.slice(0, 3)}`);
  // A checkerboard keeps its contrast in the middle and loses it at the corners when blurred.
  const board = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) { const v = ((i % w) + Math.floor(i / w)) % 2 ? 255 : 0; board.fill(v, i * 4, i * 4 + 3); board[i * 4 + 3] = 255; }
  applyFinishing(board, w, h, { vignette: { amount: 0, size: 0.5, blur: 1 } }, full(w, h), 400);
  const centre = ((h / 2) * w + w / 2) * 4;
  assert.ok(Math.abs(board[centre] - board[centre + 4]) > 200, 'centre stays sharp');
  assert.ok(Math.abs(board[0] - board[4]) < 60, 'corner is soft');
  assert.ok(hasFinishing({ vignette: { amount: 0, size: 0.5, blur: 0.2 } }));
  assert.ok(!validVignette({ amount: 0, size: 0.5, colour: [2, 0, 0] }));
});

test('a zoomed strip of the photo gets the same vignette as the whole picture at that place', () => {
  const w = 80, h = 60;
  const whole = flat(w, h, 150);
  applyFinishing(whole, w, h, { vignette: { amount: -1, size: 0.5 } }, full(w, h));
  const strip = flat(w / 2, h / 2, 150);
  applyFinishing(strip, w / 2, h / 2, { vignette: { amount: -1, size: 0.5 } }, { aspect: h / w, view: { x: 0, y: 0, w: 0.5, h: 0.5 } }, w);
  assert.ok(Math.abs(strip[0] - whole[0]) <= 1);
});

test('grain is deterministic, anchored to the photo and neutral in colour', () => {
  assert.equal(grainNoise(12.3, 45.6), grainNoise(12.3, 45.6));
  const a = flat(30, 20, 128), b = flat(30, 20, 128);
  applyFinishing(a, 30, 20, { grain: { amount: 1, size: 1 } }, full(30, 20), 2000);
  applyFinishing(b, 30, 20, { grain: { amount: 1, size: 1 } }, full(30, 20), 2000);
  assert.deepEqual(a, b);
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) { if (a[i] !== 128) changed += 1; assert.equal(a[i], a[i + 2]); }
  assert.ok(changed > 100);
});

test('calibration keeps greys grey and turns red towards yellow', () => {
  const m = calibrationMatrix({ red: [1, 0], green: [0, 0], blue: [0, 0] });
  for (let r = 0; r < 3; r += 1) assert.ok(Math.abs(m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2] - 1) < 1e-5);
  const red = new Uint8ClampedArray([200, 30, 30, 255]);
  applyPhotoEdit(red, { exposure: 0, warmth: 0, colour: 0, calibration: { red: [1, 0], green: [0, 0], blue: [0, 0] } });
  assert.ok(red[1] > 60, `${red}`);
  const grey = new Uint8ClampedArray([120, 120, 120, 255]);
  applyPhotoEdit(grey, { exposure: 0, warmth: 0, colour: 0, calibration: { red: [1, 1], green: [-1, 0.5], blue: [0.4, -1] } });
  assert.ok(Math.abs(grey[0] - grey[1]) <= 1 && Math.abs(grey[1] - grey[2]) <= 1, `${grey}`);
  assert.ok(isNeutralCalibration({ red: [0, 0], green: [0, 0], blue: [0, 0] }));
  assert.ok(!validCalibration({ red: [2, 0], green: [0, 0], blue: [0, 0] }));
  assert.ok(!isNeutralTone({ exposure: 0, warmth: 0, colour: 0, calibration: { red: [0.2, 0], green: [0, 0], blue: [0, 0] } }));
});

test('dehaze deepens a hazy area and adding haze lifts it towards the haze colour', () => {
  const w = 40, h = 20;
  const make = () => { const p = flat(w, h, 0); for (let i = 0; i < w * h; i += 1) { const sky = i % w < 20; p.set(sky ? [235, 238, 240] : [150, 160, 170], i * 4); } return p; };
  const hazy = make();
  applyDehaze(hazy, w, h, 4, 255, 1);
  assert.ok(hazy[(10 * w + 30) * 4] < 140, `${hazy[(10 * w + 30) * 4]}`);
  const misty = make();
  applyDehaze(misty, w, h, 4, 255, -1);
  assert.ok(misty[(10 * w + 30) * 4] > 160);
  assert.ok(!validDehaze(2));
  assert.ok(!isNeutralEdit({ exposure: 0, warmth: 0, colour: 0, dehaze: 0.3 }));
});

test('the 16-bit TIFF includes dehaze, calibration, vignette and grain and refuses bad values', () => {
  const edit = { exposure: 0, warmth: 0, colour: 0, dehaze: 0.4, vignette: { amount: -0.8, size: 0.5, blur: 0.3 }, grain: { amount: 0.3, size: 0.2 }, calibration: { red: [0.2, 0] as [number, number], green: [0, 0] as [number, number], blue: [0, 0] as [number, number] } };
  assert.equal(master16Blocker(edit, undefined), null);
  assert.match(master16Blocker({ ...edit, dehaze: 3 }, undefined) ?? '', /dehaze/);
  assert.match(master16Blocker({ ...edit, vignette: { amount: 5, size: 0 } }, undefined) ?? '', /vignette/);
  assert.match(master16Blocker({ ...edit, grain: { amount: -1, size: 0 } }, undefined) ?? '', /grain/);
  const w = 20, h = 10;
  const image = { width: w, height: h, data: new Uint16Array(w * h * 3).fill(40000) };
  editRgb16(image as never, edit);
  assert.ok(image.data[0] < image.data[((h / 2) * w + w / 2) * 3] - 3000, 'corner darker than centre');
  const vignetteOnly = new Uint16Array(w * h * 3).fill(40000);
  applyFinishingRgb16(vignetteOnly, w, h, { vignette: { amount: -1, size: 0.5 } });
  assert.ok(vignetteOnly[0] < 30000);
});

test('dehaze at preview size matches dehaze at full size (the haze colour does not depend on resolution)', () => {
  const W = 400, H = 300, k = 4;
  const big = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 4;
    const haze = y / H; // hazier towards the bottom, as with distance
    const ridge = ((x >> 3) + (y >> 3)) % 2 ? 60 : 110;
    big.set([ridge + (225 - ridge) * haze * 0.8, ridge * 0.9 + (228 - ridge * 0.9) * haze * 0.8, ridge * 0.7 + (232 - ridge * 0.7) * haze * 0.8, 255], i);
  }
  const shrink = (src: Uint8ClampedArray) => {
    const out = new Uint8ClampedArray((W / k) * (H / k) * 4);
    for (let y = 0; y < H / k; y += 1) for (let x = 0; x < W / k; x += 1) for (let c = 0; c < 4; c += 1) {
      let sum = 0;
      for (let dy = 0; dy < k; dy += 1) for (let dx = 0; dx < k; dx += 1) sum += src[((y * k + dy) * W + x * k + dx) * 4 + c];
      out[(y * (W / k) + x) * 4 + c] = Math.round(sum / (k * k));
    }
    return out;
  };
  const small = shrink(big);
  applyDehaze(big, W, H, 4, 255, 0.8);
  applyDehaze(small, W / k, H / k, 4, 255, 0.8);
  const fromBig = shrink(big);
  let diff = 0;
  for (let i = 0; i < small.length; i += 4) diff += Math.abs(small[i] - fromBig[i]) + Math.abs(small[i + 2] - fromBig[i + 2]);
  const mean = diff / (small.length / 2);
  assert.ok(mean < 4, `mean difference ${mean.toFixed(2)} of 255`);
});

test('vignette roundness, feather and highlight protection; the defaults are the original vignette exactly', () => {
  const w = 60, h = 30;
  const at = (p: Uint8ClampedArray, x: number, y: number) => p[(y * w + x) * 4];
  const run = (extra: Record<string, number>, value = 150) => {
    const p = flat(w, h, value);
    applyFinishing(p, w, h, { vignette: { amount: -1, size: 0.5, ...extra } }, full(w, h));
    return p;
  };
  assert.deepEqual(run({ roundness: 0, feather: 0.5, highlights: 0 }), run({}));
  // Round: the middle of the long edge is further from a circle's centre than an oval's, so it darkens more.
  const edgeMid = (p: Uint8ClampedArray) => at(p, 0, h / 2);
  assert.ok(edgeMid(run({ roundness: 1 })) < edgeMid(run({})) - 5, `${edgeMid(run({ roundness: 1 }))} vs ${edgeMid(run({}))}`);
  // Rectangular: the middle of each edge reaches as dark as a corner.
  const rect = run({ roundness: -1 });
  assert.ok(Math.abs(at(rect, 0, h / 2) - at(rect, 0, 0)) < 12);
  // Feather 0 is a hard step; 1 is softer than the default.
  const hard = run({ feather: 0 }), soft = run({ feather: 1 });
  let jumps = 0;
  for (let x = 1; x < w / 2; x += 1) if (Math.abs(at(hard, x, h / 2) - at(hard, x - 1, h / 2)) > 30) jumps += 1;
  assert.ok(jumps >= 1, 'a hard edge has a step');
  assert.ok(at(soft, 0, 0) > at(run({}), 0, 0), 'a softer fall-off leaves the corner lighter');
  // Highlights protection spares a bright picture but still darkens a mid-grey one.
  const bright = run({ highlights: 1 }, 245);
  assert.ok(at(bright, 0, 0) > 235, `bright corner ${at(bright, 0, 0)}`);
  assert.ok(at(run({ highlights: 1 }, 120), 0, 0) < 80);
  assert.ok(!validVignette({ amount: -1, size: 0.5, roundness: 2 }));
  assert.ok(!validVignette({ amount: -1, size: 0.5, feather: -0.1 }));
});

test('grain roughness makes the grain less even, stays fixed to the photo, and 0 is the original grain', () => {
  const w = 600, h = 400;
  const run = (roughness?: number) => {
    const p = flat(w, h, 128);
    applyFinishing(p, w, h, { grain: { amount: 1, size: 1, ...(roughness === undefined ? {} : { roughness }) } }, full(w, h), w);
    return p;
  };
  assert.deepEqual(run(0), run());
  const smooth = run(0), rough = run(1);
  assert.notDeepEqual(smooth, rough);
  assert.deepEqual(rough, run(1), 'deterministic');
  // Rougher grain has more pixel-to-pixel change.
  const busy = (p: Uint8ClampedArray) => { let s = 0; for (let i = 4; i < p.length; i += 4) s += Math.abs(p[i] - p[i - 4]); return s; };
  assert.ok(busy(rough) > busy(smooth) * 1.1, `${busy(rough)} vs ${busy(smooth)}`);
  assert.equal(hasFinishing({ grain: { amount: 0.2, size: 0.3, roughness: 0.5 } }), true);
});
