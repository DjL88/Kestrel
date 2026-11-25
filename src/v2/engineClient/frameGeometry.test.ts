import assert from 'node:assert/strict';
import test from 'node:test';
import type { CropTransform } from '../ui/contract.ts';
import { createDefaultSizes } from '../ui/stub.ts';
import { DEFAULT_CROP } from './cropOps.ts';
import { cropPlacement } from './exportLayout.ts';
import { exportCrop, paneImageStyle, paneInsetClip } from './frameGeometry.ts';
import { planExport } from './exportOps.ts';

/**
 * G02: every view must put the picture in the same place. The canvas views (single, All formats board, each split
 * pane) are modelled with the CSS rules the browser applies to `paneImageStyle`'s output; export is modelled with the
 * canvas 2D operations `renderV2Export` performs from `cropPlacement`. A source point must land at the same share of
 * the composition in each, for every built-in format and a spread of crops.
 */

type Point = { x: number; y: number };
const PICTURE = { width: 6000, height: 4000 };
const EPS = 1e-6;

function parseTransform(transform: string) {
  const m = /^translate\((-?[\d.e-]+)%, (-?[\d.e-]+)%\) rotate\((-?[\d.e-]+)deg\) scale\((-?[\d.e-]+), (-?[\d.e-]+)\)$/.exec(transform);
  assert.ok(m, `unexpected transform ${transform}`);
  const [tx, ty, deg, sx, sy] = m.slice(1).map(Number);
  return { tx, ty, rad: (deg * Math.PI) / 180, sx, sy };
}

const rotate = (p: Point, rad: number): Point => ({ x: p.x * Math.cos(rad) - p.y * Math.sin(rad), y: p.x * Math.sin(rad) + p.y * Math.cos(rad) });

/** Where source point (u, v) shows on the canvas, as a share of the whole composition, seen through pane `index`. */
function canvasPoint(u: number, v: number, crop: CropTransform, frame: { width: number; height: number }, count: number, index: number, offset: number): Point {
  const style = paneImageStyle(crop, index, count, offset);
  const elementW = frame.width * (style.width ? Number.parseFloat(style.width) / 100 : 1);
  const elementH = frame.height;
  // object-fit: cover, centred in the (unrotated) element.
  const cover = Math.max(elementW / PICTURE.width, elementH / PICTURE.height);
  const local = { x: (u - 0.5) * PICTURE.width * cover, y: (v - 0.5) * PICTURE.height * cover };
  const t = parseTransform(style.transform);
  // CSS applies the list right to left about the element's centre: scale, then rotate, then translate (% of the element).
  const turned = rotate({ x: local.x * t.sx, y: local.y * t.sy }, t.rad);
  const inPane = { x: elementW / 2 + (t.tx / 100) * elementW + turned.x, y: elementH / 2 + (t.ty / 100) * elementH + turned.y };
  // Pane `index` starts index frames into the composition.
  return { x: (inPane.x + index * frame.width) / (frame.width * count), y: inPane.y / elementH };
}

/** Where source point (u, v) lands in the exported composition, as a share of it. */
function exportPoint(u: number, v: number, crop: CropTransform, frame: { width: number; height: number }, count: number, offset: number): Point {
  const width = frame.width * count;
  const place = cropPlacement(width, frame.height, PICTURE, exportCrop(crop, offset));
  const local = { x: (u - 0.5) * place.drawWidth, y: (v - 0.5) * place.drawHeight };
  const turned = rotate({ x: local.x * place.scaleX, y: local.y * place.scaleY }, place.rotateRad);
  return { x: (width / 2 + place.translateX + turned.x) / width, y: (frame.height / 2 + place.translateY + turned.y) / frame.height };
}

const CROPS: Array<[string, Partial<CropTransform>]> = [
  ['default', {}],
  ['zoomed and panned', { zoom: 2.5, panX: 18, panY: -12 }],
  ['far pan at high zoom', { zoom: 6, panX: 160, panY: -90 }],
  ['flipped both ways', { zoom: 1.4, panX: -7, flipH: true, flipV: true }],
  ['quarter turn', { zoom: 1.8, rotateDeg: 90, panY: 5 }],
  ['half turn, flipped', { zoom: 1.2, rotateDeg: 180, flipH: true, panX: 4 }],
  ['three-quarter turn', { zoom: 3, rotateDeg: 270, panX: -30, panY: 22 }],
];
const SAMPLES: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0.5, y: 0.5 }, { x: 0.2, y: 0.7 }];
const photoFormats = createDefaultSizes().filter((size) => size.kind === 'photo');

