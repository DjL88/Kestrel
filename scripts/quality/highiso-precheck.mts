// High-ISO noise pre-check (finish-line job x-uat-highiso). See docs/QUALITY-BENCHMARKS.md section 5.
//
//   npx tsx scripts/quality/highiso-precheck.mts <frames.json> <out folder> [--synthetic-iso 6400] [--seed 1]
//
// For each frame it runs the app's own denoise code, exactly as the V2 Denoise button does on this device, minus the
// browser: the working copy (longest edge 1600), noise measured on a 1:1 centre crop, `luminanceStrengthFor`,
// TrueDetail's regional guardian through `runDenoiseAction` and `openDenoiseSession`, then the chosen recipe drawn at
// full size with `renderDenoiseRecipe` (the same function the session renders with). It also draws the plain Noise
// recipe: the same requested strength applied to the whole frame, with no regions. Both are written as PNGs with a
// `shoot.json` for `scripts/blind_compare.py` (with the un-denoised input as a third, anchoring choice).
//
// frames.json: { "frames": [ { "id": "owl-1", "file": "owl.jpg",
//                              "subject": { "cx": 0.5, "cy": 0.45, "rx": 0.2, "ry": 0.3 } } ] }
// The subject is a hand-placed ellipse (0 to 1 across the photo, radii as shares of width and height), because the app's
// subject detector runs in the browser only. The eye is found by the app's own `findEye` inside that subject.
//
// --synthetic-iso adds seeded, signal-dependent sensor-like noise to each (clean) frame first, and keeps the clean frame
// as ground truth: report.json then also has the error against the truth per region (PSNR, higher is better).
// Originals are only read. Nothing is uploaded. JPEG and 8-bit PNG input.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { zlibSync, unzlibSync } from 'fflate';
import jpeg from 'jpeg-js';
import type { Pixels } from '../../src/core/colourCheck.ts';
import { estimateNoiseSigma, luminanceStrengthFor } from '../../src/core/noiseEstimate.ts';
import { createSubjectMask, type Mask, type SubjectGrid } from '../../src/core/maskTypes.ts';
import { fullContext, maskAlpha } from '../../src/core/masks.ts';
import { findEye, lumaOf } from '../../src/core/eyeFinder.ts';
import { DEFAULT_EDIT, type PhotoEdit } from '../../src/core/photoEdits.ts';
import { runDenoiseAction } from '../../src/engine/denoiseAction.ts';
import { openDenoiseSession } from '../../src/v2/engineClient/denoiseCompute.ts';
import { composeDenoiseRecipe, renderDenoiseRecipe } from '../../src/v2/engineClient/denoiseRecipe.ts';
import { DEFAULT_DENOISE_STRENGTH, DENOISE_WORKING_EDGE } from '../../src/v2/engineClient/runDenoise.ts';

interface FrameSpec { id: string; file: string; subject: { cx: number; cy: number; rx: number; ry: number }; credit?: string }

const args = process.argv.slice(2);
const option = (name: string) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const [framesPath, outArg] = args.filter((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!framesPath || !outArg) {
  process.stderr.write('Usage: highiso-precheck.mts <frames.json> <out folder> [--synthetic-iso 6400] [--seed 1]\n');
  process.exit(2);
}
const syntheticIso = option('--synthetic-iso') ? Number(option('--synthetic-iso')) : 0;
const seed = Number(option('--seed') ?? 1);
const out = resolve(outArg);
const base = dirname(resolve(framesPath));
const frames: FrameSpec[] = JSON.parse(readFileSync(framesPath, 'utf8')).frames;

// ---------- image input and output ----------
function readPng(bytes: Uint8Array): Pixels {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8, width = 0, height = 0, type = 0, depth = 0;
  const idat: Uint8Array[] = [];
  while (at < bytes.length) {
    const length = view.getUint32(at); const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (name === 'IHDR') { width = view.getUint32(at + 8); height = view.getUint32(at + 12); depth = body[8]; type = body[9]; if (body[12]) throw new Error('Interlaced PNG is not supported'); }
    if (name === 'IDAT') idat.push(body);
    at += 12 + length;
  }
  if (depth !== 8 || (type !== 2 && type !== 6)) throw new Error('Only 8-bit RGB or RGBA PNG is supported');
  const channels = type === 6 ? 4 : 3;
  const joined = new Uint8Array(idat.reduce((n, b) => n + b.length, 0)); let o = 0; for (const b of idat) { joined.set(b, o); o += b.length; }
  const raw = unzlibSync(joined); const stride = width * channels; const prev = new Uint8Array(stride); const row = new Uint8Array(stride);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]; const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0, b = prev[i], c = i >= channels ? prev[i - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      row[i] = (line[i] + pred) & 255;
    }
    for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) data[(y * width + x) * 4 + c] = c < channels ? row[x * channels + c] : 255;
    prev.set(row);
  }
  return { data, width, height };
}

