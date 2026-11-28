/**
 * Headless replica of the SHIPPED default subject-mask path, so the measuring stick has a real baseline.
 *
 *   npx tsx scripts/maskstick/baseline-shipped.ts --in <preview folder> --keys <keys.txt|heldout.json> --out <mask folder> [--suffix _raw] [--ext jpg]
 *
 * What runs is Kestrel's own code, not a re-implementation: the YOLOX box detector's decoding and merging
 * (`objectDetection.ts`), the detector-guided cut-out (`subjectGuide.ts`, `subjectRegion.ts`), U²-Net-P
 * (`subjectModel.ts` + `src/assets/models/u2netp.onnx`, checked against its SHA-256), the guided-filter detail outline
 * (`guidedFilter.ts`), and the mask evaluator the editor uses (`maskAlpha`, default softness). Models run in
 * onnxruntime-web's WebAssembly backend, the same runtime the app uses.
 *
 * What differs from the app, and so is a known limitation of this baseline:
 *  - Photos are the 1024-px previews, not the 2400-px framed render the app feeds the detector, so very small subjects
 *    are less likely to be found (the whole-photo U²-Net-P path then answers, exactly as in the app).
 *  - Resizing is area-average/bilinear here; the browser's canvas does its own smoothing. Differences are sub-pixel.
 *  - The optional RF-DETR tandem and the optional BiRefNet-lite fine-edge pack are NOT installed on this path, so the
 *    detector is YOLOX alone and the mask is U²-Net-P's (the default every install has). BiRefNet-lite is licence-RED
 *    and is a separate, private yardstick, not the shipped default.
 * Where the app would say "no clear subject" the photo is listed in refusals.json and no mask file is written.
 * Nothing is uploaded; inputs are only read.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import jpeg from 'jpeg-js';
import * as ort from 'onnxruntime-web/wasm';
import { DETECTOR_MODEL, decodeTile, mergeDetections, tilePlan, tileScale, toInput, type Detection } from '../../src/core/objectDetection';
import { SUBJECT_MODEL, assessSubject, detailSizeFor, encodeValues, gridSizeFor, normaliseMap, preprocess, toGrid } from '../../src/core/subjectModel';
import { guideRegion, guidedGridSize, maskAgreesWithDetection } from '../../src/core/subjectGuide';
import { placeInRegion, sampledRegion } from '../../src/core/subjectRegion';
import { guidedFilter, resampleMap } from '../../src/core/guidedFilter';
import { lumaOf } from '../../src/core/eyeFinder';
import { createSubjectMask, type SubjectDetail, type SubjectGrid } from '../../src/core/maskTypes';
import { fullContext, maskAlpha } from '../../src/core/masks';

interface Img { rgba: Uint8ClampedArray; width: number; height: number }

const arg = (name: string, fallback?: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const root = new URL('../../', import.meta.url).pathname;

function load(path: string): Img {
  const d = jpeg.decode(readFileSync(path), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  return { rgba: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength), width: d.width, height: d.height };
}

/** Area average when shrinking, bilinear when enlarging. */
function resize(img: Img, w: number, h: number): Img {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      if (sx > 1 || sy > 1) {
        const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.min(img.width, Math.ceil((x + 1) * sx)));
        const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.min(img.height, Math.ceil((y + 1) * sy)));
        let r = 0, g = 0, b = 0, c = 0;
        for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) {
          const i = (yy * img.width + xx) * 4; r += img.rgba[i]; g += img.rgba[i + 1]; b += img.rgba[i + 2]; c += 1;
        }
        out[o] = r / c; out[o + 1] = g / c; out[o + 2] = b / c;
      } else {
        const fx = Math.min(img.width - 1.001, Math.max(0, (x + 0.5) * sx - 0.5)), fy = Math.min(img.height - 1.001, Math.max(0, (y + 0.5) * sy - 0.5));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        for (let c = 0; c < 3; c += 1) {
          const p = (xx: number, yy: number) => img.rgba[(yy * img.width + xx) * 4 + c];
          out[o + c] = (p(x0, y0) * (1 - tx) + p(x0 + 1, y0) * tx) * (1 - ty) + (p(x0, y0 + 1) * (1 - tx) + p(x0 + 1, y0 + 1) * tx) * ty;
        }
      }
      out[o + 3] = 255;
    }
  }
  return { rgba: out, width: w, height: h };
}

