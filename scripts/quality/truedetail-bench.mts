/**
 * TrueDetail benchmark (board item p3-maskdenoise): the conventional denoise against NAFNet, judged by TrueDetail's own
 * regional guardian, on open-licence high-ISO RAW files. Everything here is the app's own code: the RAW develop
 * (`kestrel_raw.wasm`), the noise measurement, the conventional recipe renderer, the NAFNet tile runner and output
 * check, the learned blend and the guardian (`chooseRegions` / `scoreRegion`). Nothing is uploaded; originals are only read.
 *
 *   npx tsx scripts/quality/truedetail-bench.mts <samples.json> <raw folder> <nafnet .onnx> <out folder>
 *
 * samples.json: [{ "id", "iso", "ext", "sha", "licence" }], files named <id>.<ext> in the raw folder (see
 * docs/QUALITY-BENCHMARKS.md for the CC0 set used on 26 Nov 2026). Per frame it takes two 768 px crops at 100%: the most
 * detailed area (judged as a subject) and the flattest mid-tone area (judged as background), and writes, per crop:
 * the original, "plain" (the one-model denoise the app applies without TrueDetail), NAFNet at 100% and 60%, and
 * TrueDetail's pick. It also records the pick the guardian makes at the 1600 px working size, which is where the app
 * judges today. A synthetic control (a 4x-downscaled crop plus measured-level noise) gives PSNR against a clean reference.
 *
 * The measurements describe pixels, not truth: there is no clean reference for the real frames, so "detail kept" is
 * measured against the noisy original, as the guardian does. Use `blind_compare.py` on the written shoot.json for
 * human judgement.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zlibSync } from 'fflate';
import { instantiateRawWasm } from '../../src/providers/wasiShim';
import { parseRgb16 } from '../../src/core/master16';
import { estimateNoiseSigma, luminanceStrengthFor } from '../../src/core/noiseEstimate';
import { DEFAULT_EDIT } from '../../src/core/photoEdits';
import { renderDenoiseRecipe } from '../../src/v2/engineClient/denoiseRecipe';
import { runTrueDetailTiles } from '../../src/core/trueDetailTiles';
import { NAFNET_TILE, nafnetOutput } from '../../src/core/nafnet';
import { NAFNET_W32 } from '../../src/core/optionalModels';
import { blendLearned } from '../../src/core/trueDetailAi';
import { chooseRegions, judgeRegion, qualifyLearned, scoreRegion, TRUEDETAIL_REGIONS, type DenoiseRegion, type RegionChoice, type RegionScore } from '../../src/core/trueDetailHybrid';
import type { Pixels } from '../../src/core/colourCheck';

/** Same constants as `runDenoise.ts` (not imported: that module needs a browser). */
const DEFAULT_DENOISE_STRENGTH = 0.8;
const DENOISE_WORKING_EDGE = 1600;
const CROP = 768;
/** The blend strengths the app offers the guardian for NAFNet (`runDenoise.ts`). */
const LEARNED_STRENGTHS = [1, 0.6];

const [samplesPath, rawDir, modelPath, outDir] = process.argv.slice(2);
if (!samplesPath || !rawDir || !modelPath || !outDir) {
  console.error('Usage: npx tsx scripts/quality/truedetail-bench.mts <samples.json> <raw folder> <nafnet .onnx> <out folder>');
  process.exit(2);
}