function readImage(path: string): Pixels {
  const bytes = readFileSync(path);
  if (extname(path).toLowerCase() === '.png') return readPng(new Uint8Array(bytes));
  const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048, maxResolutionInMP: 120 });
  return { data: new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength), width: decoded.width, height: decoded.height };
}

const CRC = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (bytes: Uint8Array) => { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(name: string, data: Uint8Array) {
  const outBytes = new Uint8Array(12 + data.length); const view = new DataView(outBytes.buffer);
  view.setUint32(0, data.length); outBytes.set([...name].map(ch => ch.charCodeAt(0)), 4); outBytes.set(data, 8);
  view.setUint32(8 + data.length, crc32(outBytes.subarray(4, 8 + data.length))); return outBytes;
}
/** 8-bit RGB PNG (alpha dropped: every render here is opaque). */
function png(p: Pixels): Uint8Array {
  const raw = new Uint8Array((p.width * 3 + 1) * p.height);
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) for (let c = 0; c < 3; c++) raw[y * (p.width * 3 + 1) + 1 + x * 3 + c] = p.data[(y * p.width + x) * 4 + c];
  const header = new Uint8Array(13); const view = new DataView(header.buffer);
  view.setUint32(0, p.width); view.setUint32(4, p.height); header[8] = 8; header[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array())];
  const all = new Uint8Array(parts.reduce((n, b) => n + b.length, 0)); let o = 0; for (const b of parts) { all.set(b, o); o += b.length; } return all;
}

// ---------- working copy and synthetic noise ----------
/** Area-average reduction to the working edge (canvas drawImage with high-quality smoothing is close to this). */
function workingCopy(src: Pixels, edge: number): Pixels {
  const scale = Math.min(1, edge / Math.max(src.width, src.height));
  if (scale === 1) return { data: new Uint8ClampedArray(src.data), width: src.width, height: src.height };
  const width = Math.round(src.width * scale), height = Math.round(src.height * scale);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y / scale), y1 = Math.max(y0 + 1, Math.floor((y + 1) / scale));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x / scale), x1 = Math.max(x0 + 1, Math.floor((x + 1) / scale));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1 && sy < src.height; sy++) for (let sx = x0; sx < x1 && sx < src.width; sx++) {
        const i = (sy * src.width + sx) * 4; r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; n++;
      }
      const o = (y * width + x) * 4; data[o] = r / n; data[o + 1] = g / n; data[o + 2] = b / n; data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

function rng(s: number) { return () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/**
 * Shot plus read noise in linear light, per channel, softened a little the way demosaicing correlates neighbours.
 * Scaled from ISO 6400 on a full-frame 45 MP sensor by eye, not measured on a Z8: a stand-in for real high-ISO noise.
 */
function addSensorNoise(clean: Pixels, iso: number, s: number): Pixels {
  const random = rng(s); const gauss = () => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
  const k = iso / 6400; const shot = 0.0016 * k, read = 0.00002 * k * k;
  const { width, height } = clean; const n = width * height;
  const field = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const lin = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { lin[c][i] = toLinear(clean.data[i * 4 + c] / 255); field[c][i] = gauss(); }
  const data = new Uint8ClampedArray(clean.data.length);
  for (let c = 0; c < 3; c++) {
    const f = field[c]; const soft = new Float32Array(n);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0, w = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= height || xx >= width) continue;
        const wt = (dx ? 1 : 2) * (dy ? 1 : 2); sum += f[yy * width + xx] * wt; w += wt;
      }
      // Half white, half softened, renormalised to unit variance (the softened part has variance 9/64·... ≈ 0.14).
      soft[y * width + x] = (0.75 * f[y * width + x] + 0.75 * (sum / w) / 0.375) / Math.hypot(0.75, 0.75);
    }
    for (let i = 0; i < n; i++) {
      const v = lin[c][i]; const sigma = Math.sqrt(shot * v + read);
      data[i * 4 + c] = Math.round(255 * toSrgb(Math.min(1, Math.max(0, v + sigma * soft[i]))));
    }
  }
  for (let i = 0; i < n; i++) data[i * 4 + 3] = 255;
  return { data, width, height };
}