function crop(img: Img, x: number, y: number, w: number, h: number): Img {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let yy = 0; yy < h; yy += 1) out.set(img.rgba.subarray(((y + yy) * img.width + x) * 4, ((y + yy) * img.width + x + w) * 4), yy * w * 4);
  return { rgba: out, width: w, height: h };
}

function writeGrayPng(path: string, values: Float32Array, w: number, h: number): void {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) raw[y * (w + 1) + 1 + x] = Math.round(Math.min(1, Math.max(0, values[y * w + x])) * 255);
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'ascii');
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, tail]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

async function session(file: string, expect?: { bytes: number; sha256: string }): Promise<ort.InferenceSession> {
  const bytes = readFileSync(join(root, 'src/assets/models', file));
  if (expect && (bytes.byteLength !== expect.bytes || sha(bytes) !== expect.sha256)) throw new Error(`${file} does not match its pinned checksum`);
  ort.env.wasm.numThreads = 1;
  return ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] });
}

let u2: ort.InferenceSession, yolox: ort.InferenceSession;

/** `subjectMap` in subjectDetector.ts: the piece squashed to 320 x 320, normalised, run, stretched to 0..1. */
async function subjectMap(piece: Img): Promise<Float32Array> {
  const size = SUBJECT_MODEL.inputSize;
  const small = resize(piece, size, size);
  const out = await u2.run({ [u2.inputNames[0]]: new ort.Tensor('float32', preprocess(small.rgba, size), [1, 3, size, size]) });
  const data = out[u2.outputNames[0]].data as Float32Array;
  if (data.length !== size * size) throw new Error('incomplete mask');
  return normaliseMap(data);
}

/** `refinedDetail` in subjectDetector.ts. */
function refinedDetail(map: Float32Array, piece: Img, region: SubjectDetail['region']): SubjectDetail {
  const { w, h } = detailSizeFor(piece.width, piece.height);
  const sample = resize(piece, w, h);
  const guide = lumaOf(sample.rgba, w, h);
  const coarse = resampleMap(map, SUBJECT_MODEL.inputSize, w, h);
  const radius = Math.max(2, Math.round(Math.max(w, h) / SUBJECT_MODEL.inputSize * 2));
  const refined = guidedFilter(guide, coarse, w, h, radius, 1e-3) ?? coarse;
  return { region, grid: encodeValues(refined, w, h) };
}

/** The YOLOX search of `findSubject` (whole photo first; further tiles only when nothing scored 0.5), without RF-DETR. */
async function findBox(img: Img): Promise<Detection | null> {
  const plan = tilePlan(img.width, img.height);
  const look = async (tile: { x: number; y: number; w: number; h: number }) => {
    const s = tileScale(tile);
    const piece = resize(crop(img, tile.x, tile.y, tile.w, tile.h), Math.max(1, Math.round(tile.w * s)), Math.max(1, Math.round(tile.h * s)));
    const size = DETECTOR_MODEL.inputSize;
    const input = toInput(piece.rgba, piece.width, piece.height, size);
    const out = await yolox.run({ [yolox.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]) });
    return decodeTile(out[yolox.outputNames[0]].data as Float32Array, tile);
  };
  let found = await look(plan[0]);
  if (!found.some((d) => d.score >= 0.5)) for (const tile of plan.slice(1)) found = found.concat(await look(tile));
  const merged = mergeDetections(found).filter((d) => d.score >= 0.3);
  return merged.sort((a, b) => b.score * Math.sqrt(b.box.w * b.box.h) - a.score * Math.sqrt(a.box.w * a.box.h))[0] ?? null;
}

interface Outcome { alpha: Float32Array | null; path: 'guided' | 'whole' | 'none'; reason: string; label?: string }