// ---------- small pixel helpers ----------
function to8(rgb16: Uint16Array, width: number, height: number, x0 = 0, y0 = 0, w = width, h = height): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((y0 + y) * width + (x0 + x)) * 3, d = (y * w + x) * 4;
    data[d] = Math.round(rgb16[s] / 257); data[d + 1] = Math.round(rgb16[s + 1] / 257); data[d + 2] = Math.round(rgb16[s + 2] / 257); data[d + 3] = 255;
  }
  return { data, width: w, height: h };
}
function rgb16Of(p: Pixels): Uint16Array {
  const out = new Uint16Array(p.width * p.height * 3);
  for (let i = 0; i < p.width * p.height; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = p.data[i * 4 + c] * 257;
  return out;
}
function from16(rgb16: Uint16Array, w: number, h: number): Pixels { return to8(rgb16, w, h); }
const lumaOf = (d: Uint8ClampedArray, i: number) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

/** Area-average resample (what a browser canvas does when drawing smaller with high quality smoothing, near enough). */
function resample(src: Pixels, w: number, h: number): Pixels {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = src.width / w, sy = src.height / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = x * sx, x1 = (x + 1) * sx, y0 = y * sy, y1 = (y + 1) * sy;
    const acc = [0, 0, 0]; let wsum = 0;
    for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
      const wx = Math.min(xx + 1, x1) - Math.max(xx, x0), wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
      const wgt = wx * wy; if (wgt <= 0) continue;
      const i = (Math.min(src.height - 1, yy) * src.width + Math.min(src.width - 1, xx)) * 4;
      acc[0] += src.data[i] * wgt; acc[1] += src.data[i + 1] * wgt; acc[2] += src.data[i + 2] * wgt; wsum += wgt;
    }
    const o = (y * w + x) * 4;
    out[o] = acc[0] / wsum; out[o + 1] = acc[1] / wsum; out[o + 2] = acc[2] / wsum; out[o + 3] = 255;
  }
  return { data: out, width: w, height: h };
}
function blendWhole(base: Pixels, learned: Pixels, strength: number): Pixels {
  const data = new Uint8ClampedArray(base.data);
  blendLearned(data, learned.data, new Float32Array(base.width * base.height).fill(strength));
  return { data, width: base.width, height: base.height };
}
function psnr(a: Pixels, b: Pixels): number {
  let se = 0; const n = a.width * a.height;
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { const d = a.data[i * 4 + c] - b.data[i * 4 + c]; se += d * d; }
  const mse = se / (n * 3);
  return mse === 0 ? 99 : 10 * Math.log10(255 * 255 / mse);
}

// ---------- PNG writer (8-bit RGB) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf: Uint8Array): number { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length); const v = new DataView(out.buffer);
  v.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out;
}
function writePng(path: string, p: Pixels): void {
  const raw = new Uint8Array((p.width * 3 + 1) * p.height);
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    const s = (y * p.width + x) * 4, d = y * (p.width * 3 + 1) + 1 + x * 3;
    raw[d] = p.data[s]; raw[d + 1] = p.data[s + 1]; raw[d + 2] = p.data[s + 2];
  }
  const ihdr = new Uint8Array(13); const v = new DataView(ihdr.buffer);
  v.setUint32(0, p.width); v.setUint32(4, p.height); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())];
  const file = new Uint8Array(parts.reduce((a, b) => a + b.length, 0)); let o = 0;
  for (const part of parts) { file.set(part, o); o += part.length; }
  writeFileSync(path, file);
}

// ---------- crop choice ----------
/** The most detailed and the flattest mid-tone 768 px areas, on a 64 px grid, avoiding clipped areas. Deterministic. */
function pickCrops(rgb16: Uint16Array, width: number, height: number) {
  const step = 64, size = Math.min(CROP, width, height);
  let detail = { x: 0, y: 0, score: -1 }, flat = { x: 0, y: 0, score: Infinity };
  for (let y = 0; y + size <= height; y += step) for (let x = 0; x + size <= width; x += step) {
    let grad = 0, mean = 0, clipped = 0, n = 0;
    for (let yy = y; yy < y + size - 2; yy += 4) for (let xx = x; xx < x + size - 2; xx += 4) {
      const i = (yy * width + xx) * 3;
      const l = (rgb16[i] * 0.2126 + rgb16[i + 1] * 0.7152 + rgb16[i + 2] * 0.0722) / 257;
      const r = ((yy * width + xx + 2) * 3), b = (((yy + 2) * width + xx) * 3);
      const lr = (rgb16[r] * 0.2126 + rgb16[r + 1] * 0.7152 + rgb16[r + 2] * 0.0722) / 257;
      const lb = (rgb16[b] * 0.2126 + rgb16[b + 1] * 0.7152 + rgb16[b + 2] * 0.0722) / 257;
      grad += Math.abs(l - lr) + Math.abs(l - lb); mean += l; if (l < 6 || l > 249) clipped++; n++;
    }
    grad /= n; mean /= n;
    if (clipped / n > 0.05) continue;
    if (grad > detail.score) detail = { x, y, score: grad };
    if (mean > 40 && mean < 200 && grad < flat.score) flat = { x, y, score: grad };
  }
  return { size, detail, flat };
}