// ---------- subject, regions, measurements ----------
function ellipseGrid(spec: FrameSpec['subject'], aspect: number): SubjectGrid {
  const w = 96, h = Math.max(8, Math.min(512, Math.round(96 * aspect)));
  const bytes = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(((x + 0.5) / w - spec.cx) / spec.rx, ((y + 0.5) / h - spec.cy) / spec.ry);
    bytes[y * w + x] = Math.round(255 * Math.min(1, Math.max(0, (1.08 - d) / 0.16)));
  }
  return { w, h, data: Buffer.from(bytes).toString('base64') };
}

function crop(p: Pixels, x: number, y: number, w: number, h: number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) data.set(p.data.subarray(((y + r) * p.width + x) * 4, ((y + r) * p.width + x + w) * 4), r * w * 4);
  return { data, width: w, height: h };
}
function psnr(a: Pixels, b: Pixels): number {
  let se = 0; for (let i = 0; i < a.data.length; i++) { if ((i & 3) === 3) continue; const d = a.data[i] - b.data[i]; se += d * d; }
  const mse = se / (a.width * a.height * 3); return mse === 0 ? 99 : Math.round(10 * Math.log10(255 * 255 / mse) * 100) / 100;
}
/** Flattest 400 px block outside the subject (lowest neighbour-difference energy), for the background crop. */
function backgroundBlock(p: Pixels, alpha: (x: number, y: number) => number, size: number): [number, number] {
  let best: [number, number] = [0, 0], bestScore = Infinity;
  const step = Math.max(16, Math.floor(size / 2));
  for (let y = 0; y + size <= p.height; y += step) for (let x = 0; x + size <= p.width; x += step) {
    let inside = 0, energy = 0, count = 0;
    for (let yy = y; yy < y + size; yy += 8) for (let xx = x; xx < x + size - 1; xx += 8) {
      if (alpha(xx, yy) > 0.05) inside++;
      const i = (yy * p.width + xx) * 4; energy += Math.abs(p.data[i + 1] - p.data[i + 5]); count++;
    }
    if (inside) continue;
    // Prefer mid-tone flat areas: noise is easiest to see there, and pure black or blown white hides it.
    let mean = 0; for (let yy = y; yy < y + size; yy += 16) for (let xx = x; xx < x + size; xx += 16) mean += p.data[(yy * p.width + xx) * 4 + 1];
    mean /= Math.ceil(size / 16) ** 2;
    const score = energy / count + (mean < 30 || mean > 230 ? 50 : 0);
    if (score < bestScore) { bestScore = score; best = [x, y]; }
  }
  return best;
}

// ---------- run ----------
mkdirSync(join(out, 'truedetail'), { recursive: true });
mkdirSync(join(out, 'plain'), { recursive: true });
mkdirSync(join(out, 'input'), { recursive: true });
if (syntheticIso) mkdirSync(join(out, 'truth'), { recursive: true });
const shoot: { frames: unknown[] } = { frames: [] };
const report: unknown[] = [];

