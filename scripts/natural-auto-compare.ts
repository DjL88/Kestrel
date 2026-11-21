/**
 * Compare Kestrel's automatic edits on your own photographs, entirely on this computer.
 *
 *   npm run compare:auto -- <photo-or-folder> [more…] [--out <folder>] [--size 640] [--stress]
 *
 * For each JPEG, PNG or WebP it writes, at preview size:
 *   <name>.original.png  the decoded photo
 *   <name>.legacy.png    the previous full-frame Auto (autoEnhance), for comparison
 *   <name>.natural.png   Natural Auto, after its staged checks
 *   report.json / report.md  recipes, plain-language notes, scene measurements and check results
 *
 * --stress also darkens each photo by 1 EV and brightens it by 0.5 EV, then checks that Natural Auto moves it back
 * the right way and passes its checks. A finished photo should be left alone; a mis-exposed one should not.
 *
 * Honest limits: decoding is done by Chromium, as in the browser app, so a NEF is not read here. Use an NX Studio or
 * Kestrel export of the RAW (JPEG, PNG) as input. Subject segmentation is not run in this tool; Natural Auto
 * measures in-focus detail instead, exactly as batch keeper Auto does. Nothing is uploaded; the browser runs offline.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { zlibSync } from 'fflate';
import { chromium } from '@playwright/test';
import { autoEnhance } from '../src/core/autoEnhance';
import { assessNaturalAuto, describeOutcome, naturalAuto, renderRecipePreview, stageNaturalRecipe } from '../src/core/naturalAuto';
import { DEFAULT_EDIT } from '../src/core/photoEdits';

const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function args() {
  const list = process.argv.slice(2);
  const inputs: string[] = [];
  let out = resolve('kestrel-auto-compare');
  let size = 640;
  let stress = false;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === '--out') out = resolve(list[++i]);
    else if (list[i] === '--stress') stress = true;
    else if (list[i] === '--size') size = Math.max(128, Math.min(1024, Number(list[++i]) || 640));
    else inputs.push(list[i]);
  }
  if (!inputs.length) {
    console.error('Usage: npm run compare:auto -- <photo-or-folder> [--out <folder>] [--size 640]');
    process.exit(2);
  }
  const files = inputs.flatMap((input) => {
    const path = resolve(input);
    if (statSync(path).isDirectory()) return readdirSync(path).map((name) => join(path, name)).filter((f) => IMAGE.has(extname(f).toLowerCase()));
    return IMAGE.has(extname(path).toLowerCase()) ? [path] : [];
  });
  return { files, out, size, stress };
}

const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
/** Minimal 8-bit RGBA PNG writer. */
function png(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())];
  const total = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { total.set(p, at); at += p.length; }
  return total;
}

async function main() {
  const { files, out, size, stress } = args();
  if (!files.length) { console.error('No JPEG, PNG or WebP files found.'); process.exit(2); }
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-proxy-server'] });
  const context = await browser.newContext({ offline: true });
  const page = await context.newPage();
  await page.setContent('<!doctype html><title>Kestrel compare</title>');
  const report: unknown[] = [];
  const lines = ['# Kestrel Auto comparison', '', `Preview size: ${size}px long edge. Local only; nothing was uploaded.`, ''];
  for (const file of files) {
    const name = basename(file, extname(file));
    const b64 = readFileSync(file).toString('base64');
    const decoded = await page.evaluate(async ({ b64, mime, size }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
      const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let binary = '';
      for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
      return { width: canvas.width, height: canvas.height, sourceWidth: bitmap.width, sourceHeight: bitmap.height, rgba: btoa(binary) };
    }, { b64, mime: MIME[extname(file).toLowerCase()], size });
    const pixels = Uint8ClampedArray.from(Buffer.from(decoded.rgba, 'base64'));
    const { width, height } = decoded;
    const legacyEdit = { ...DEFAULT_EDIT, ...autoEnhance(pixels).edit };
    const legacy = renderRecipePreview(pixels, width, height, legacyEdit);
    const legacyCheck = assessNaturalAuto(pixels, legacy, width, height);
    const natural = naturalAuto({ pixels, width, height });
    const staged = stageNaturalRecipe(pixels, width, height, DEFAULT_EDIT, { ...DEFAULT_EDIT, ...natural.edit });
    const rendered = renderRecipePreview(pixels, width, height, staged.edit);
    writeFileSync(join(out, `${name}.original.png`), png(pixels, width, height));
    writeFileSync(join(out, `${name}.legacy.png`), png(legacy, width, height));
    writeFileSync(join(out, `${name}.natural.png`), png(rendered, width, height));
    const entry = {
      file: basename(file), source: { width: decoded.sourceWidth, height: decoded.sourceHeight }, preview: { width, height },
      legacy: { edit: legacyEdit, check: legacyCheck },
      natural: { proposed: natural.edit, applied: staged.edit, outcome: staged.outcome, check: staged.reason, notes: natural.notes, scene: natural.scene },
    };
    report.push(entry);
    const fmt = (e: object) => Object.entries(e).filter(([k, v]) => k !== 'masks' && v).map(([k, v]) => `${k} ${v}`).join(', ') || 'no change';
    lines.push(`## ${basename(file)}`, '',
      `- Legacy Auto: ${fmt(legacyEdit)}. Check: ${legacyCheck.safe ? 'passes' : `fails (${legacyCheck.reason})`}.`,
      `- Natural Auto: ${fmt(staged.edit)}. ${describeOutcome(staged.outcome, staged.reason)}`,
      `- Scene: ${natural.scene.kind}, measured from ${natural.scene.reference}.`,
      ...natural.notes.map((n) => `  - ${n}`), '');
    if (stress) {
      for (const [label, ev, want] of [['darker by 1 EV', -1, 1], ['brighter by 0.5 EV', 0.5, -1]] as const) {
        const shifted = renderRecipePreview(pixels, width, height, { ...DEFAULT_EDIT, exposure: ev / 0.4 });
        const result = naturalAuto({ pixels: shifted, width, height });
        const stagedShift = stageNaturalRecipe(shifted, width, height, DEFAULT_EDIT, { ...DEFAULT_EDIT, ...result.edit });
        const moved = stagedShift.edit.exposure * want > 0 || (want < 0 && (stagedShift.edit.highlights ?? 0) < 0);
        const verdict = moved ? 'corrected the right way' : stagedShift.outcome === 'declined' ? 'declined (a check failed)' : 'left unchanged';
        lines.push(`- Stress, ${label}: ${verdict} (${fmt(stagedShift.edit)}; scene ${result.scene.kind}).`);
        console.log(`  stress ${label}: ${verdict} (${fmt(stagedShift.edit)})`);
        (entry as Record<string, unknown>)[`stress ${label}`] = { edit: stagedShift.edit, outcome: stagedShift.outcome, scene: result.scene.kind, verdict };
      }
      lines.push('');
    }
    console.log(`${basename(file)}: natural ${staged.outcome} (${fmt(staged.edit)}); legacy ${fmt(legacyEdit)}${legacyCheck.safe ? '' : ' [fails check: ' + legacyCheck.reason + ']'}`);
  }
  await browser.close();
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(out, 'report.md'), lines.join('\n'));
  console.log(`\nWrote ${files.length * 3} images and a report to ${out}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