test('every format puts the picture in the same place in the single view, the board, each split pane and export', () => {
  assert.ok(photoFormats.length >= 5, 'the built-in formats are all checked');
  let checked = 0;
  for (const size of photoFormats) {
    // The single view and the board draw the same frame at different screen sizes; geometry is a share of the frame.
    for (const screen of [{ width: 660, height: 660 * (size.height / size.width) }, { width: 180, height: 180 * (size.height / size.width) }]) {
      for (const count of [1, 2, 3, 5]) {
        for (const offset of count > 1 ? [0, 12, -25] : [0]) {
          for (const [name, patch] of CROPS) {
            const crop = { ...DEFAULT_CROP, ...patch };
            for (const sample of SAMPLES) {
              const expected = exportPoint(sample.x, sample.y, crop, size, count, offset);
              for (let index = 0; index < count; index += 1) {
                const seen = canvasPoint(sample.x, sample.y, crop, screen, count, index, offset);
                const where = `${size.id} ${count} frame(s) pane ${index} offset ${offset} ${name} (${sample.x}, ${sample.y})`;
                assert.ok(Math.abs(seen.x - expected.x) < EPS && Math.abs(seen.y - expected.y) < EPS, `${where}: canvas ${JSON.stringify(seen)} export ${JSON.stringify(expected)}`);
                checked += 1;
              }
            }
          }
        }
      }
    }
  }
  assert.ok(checked > 1000);
});

test('the split offset is never clamped differently in export: a far pan stays where the canvas shows it', () => {
  const crop = { ...DEFAULT_CROP, zoom: 6, panX: 160 };
  assert.equal(exportCrop(crop, 20).panX, 180);
  const frames = [{ id: 'p1', filename: 'a.jpg', sizeCrops: { 'orig-3x2': crop }, formatSplits: { 'orig-3x2': { enabled: true, offset: 20 } } }];
  const plan = planExport({ photoIds: ['p1'], sizeIds: ['orig-3x2'], groupIds: [], destination: 'local-zip', includeAfter: true, includeBefore: false, includeOverlay: true, includeWatermark: true, includeVideo: false }, frames, createDefaultSizes());
  assert.ok(!('error' in plan), JSON.stringify(plan));
  if ('error' in plan) return;
  assert.equal(plan.jobs[0].crop.panX, 180);
  assert.equal(paneImageStyle(crop, 0, 2, 20).transform, 'translate(180%, 0%) rotate(0deg) scale(6, 6)');
});

/** The visible span of the composition across all panes, from each pane's CSS inset clip. */
function visibleSpan(crop: CropTransform, count: number) {
  const spans: Array<[number, number]> = [];
  let top = 0, bottom = 0;
  for (let index = 0; index < count; index += 1) {
    const clip = paneInsetClip(crop, index, count);
    const [t, r, b, l] = clip ? /^inset\(([\d.]+)% ([\d.]+)% ([\d.]+)% ([\d.]+)%\)$/.exec(clip)!.slice(1).map(Number) : [0, 0, 0, 0];
    top = t; bottom = b;
    if (l + r < 100) spans.push([(index + l / 100) / count, (index + 1 - r / 100) / count]);
  }
  return { spans, top, bottom };
}

test('edge insets clip the same area of the composition on the canvas (every pane) as in export', () => {
  for (const count of [1, 2, 3, 4, 5]) {
    for (const insets of [{ insetLeft: 0, insetRight: 0 }, { insetLeft: 10, insetRight: 5 }, { insetLeft: 30, insetRight: 30 }, { insetLeft: 25, insetRight: 0 }]) {
      const crop = { ...DEFAULT_CROP, ...insets, insetTop: 8, insetBottom: 3, zoom: 2, panX: 15, rotateDeg: 90, flipH: true };
      const place = cropPlacement(1000 * count, 800, PICTURE, crop);
      const { spans, top, bottom } = visibleSpan(crop, count);
      // Panes are adjacent, so the visible spans join into one run, which must be export's clip.
      const start = spans[0][0];
      const end = spans[spans.length - 1][1];
      for (let i = 1; i < spans.length; i += 1) assert.ok(Math.abs(spans[i][0] - spans[i - 1][1]) < EPS, `gap between panes at ${count} frames`);
      assert.ok(Math.abs(start - place.clip.x / (1000 * count)) < EPS, `left edge at ${count} frames`);
      assert.ok(Math.abs(end - (place.clip.x + place.clip.width) / (1000 * count)) < EPS, `right edge at ${count} frames`);
      assert.ok(Math.abs(top / 100 - place.clip.y / 800) < EPS);
      assert.ok(Math.abs(1 - bottom / 100 - (place.clip.y + place.clip.height) / 800) < EPS);
    }
  }
});