// ---------- NAFNet ----------
const modelBytes = readFileSync(modelPath);
const modelSha = createHash('sha256').update(modelBytes).digest('hex');
if (modelSha !== NAFNET_W32.files.model.sha256) throw new Error(`The model is not the pinned NAFNet file (${modelSha}).`);
const ort = await import('onnxruntime-web/wasm');
ort.env.wasm.numThreads = 1;
const session = await ort.InferenceSession.create(new Uint8Array(modelBytes), { executionProviders: ['wasm'] });
let tiles = 0, tileMs = 0;
async function infer(input: Float32Array): Promise<Float32Array> {
  const t0 = performance.now();
  const outputs = await session.run({ input: new ort.Tensor('float32', input, [1, 3, NAFNET_TILE, NAFNET_TILE]) });
  tiles++; tileMs += performance.now() - t0;
  return nafnetOutput(outputs.output.data as Float32Array);
}
async function nafnet(p: Pixels): Promise<Pixels> {
  return from16(await runTrueDetailTiles(rgb16Of(p), p.width, p.height, infer, { strength: 1 }), p.width, p.height);
}

// ---------- one crop through every candidate ----------
interface Row { frame: string; iso: number; region: DenoiseRegion; kind: 'real' | 'synthetic'; scale: number;
  variants: Record<string, RegionScore & { verdict: string | null; psnr?: number }>;
  pick100: string; pickWorking: string; pickWorkingAppRules: string;
  /** What the app does now: NAFNet offered at working size only at the strengths that pass at full size. */
  pickApp: string; qualified: number[]; notes: string[] }

const label = (c: RegionChoice | undefined) => !c ? 'none' : c.strength === 0 ? 'original kept' : `${c.source === 'conventional' ? 'conventional' : 'NAFNet'} ${c.strength}`;

async function judge(original: Pixels, region: DenoiseRegion, lumaPerStrength: number, learned: Pixels | null, offerLearned: boolean, strengths: readonly number[] = LEARNED_STRENGTHS): Promise<RegionChoice | undefined> {
  const weight = new Float32Array(original.width * original.height).fill(1);
  const render = async (strength: number) => renderDenoiseRecipe(original, { ...DEFAULT_EDIT, denoise: strength, ...(strength * lumaPerStrength > 0 ? { denoiseLuminance: Math.min(2, strength * lumaPerStrength) } : {}) });
  const candidates = learned && offerLearned ? strengths.map(strength => ({ source: NAFNET_W32.id, strength, regions: [region], render: async () => blendWhole(original, learned, strength) })) : [];
  return (await chooseRegions(original, [{ region, weight }], DEFAULT_DENOISE_STRENGTH, render, TRUEDETAIL_REGIONS, candidates))[0];
}