for (const [index, spec] of frames.entries()) {
  const started = Date.now();
  const source = readImage(resolve(base, spec.file));
  const truth = syntheticIso ? source : null;
  const full = syntheticIso ? addSensorNoise(source, syntheticIso, seed * 1000 + index) : source;
  const name = `${spec.id}.png`;
  writeFileSync(join(out, 'input', name), png(full));
  if (truth) writeFileSync(join(out, 'truth', name), png(truth));

  // Exactly the V2 path: a 1:1 centre crop (up to 1024) for the noise level, the working copy for every decision.
  const size = Math.min(1024, full.width, full.height);
  const centre = crop(full, Math.floor((full.width - size) / 2), Math.floor((full.height - size) / 2), size, size);
  const sigma = estimateNoiseSigma(centre.data, size, size);
  const luminance = luminanceStrengthFor(sigma);
  const asked = DEFAULT_DENOISE_STRENGTH;
  const lumaPerStrength = asked > 0 ? luminance / asked : 0;
  const original = workingCopy(full, DENOISE_WORKING_EDGE);
  const id = `auto-denoise-${spec.id}`;
  const framing = 'o|0|0.00|0.5000|0.5000|1.000';
  const mask = createSubjectMask(id, ellipseGrid(spec.subject, original.height / original.width), framing, 'high');
  const alpha = maskAlpha(mask, original.width, original.height, fullContext(original.width, original.height));
  const eye = findEye({ luma: lumaOf(original.data, original.width, original.height), subject: alpha, width: original.width, height: original.height });
  const eyes = eye ? [{ x: eye.x, y: eye.y, radius: eye.radius }] : [];
  const session = openDenoiseSession({ original, baseEdit: undefined, recipeId: id, newLayers: [], lumaPerStrength, subjects: [mask], subjectAlpha: alpha });
  const result = await runDenoiseAction({
    backgroundDenoise: asked, original: session.baseline, luminancePerStrength: lumaPerStrength,
    subject: { maskId: id, grid: mask.grid, framingKey: framing, confidence: 'high', alpha, eyes },
    render: async (edit, masks, blend) => session.render(edit, masks, blend),
    assess: async (edit, masks, blend) => session.assess(edit, masks, blend),
  });
  const strength = result.edit.denoise ?? 0;
  const trueDetailEdit = composeDenoiseRecipe(undefined, id, strength, result.masks, strength > 0 ? Math.round(Math.min(2, strength * lumaPerStrength) * 1e4) / 1e4 / strength : 0);
  const plainEdit: PhotoEdit = { ...DEFAULT_EDIT, denoise: asked, ...(luminance > 0 ? { denoiseLuminance: luminance } : {}) };
  const decided = Date.now();
  const trueDetail = renderDenoiseRecipe(full, trueDetailEdit);
  const plain = renderDenoiseRecipe(full, plainEdit);
  writeFileSync(join(out, 'truedetail', name), png(trueDetail));
  writeFileSync(join(out, 'plain', name), png(plain));

  // Crops in full-size pixels: the found eye (or the subject centre when none was found), a feather patch beside it, and
  // the flattest background block outside the subject.
  const fullAlpha = maskAlpha(mask, full.width, full.height, fullContext(full.width, full.height));
  const at = (x: number, y: number) => fullAlpha[Math.min(full.height - 1, y) * full.width + Math.min(full.width - 1, x)];
  const clampBox = (cx: number, cy: number, s: number): [number, number, number, number] => {
    const w = Math.min(s, full.width), h = Math.min(s, full.height);
    return [Math.max(0, Math.min(full.width - w, Math.round(cx - w / 2))), Math.max(0, Math.min(full.height - h, Math.round(cy - h / 2))), w, h];
  };
  const crops = Math.min(400, Math.floor(Math.min(full.width, full.height) / 3));
  const eyeBox = eye ? clampBox(eye.x * full.width, eye.y * full.height, Math.min(crops, Math.max(160, Math.round(eye.radius * full.width * 8)))) : null;
  const featherBox = clampBox(spec.subject.cx * full.width, (spec.subject.cy + spec.subject.ry * 0.35) * full.height, crops);
  const [bx, by] = backgroundBlock(full, at, crops);
  const regions: Record<string, [number, number, number, number]> = { ...(eyeBox ? { eye: eyeBox } : {}), feather: featherBox, background: [bx, by, crops, crops] };
  shoot.frames.push({ id: spec.id, outputs: { 'InFlight': `truedetail/${name}`, 'InFlight plain': `plain/${name}`, 'No denoise': `input/${name}` }, regions });

  const errors = truth ? Object.fromEntries(Object.entries(regions).map(([region, [x, y, w, h]]) => [region, {
    noisy: psnr(crop(full, x, y, w, h), crop(truth, x, y, w, h)),
    trueDetail: psnr(crop(trueDetail, x, y, w, h), crop(truth, x, y, w, h)),
    plain: psnr(crop(plain, x, y, w, h), crop(truth, x, y, w, h)),
  }])) : undefined;
  const entry = {
    id: spec.id, file: basename(spec.file), size: [full.width, full.height], sigma, luminance, asked,
    eyeFound: eye ? { x: eye.x, y: eye.y, radius: eye.radius, likely: (eye as { likely?: unknown }).likely ?? null } : null,
    trueDetail: { strength, verified: result.verification.ok, attempts: result.attempts, regions: result.regions,
      layers: result.masks.map(m => ({ id: m.id, denoise: m.edit.denoise ?? 0, denoiseLuminance: m.edit.denoiseLuminance ?? 0 })),
      globalDenoise: trueDetailEdit.denoise, globalLuminance: trueDetailEdit.denoiseLuminance ?? 0 },
    plain: { denoise: plainEdit.denoise, denoiseLuminance: plainEdit.denoiseLuminance ?? 0 },
    psnr: errors, ms: { decide: decided - started, render: Date.now() - decided },
  };
  report.push(entry);
  process.stdout.write(`${spec.id}: sigma ${sigma?.toFixed(2)} luma ${luminance} -> TrueDetail ${JSON.stringify(result.regions?.map(r => [r.region, r.source, r.strength, r.kept ?? '']))} verified ${result.verification.ok}${errors ? ' psnr ' + JSON.stringify(errors) : ''}\n`);
}
writeFileSync(join(out, 'shoot.json'), JSON.stringify(shoot, null, 1));
writeFileSync(join(out, 'report.json'), JSON.stringify({ syntheticIso: syntheticIso || null, seed, frames: report }, null, 1));