test('the inset clip does not move with the zoom, pan, turn or flip: it is the frame\'s, not the picture\'s', () => {
  const insets = { insetTop: 4, insetRight: 6, insetBottom: 8, insetLeft: 10 };
  const plain = paneInsetClip({ ...DEFAULT_CROP, ...insets });
  assert.equal(plain, 'inset(4% 6% 8% 10%)');
  assert.equal(paneInsetClip({ ...DEFAULT_CROP, ...insets, zoom: 3, panX: 40, flipH: true, rotateDeg: 270 }), plain);
  assert.equal(paneInsetClip(DEFAULT_CROP), undefined);
});

/** With the picture's shape known, the element IS the whole picture (no object-fit crop), placed by left/top. */
function fittedCanvasPoint(u: number, v: number, crop: CropTransform, frame: { width: number; height: number }, count: number, index: number, offset: number): Point {
  const style = paneImageStyle(crop, index, count, offset, { pictureAspect: PICTURE.width / PICTURE.height, frameAspect: frame.width / frame.height });
  assert.equal(style.position, 'absolute');
  const elementW = frame.width * Number.parseFloat(style.width!) / 100;
  const elementH = frame.height * Number.parseFloat(style.height!) / 100;
  // The element has the picture's own shape, so nothing of it is cropped by object-fit.
  assert.ok(Math.abs(elementW / elementH - PICTURE.width / PICTURE.height) < 1e-3, `element shape ${elementW}x${elementH}`);
  const left = frame.width * Number.parseFloat(style.left!) / 100;
  const top = frame.height * Number.parseFloat(style.top!) / 100;
  const local = { x: (u - 0.5) * elementW, y: (v - 0.5) * elementH };
  const t = parseTransform(style.transform);
  const turned = rotate({ x: local.x * t.sx, y: local.y * t.sy }, t.rad);
  const inPane = { x: left + elementW / 2 + (t.tx / 100) * elementW + turned.x, y: top + elementH / 2 + (t.ty / 100) * elementH + turned.y };
  return { x: (inPane.x + index * frame.width) / (frame.width * count), y: inPane.y / frame.height };
}

test('a picture of known shape is the whole picture, moved exactly as export moves it, so panning shows photo, not black', () => {
  let checked = 0;
  for (const size of photoFormats) {
    const screen = { width: 300, height: 300 * (size.height / size.width) };
    for (const count of [1, 2, 3]) {
      for (const offset of count > 1 ? [0, 12] : [0]) {
        for (const [name, patch] of CROPS) {
          const crop = { ...DEFAULT_CROP, ...patch };
          for (const sample of SAMPLES) {
            const expected = exportPoint(sample.x, sample.y, crop, size, count, offset);
            for (let index = 0; index < count; index += 1) {
              const seen = fittedCanvasPoint(sample.x, sample.y, crop, screen, count, index, offset);
              assert.ok(Math.abs(seen.x - expected.x) < 1e-4 && Math.abs(seen.y - expected.y) < 1e-4,
                `${size.id} ${count} ${name} pane ${index} (${sample.x}, ${sample.y}): canvas ${JSON.stringify(seen)} export ${JSON.stringify(expected)}`);
              checked += 1;
            }
          }
        }
      }
    }
  }
  assert.ok(checked > 500);
  // A 4:5 frame of a 3:2 picture: the element is wider than the frame and centred on it.
  const style = paneImageStyle(DEFAULT_CROP, 0, 1, 0, { pictureAspect: 1.5, frameAspect: 0.8 });
  assert.equal(style.width, '187.5%');
  assert.equal(style.height, '100%');
  assert.equal(style.left, '-43.75%');
  // Without a known shape the old frame-sized element is kept.
  assert.equal(paneImageStyle(DEFAULT_CROP, 0, 1, 0, { pictureAspect: Number.NaN, frameAspect: 0.8 }).position, undefined);
});