async function benchCrop(frame: string, iso: number, kind: Row['kind'], region: DenoiseRegion, original: Pixels, lumaPerStrength: number, workingScale: number, reference: Pixels | null, dir: string): Promise<Row> {
  const weight = new Float32Array(original.width * original.height).fill(1);
  const plain = renderDenoiseRecipe(original, { ...DEFAULT_EDIT, denoise: DEFAULT_DENOISE_STRENGTH, ...(DEFAULT_DENOISE_STRENGTH * lumaPerStrength > 0 ? { denoiseLuminance: Math.min(2, DEFAULT_DENOISE_STRENGTH * lumaPerStrength) } : {}) });
  const naf = await nafnet(original);
  const naf60 = blendWhole(original, naf, 0.6);
  // At 100%: NAFNet offered to this region (the app offers it to subjects and eyes only; shown for background too).
  const choice100 = await judge(original, region, lumaPerStrength, naf, true);
  const td100 = !choice100 || choice100.strength === 0 ? original
    : choice100.source === 'conventional' ? renderDenoiseRecipe(original, { ...DEFAULT_EDIT, denoise: choice100.strength, ...(choice100.strength * lumaPerStrength > 0 ? { denoiseLuminance: Math.min(2, choice100.strength * lumaPerStrength) } : {}) })
    : blendWhole(original, naf, choice100.strength);
  // Where the app judges today: the same area at the 1600 px working size, NAFNet's result drawn down into it.
  const ws = Math.max(1, Math.round(original.width * workingScale)), hs = Math.max(1, Math.round(original.height * workingScale));
  const workOriginal = workingScale < 1 ? resample(original, ws, hs) : original;
  const workNaf = workingScale < 1 ? resample(naf, ws, hs) : naf;
  const choiceWorking = await judge(workOriginal, region, lumaPerStrength, workNaf, true);
  const choiceApp = await judge(workOriginal, region, lumaPerStrength, workNaf, region !== 'background');
  const qualified = qualifyLearned(original, naf, weight, LEARNED_STRENGTHS).filter(v => v.reason === null).map(v => v.strength);
  const choiceNow = await judge(workOriginal, region, lumaPerStrength, workNaf, region !== 'background' && qualified.length > 0, qualified);
  const variants: Row['variants'] = {};
  const images: Record<string, Pixels> = { original, plain, nafnet: naf, 'nafnet-60': naf60, truedetail: td100 };
  for (const [name, img] of Object.entries(images)) {
    const score = scoreRegion(original, img, weight);
    variants[name] = { ...score, verdict: name === 'original' ? null : judgeRegion(score, TRUEDETAIL_REGIONS[region]), ...(reference ? { psnr: Math.round(psnr(img, reference) * 100) / 100 } : {}) };
    writePng(join(dir, `${region}-${name}.png`), img);
  }
  if (reference) writePng(join(dir, `${region}-reference.png`), reference);
  return { frame, iso, region, kind, scale: workingScale, variants, pick100: label(choice100), pickWorking: label(choiceWorking), pickWorkingAppRules: label(choiceApp), pickApp: label(choiceNow), qualified, notes: [] };
}

