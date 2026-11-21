import assert from 'node:assert/strict';
import test from 'node:test';
import { applyFix, critique, flatNoise, hasRoom, overshoot, type Pixels } from './critique';
import { applyDetail, DEFAULT_EDIT, type PhotoEdit } from './photoEdits';
import { createMask, type Mask } from './maskTypes';
import { fullContext } from './masks';

const make = (width: number, height: number, fill: (x: number, y: number) => [number, number, number]): Pixels => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set([...fill(x, y), 255], (y * width + x) * 4);
  return { data, width, height };
};
const copy = (p: Pixels): Pixels => ({ ...p, data: new Uint8ClampedArray(p.data) });
let seed = 7;
const noise = (amplitude: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return ((seed >> 8) % 1000) / 1000 * amplitude - amplitude / 2; };

const stripes = make(96, 96, (x) => { const v = (Math.floor(x / 6) % 2 ? 150 : 90); return [v, v, v]; });
// A well spread, smooth, modestly coloured picture: nothing here should draw an opinion.
const gradient = make(96, 96, (x, y) => [15 + x * 2, 25 + x * 2 + y / 3, 35 + x * 1.7]);

test('heavy sharpening leaves halos that are measured as overshoot, and plain tone changes do not', () => {
  const sharpened = copy(stripes);
  applyDetail(sharpened.data, 96, 96, { ...DEFAULT_EDIT, sharpen: 2, clarity: 1 }, 2200);
  assert.ok(overshoot(stripes, sharpened) > 0.04);
  assert.ok(overshoot(stripes, copy(stripes)) < 0.001);
});

test('the critique says so when sharpening is heavy, and offers to ease it off', () => {
  const edit: PhotoEdit = { ...DEFAULT_EDIT, sharpen: 2, clarity: 1 };
  const after = copy(stripes);
  applyDetail(after.data, 96, 96, edit, 2200);
  const opinions = critique({ source: stripes, toneOnly: stripes, after, edit });
  const halos = opinions.find((o) => o.id === 'halos');
  assert.ok(halos, 'a halo warning is given');
  assert.equal(halos!.severity, 'warning');
  const eased = applyFix(edit, halos!.fix!);
  assert.ok((eased.sharpen ?? 0) < 2 && (eased.sharpen ?? 0) >= 0);
});

test('no halo warning when no sharpening was used, even if the picture is full of edges', () => {
  assert.equal(critique({ source: stripes, toneOnly: stripes, after: stripes, edit: DEFAULT_EDIT }).some((o) => o.id === 'halos'), false);
});

test('clipping that the edit caused is flagged, but clipping that was already there is left alone', () => {
  const source = make(60, 60, (x) => [120 + x, 120 + x, 120 + x]);
  const blown = make(60, 60, (x) => { const v = Math.min(255, (120 + x) * 1.9); return [v, v, v]; });
  const flagged = critique({ source, toneOnly: blown, after: blown, edit: DEFAULT_EDIT });
  assert.ok(flagged.some((o) => o.id === 'highlights'));
  const alreadyWhite = make(60, 60, (x) => (x < 12 ? [255, 255, 255] : [120, 120, 120]));
  assert.equal(critique({ source: alreadyWhite, toneOnly: alreadyWhite, after: alreadyWhite, edit: DEFAULT_EDIT }).some((o) => o.id === 'highlights'), false);
});

test('crushed blacks caused by the edit are flagged with a shadows fix', () => {
  const source = make(60, 60, (x) => [30 + x, 30 + x, 30 + x]);
  const crushed = make(60, 60, (x) => { const v = Math.max(0, (30 + x - 55) * 2); return [v, v, v]; });
  const shadows = critique({ source, toneOnly: crushed, after: crushed, edit: DEFAULT_EDIT }).find((o) => o.id === 'shadows');
  assert.ok(shadows);
  assert.ok((applyFix(DEFAULT_EDIT, shadows!.fix!).shadows ?? 0) > 0);
});

test('amplified grain in smooth areas is noticed', () => {
  const quiet = make(80, 80, () => { const v = 100 + noise(3); return [v, v, v]; });
  const loud = make(80, 80, () => { const v = 100 + noise(30); return [v, v, v]; });
  assert.ok(flatNoise(loud) > flatNoise(quiet) * 3);
  assert.ok(critique({ source: quiet, toneOnly: loud, after: loud, edit: DEFAULT_EDIT }).some((o) => o.id === 'noise'));
  assert.equal(critique({ source: quiet, toneOnly: quiet, after: quiet, edit: DEFAULT_EDIT }).some((o) => o.id === 'noise'), false);
});