async function shippedMask(img: Img): Promise<Outcome> {
  const whole = async (): Promise<Outcome> => {
    const scale = Math.min(1, 640 / Math.max(img.width, img.height));
    const preview = scale < 1 ? resize(img, Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale))) : img;
    const map = await subjectMap(preview);
    const assessment = assessSubject(map);
    if (!assessment.usable) return { alpha: null, path: 'none', reason: assessment.reason };
    const full = gridSizeFor(img.height / img.width);
    const grid = toGrid(map, SUBJECT_MODEL.inputSize, full.w, full.h);
    const detail = refinedDetail(map, img, { x: 0, y: 0, w: 1, h: 1 });
    return { alpha: render(grid, detail, img, assessment.confidence), path: 'whole', reason: assessment.reason };
  };
  let found: Detection | null = null;
  try { found = await findBox(img); } catch { return whole(); }
  const region = guideRegion(found?.box, found?.score ?? 0, img.width, img.height);
  if (!found || !region) return whole();
  const { box, bounds } = sampledRegion(region, img.width, img.height);
  const piece = crop(img, box.x, box.y, box.w, box.h);
  const map = await subjectMap(piece);
  const assessment = assessSubject(map, 0.98);
  if (!assessment.usable || !maskAgreesWithDetection(map, SUBJECT_MODEL.inputSize, box, found.box)) return whole();
  const localSize = gridSizeFor(piece.height / piece.width);
  const local = toGrid(map, SUBJECT_MODEL.inputSize, localSize.w, localSize.h);
  const detail = refinedDetail(map, piece, bounds);
  const full = gridSizeFor(img.height / img.width);
  void guidedGridSize; // with a fine outline the whole-photo grid stays at the ordinary size
  return { alpha: render(placeInRegion(local, bounds, full.w, full.h), detail, img, assessment.confidence), path: 'guided', reason: assessment.reason, label: found.label };
}

/** The editor's own evaluator, at the photo's pixels, with the default softness. */
function render(grid: SubjectGrid, detail: SubjectDetail | null, img: Img, confidence: 'high' | 'medium' | 'low'): Float32Array {
  const mask = createSubjectMask('baseline', grid, 'baseline', confidence, detail);
  return maskAlpha(mask, img.width, img.height, fullContext(img.width, img.height));
}

async function main() {
  const inDir = arg('in'), keysFile = arg('keys'), outDir = arg('out');
  if (!inDir || !keysFile || !outDir) throw new Error('usage: --in DIR --keys FILE --out DIR [--suffix _raw] [--ext jpg]');
  const suffix = arg('suffix', '_raw')!, ext = arg('ext', 'jpg')!;
  const text = readFileSync(keysFile, 'utf8');
  const keys: string[] = keysFile.endsWith('.json') ? JSON.parse(text).photos.map((p: { key: string }) => p.key) : text.split(/\s+/).filter(Boolean);
  mkdirSync(outDir, { recursive: true });
  u2 = await session(SUBJECT_MODEL.file, { bytes: SUBJECT_MODEL.bytes, sha256: SUBJECT_MODEL.sha256 });
  yolox = await session(DETECTOR_MODEL.file, { bytes: DETECTOR_MODEL.bytes, sha256: DETECTOR_MODEL.sha256 });
  const refusals: Record<string, string> = {}, paths: Record<string, string> = {};
  for (const key of keys) {
    const started = performance.now();
    let img = load(join(inDir, `${key}${suffix}.${ext}`));
    const long = Math.max(img.width, img.height);
    if (long > 1024) img = resize(img, Math.round(img.width * 1024 / long), Math.round(img.height * 1024 / long));
    const result = await shippedMask(img);
    paths[key] = result.path;
    if (!result.alpha) { refusals[key] = result.reason; console.log(`${key.slice(0, 10)} no mask: ${result.reason}`); continue; }
    writeGrayPng(join(outDir, `${key}.png`), result.alpha, img.width, img.height);
    console.log(`${key.slice(0, 10)} ${result.path}${result.label ? ` (${result.label})` : ''} ${Math.round(performance.now() - started)} ms`);
  }
  writeFileSync(join(outDir, 'refusals.json'), JSON.stringify(refusals, null, 1));
  writeFileSync(join(outDir, 'paths.json'), JSON.stringify(paths, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