// ---------- main ----------
const samples = JSON.parse(readFileSync(samplesPath, 'utf8')) as Array<{ id: string; iso: number; ext: string; sha: string; licence: string }>;
const wasm = await instantiateRawWasm(new WebAssembly.Module(readFileSync(join(import.meta.dirname, '../../src/assets/wasm/kestrel_raw.wasm'))));
mkdirSync(outDir, { recursive: true });
const rows: Row[] = [];
const shoot: { frames: unknown[] } = { frames: [] };
const failures: string[] = [];
let seed = 12345;
const gauss = () => { // Box-Muller from a fixed LCG, so the synthetic control is reproducible.
  seed = (seed * 1103515245 + 12345) & 0x7fffffff; const u = (seed + 1) / 0x80000000;
  seed = (seed * 1103515245 + 12345) & 0x7fffffff; const v = (seed + 1) / 0x80000000;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
for (const sample of samples) {
  const file = join(rawDir, `${sample.id}.${sample.ext}`);
  const bytes = readFileSync(file);
  if (createHash('sha256').update(bytes).digest('hex') !== sample.sha) { failures.push(`${sample.id}: checksum mismatch, skipped`); continue; }
  let picture;
  const t0 = performance.now();
  try { picture = parseRgb16(wasm.develop16(new Uint8Array(bytes)).slice().buffer); }
  catch (error) { failures.push(`${sample.id}: Kestrel's RAW develop failed (${error instanceof Error ? error.message : error})`); continue; }
  const developMs = Math.round(performance.now() - t0);
  const { width, height, data: rgb16 } = picture;
  // Noise as the app measures it: a 1:1 centre crop of up to 1024 px.
  const c = Math.min(1024, width, height);
  const centre = to8(rgb16, width, height, Math.floor((width - c) / 2), Math.floor((height - c) / 2), c, c);
  const sigma = estimateNoiseSigma(centre.data, c, c);
  const luminance = luminanceStrengthFor(sigma);
  const lumaPerStrength = luminance / DEFAULT_DENOISE_STRENGTH;
  const workingScale = Math.min(1, DENOISE_WORKING_EDGE / Math.max(width, height));
  const { size, detail, flat } = pickCrops(rgb16, width, height);
  const dir = join(outDir, sample.id); mkdirSync(dir, { recursive: true });
  console.error(`${sample.id}: ${width}x${height}, developed in ${developMs} ms, sigma ${sigma?.toFixed(2)}, luminance ${luminance}`);
  for (const [region, at] of [['subject', detail], ['background', flat]] as const) {
    const crop = to8(rgb16, width, height, at.x, at.y, size, size);
    const row = await benchCrop(sample.id, sample.iso, 'real', region, crop, lumaPerStrength, workingScale, null, dir);
    rows.push(row);
    shoot.frames.push({ id: `${sample.id}-${region}`, outputs: { Original: `${sample.id}/${region}-original.png`, 'InFlight plain': `${sample.id}/${region}-plain.png`, 'NAFNet only': `${sample.id}/${region}-nafnet.png`, 'InFlight TrueDetail': `${sample.id}/${region}-truedetail.png` }, regions: { [region]: [0, 0, size, size] } });
  }
  // Synthetic control: a 4x area-average of a larger detailed area is far cleaner; add noise at the measured level.
  const big = Math.min(size * 4, width, height);
  const bx = Math.max(0, Math.min(width - big, detail.x + size / 2 - big / 2)), by = Math.max(0, Math.min(height - big, detail.y + size / 2 - big / 2));
  const reference = resample(to8(rgb16, width, height, bx, by, big, big), Math.round(big / 4), Math.round(big / 4));
  const noisy = { data: new Uint8ClampedArray(reference.data), width: reference.width, height: reference.height };
  const s = Math.max(1, sigma ?? 2);
  for (let i = 0; i < noisy.data.length; i += 4) for (let ch = 0; ch < 3; ch++) noisy.data[i + ch] = reference.data[i + ch] + gauss() * s;
  const synthDir = join(dir, 'synthetic'); mkdirSync(synthDir, { recursive: true });
  const synthSigma = estimateNoiseSigma(noisy.data, noisy.width, noisy.height);
  rows.push(await benchCrop(sample.id, sample.iso, 'synthetic', 'subject', noisy, luminanceStrengthFor(synthSigma) / DEFAULT_DENOISE_STRENGTH, 1, reference, synthDir));
}
const summary = { date: new Date().toISOString(), model: { id: NAFNET_W32.id, sha256: modelSha }, nafnetTiles: tiles, msPerTile: tiles ? Math.round(tileMs / tiles) : null, rows, failures };
writeFileSync(join(outDir, 'results.json'), JSON.stringify(summary, null, 1));
writeFileSync(join(outDir, 'shoot.json'), JSON.stringify(shoot, null, 1));
console.log(JSON.stringify({ rows: rows.length, failures, msPerTile: summary.msPerTile }));