test('a dark subject against a bright background is called out, and the fix targets the subject mask', () => {
  const picture = make(80, 80, (x, y) => (Math.hypot(x - 40, y - 40) < 18 ? [50, 45, 40] : [200, 205, 210]));
  const mask: Mask = { ...createMask('radial', 'subject-1'), kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.25, feather: 0.1 };
  const opinions = critique({ source: picture, toneOnly: picture, after: picture, edit: DEFAULT_EDIT, subject: { mask, context: fullContext(80, 80) } });
  const dark = opinions.find((o) => o.id === 'subject-dark');
  assert.ok(dark);
  assert.equal(dark!.fix?.kind, 'mask');
  const fixed = applyFix({ ...DEFAULT_EDIT, masks: [mask] }, dark!.fix!);
  assert.ok((fixed.masks![0].edit.exposure ?? 0) > 0);
});

test('a flat, over-saturated picture gets tips, and a healthy one gets none', () => {
  const flat = make(60, 60, (x) => [118 + (x % 8), 120 + (x % 6), 122 + (x % 5)]);
  assert.ok(critique({ source: flat, toneOnly: flat, after: flat, edit: DEFAULT_EDIT }).some((o) => o.id === 'flat'));
  const vivid = make(60, 60, (x, y) => [255, 20 + x, 10 + y % 8]);
  assert.ok(critique({ source: vivid, toneOnly: vivid, after: vivid, edit: DEFAULT_EDIT }).some((o) => o.id === 'colour'));
  assert.deepEqual(critique({ source: gradient, toneOnly: gradient, after: gradient, edit: DEFAULT_EDIT }), []);
});

test('there are never more than four opinions, and warnings come before tips', () => {
  const bad = make(80, 80, (x, y) => ((x + y) % 2 ? [255, 0, 0] : [0, 0, 0]));
  const opinions = critique({ source: gradient.width === 80 ? gradient : make(80, 80, () => [128, 128, 128]), toneOnly: bad, after: bad, edit: { ...DEFAULT_EDIT, sharpen: 2 } });
  assert.ok(opinions.length <= 4);
  const firstTip = opinions.findIndex((o) => o.severity === 'tip');
  if (firstTip !== -1) assert.ok(opinions.slice(firstTip).every((o) => o.severity === 'tip'));
});

test('applying a fix respects the slider limits and never makes sharpening negative', () => {
  const next = applyFix({ ...DEFAULT_EDIT, sharpen: 0.1, shadows: 1.9, clarity: -1.9 }, { kind: 'global', delta: { sharpen: -0.4, shadows: 0.4, clarity: -0.3 } });
  assert.equal(next.sharpen, 0);
  assert.equal(next.shadows, 2);
  assert.equal(next.clarity, -2);
});

import { toneOnlyEdit } from './critique';

test('the tone-only version drops detail everywhere but keeps tone and colour', () => {
  const mask: Mask = { ...createMask('radial', 'm'), edit: { exposure: 0.5, sharpen: 1, clarity: 1, texture: 1, warmth: 0.2 } };
  const tone = toneOnlyEdit({ ...DEFAULT_EDIT, exposure: 0.3, sharpen: 1.5, clarity: 1, masks: [mask] });
  assert.equal(tone.exposure, 0.3);
  assert.equal(tone.sharpen, 0);
  assert.equal(tone.clarity, 0);
  assert.deepEqual(tone.masks![0].edit, { exposure: 0.5, warmth: 0.2 });
});

test('Opinion does not call an orange feather pure white or offer an unsafe global highlight fix', () => {
  const source = make(64, 64, () => [235, 100, 45]);
  const vivid = make(64, 64, () => [255, 110, 50]);
  const opinions = critique({ source, toneOnly: vivid, after: vivid, edit: DEFAULT_EDIT });
  const channel = opinions.find((opinion) => opinion.id === 'colour-channels');
  assert.ok(channel, 'one clipped RGB channel should be reported');
  assert.match(channel!.detail, /not mean those pixels are pure white/);
  assert.equal(channel!.fix, undefined, 'a heuristic cannot unconditionally dull brightly coloured feathers');
  assert.ok(!opinions.some((opinion) => opinion.id === 'highlights'),
    'one saturated channel must never be counted as a pure-white pixel');
});

