/**
 * Fit the app's global recipe per confident edited pair, from small previews kept OUTSIDE the repo.
 *   npx tsx scripts/owner-pairs/fitRun.ts ~/code/kestrel-test-photos/owner-pairs [limit]
 * Writes fits.jsonl next to the previews. Records hashes and numbers only, never paths.
 * Baseline = the camera's embedded JPEG (not Kestrel's own RAW render, which cannot run headless).
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import jpeg from 'jpeg-js';
import { toOklab } from '../../src/core/colourCheck';
import { fitGlobalEdit } from './fitMath';

interface Img { data: Uint8ClampedArray; width: number; height: number }
const load = (p: string): Img => {
  const d = jpeg.decode(readFileSync(p), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 });
  return { data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength), width: d.width, height: d.height };
};
function resize(img: Img, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.floor((y * img.height) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h));
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.floor((x * img.width) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / w));
      let r = 0, g = 0, b = 0, c = 0;
      for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) { const i = (yy * img.width + xx) * 4; r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; c += 1; }
      const o = (y * w + x) * 4; out[o] = r / c; out[o + 1] = g / c; out[o + 2] = b / c; out[o + 3] = 255;
    }
  }
  return out;
}
const meanL = (p: Uint8ClampedArray) => { let s = 0; for (let i = 0; i < p.length; i += 4) s += toOklab(p[i], p[i + 1], p[i + 2])[0]; return s / (p.length / 4); };
const pct = (p: Uint8ClampedArray, q: number) => { const v: number[] = []; for (let i = 0; i < p.length; i += 4) v.push(toOklab(p[i], p[i + 1], p[i + 2])[0]); v.sort((a, b) => a - b); return v[Math.floor(q * (v.length - 1))]; };

const dir = process.argv[2], limit = Number(process.argv[3] || 0);
const pairs = JSON.parse(readFileSync(join(dir, 'pairs.json'), 'utf8')) as Array<Record<string, unknown>>;
const align = new Map<string, number>(existsSync(join(dir, 'align.jsonl')) ? readFileSync(join(dir, 'align.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return [j.key, j.ncc ?? 0] as [string, number]; }) : []);
const outFile = join(dir, 'fits.jsonl');
const done = new Set(existsSync(outFile) ? readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).key) : []);
let n = 0;
for (const p of pairs) {
  const key = `${p.raw_hash}_${p.img_hash}`;
  if (done.has(key) || p.status !== 'confident' || p.class !== 'edited') continue;
  const fr = join(dir, 'previews', `${key}_rawcrop.jpg`), ff = join(dir, 'previews', `${key}_final.jpg`);
  if (!existsSync(fr) || !existsSync(ff)) continue;
  const ncc = align.get(key) ?? 0;
  const a = load(fr), b = load(ff);
  const aspect = (a.width / a.height) / (b.width / b.height);
  const rec: Record<string, unknown> = { key, ncc, model: p.model, focal: p.focal, iso: p.iso, et: p.et, f: p.f, ev: p.ev, crop: p.crop };
  if (ncc < 0.85) { rec.skipped = 'alignment not confident (crop not found by correlation)'; }
  else if (Math.abs(aspect - 1) > 0.03) { rec.skipped = 'aspect differs after alignment'; }
  else {
    const w = 256, h = Math.max(1, Math.round((256 * a.height) / a.width)), W = a.width >= a.height ? w : h, H = a.width >= a.height ? h : w;
    const src = resize(a, a.width >= a.height ? w : h, a.width >= a.height ? h : w), dst = resize(b, W, H);
    const r = fitGlobalEdit(src, dst, 2);
    Object.assign(rec, { edit: r.edit, lossBefore: r.before, lossAfter: r.after, lumRaw: meanL(src), lumFinal: meanL(dst), p05Raw: pct(src, 0.05), p05Final: pct(dst, 0.05), p95Raw: pct(src, 0.95), p95Final: pct(dst, 0.95) });
  }
  appendFileSync(outFile, JSON.stringify(rec) + '\n');
  n += 1; if (n % 20 === 0) console.log(n);
  if (limit && n >= limit) break;
}
console.log('fitted', n);