test('true RGB white clipping remains visible, without promising recovered detail', () => {
  const source = make(64, 64, () => [230, 230, 230]);
  const white = make(64, 64, () => [255, 255, 255]);
  const opinion = critique({ source, toneOnly: white, after: white, edit: DEFAULT_EDIT })
    .find((entry) => entry.id === 'highlights');
  assert.ok(opinion);
  assert.equal(opinion!.fix, undefined);
  assert.match(opinion!.detail, /cannot recover detail/);
});

// ---- Dark on purpose (low-key) photos, and fixes that are not offered twice ----

/** A dark scene with a small, clearly lit subject: a bird against a dark wood. */
const lowKeyScene = (background: number) => make(96, 96, (x, y) => (x > 70 && y > 70 ? [200, 140, 90] : [background, background + 2, background + 1]));

test('a photo that is dark on purpose is not called flat or crushed, and its bright subject is not "pasted on"', () => {
  const source = lowKeyScene(14);
  const after = lowKeyScene(0); // the edit took the already dark background to pure black
  const subjectMask: Mask = { ...createMask('radial', 'subject-test'), kind: 'radial' } as Mask;
  const ids = critique({ source, toneOnly: after, after, edit: DEFAULT_EDIT, subject: { mask: subjectMask, context: fullContext(96, 96) } }).map((o) => o.id);
  assert.ok(!ids.includes('shadows'), 'a black background is the mood here');
  assert.ok(!ids.includes('flat'), 'narrow brightness is the mood here');
  assert.ok(!ids.includes('subject-bright'), 'the lit subject is the point');
});

test('the same crushed blacks on an ordinary photo are still reported', () => {
  const source = make(96, 96, (x) => [60 + x, 60 + x, 60 + x]);
  const after = make(96, 96, (x) => [x < 40 ? 0 : 60 + x, x < 40 ? 0 : 60 + x, x < 40 ? 0 : 60 + x]);
  assert.ok(critique({ source, toneOnly: after, after, edit: DEFAULT_EDIT }).some((o) => o.id === 'shadows'));
});

test('"Add contrast" is not offered once contrast has already been added, or while bright areas are clipping', () => {
  const narrow = make(96, 96, (x) => [100 + (x % 40), 100 + (x % 40), 100 + (x % 40)]);
  const offered = (edit: PhotoEdit, picture: Pixels) => critique({ source: picture, toneOnly: picture, after: picture, edit }).some((o) => o.id === 'flat');
  assert.equal(offered(DEFAULT_EDIT, narrow), true, 'a genuinely flat picture still gets the tip');
  assert.equal(offered({ ...DEFAULT_EDIT, contrast: 0.3 }, narrow), true, 'some room left');
  assert.equal(offered({ ...DEFAULT_EDIT, contrast: 1.2 }, narrow), false, 'already added a lot');
  const clipping = make(96, 96, (x, y) => (y < 3 ? [255, 255, 255] : [100 + (x % 40), 100 + (x % 40), 100 + (x % 40)]));
  assert.equal(offered(DEFAULT_EDIT, clipping), false, 'more contrast would clip the bright areas further');
});

test('a fix whose sliders are already well along is dropped, and a warning keeps its message but loses the button', () => {
  assert.equal(hasRoom({ ...DEFAULT_EDIT }, { kind: 'global', delta: { shadows: 0.4, blacks: 0.3 } }), true);
  assert.equal(hasRoom({ ...DEFAULT_EDIT, shadows: 1.4, blacks: 1.1 }, { kind: 'global', delta: { shadows: 0.4, blacks: 0.3 } }), false);
  assert.equal(hasRoom({ ...DEFAULT_EDIT, sharpen: 2 }, { kind: 'global', delta: { sharpen: -0.4 } }), true, 'easing off still has room');
  assert.equal(hasRoom(DEFAULT_EDIT, { kind: 'global', delta: { sharpen: 0 } }), true, 'a no-op delta never hides anything');
  const edit: PhotoEdit = { ...DEFAULT_EDIT, shadows: 1.5, blacks: 1.2 };
  const source = make(96, 96, (x) => [60 + x, 60 + x, 60 + x]);
  const after = make(96, 96, (x) => [x < 40 ? 0 : 60 + x, x < 40 ? 0 : 60 + x, x < 40 ? 0 : 60 + x]);
  const warning = critique({ source, toneOnly: after, after, edit }).find((o) => o.id === 'shadows');
  assert.ok(warning, 'the problem is still reported');
  assert.equal(warning!.fix, undefined, 'but the same button is not offered a third time');
});
