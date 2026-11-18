import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessNaturalAuto, naturalAuto, renderRecipePreview, scaleRecipe, stageNaturalRecipe, subjectWeights,
} from './naturalAuto';
import { autoEnhance } from './autoEnhance';
import { proposeSubjectAwareAuto } from './insightSubjectAuto';
import { DEFAULT_EDIT, type PhotoEdit } from './photoEdits';
import { closeRobinGreen, robinBrightBokeh, underexposedFlat, woodlandDarkBird, type SyntheticScene } from './syntheticScenes';

const high = (s: SyntheticScene) => ({ grid: s.grid, confidence: 'high' as const });
const run = (s: SyntheticScene, withMask = false, iso?: number) =>
  naturalAuto({ pixels: s.pixels, width: s.width, height: s.height, segmentation: withMask ? high(s) : null, iso });
const NO_GLOBAL_DETAIL = (edit: Partial<PhotoEdit>) => !edit.clarity && !edit.texture && !edit.sharpen;

/** Mean perceptual-ish brightness (0 to 255) of pixels selected by a predicate, before and after a recipe. */
function regionMean(pixels: Uint8ClampedArray, pick: (i: number) => boolean): number {
  let sum = 0, count = 0;
  for (let i = 0; i < pixels.length / 4; i += 1) if (pick(i)) { sum += (pixels[i * 4] + pixels[i * 4 + 1] + pixels[i * 4 + 2]) / 3; count += 1; }
  return count ? sum / count : 0;
}

test('robin against bright bokeh: the sky stays bright, plumage is not boosted, nothing is darkened', () => {
  const scene = robinBrightBokeh();
  for (const withMask of [false, true]) {
    const { edit, notes } = run(scene, withMask);
    assert.ok(edit.exposure >= 0, `global exposure ${edit.exposure} must not darken a bright-background frame`);
    assert.equal(edit.highlights, 0, 'a smooth white sky is not highlight detail');
    assert.equal(edit.vibrance, 0, 'rich warm plumage is protected');
    assert.ok(NO_GLOBAL_DETAIL(edit));
    assert.ok(notes.some((n) => n.includes('Warm feather colours')));
  }
  // The legacy full-frame engine is kept for comparison: it darkens this frame and pushes vibrance.
  const legacy = autoEnhance(scene.pixels).edit;
  assert.ok(legacy.exposure < 0 || legacy.highlights < 0 || legacy.vibrance > 0, 'legacy comparison changed; update the report');
});

test('robin against bright bokeh: with a trusted mask the subject is lifted locally and the sky is untouched', () => {
  const scene = robinBrightBokeh();
  const result = run(scene, true);
  const proposal = proposeSubjectAwareAuto({
    pixels: scene.pixels, width: scene.width, height: scene.height, edit: { ...DEFAULT_EDIT, ...result.edit },
    subjectKind: 'wildlife', segmentation: high(scene), framingKey: 'k', maskId: 'auto-subject', extra: result.subjectEdit,
  }).edit;
  const after = renderRecipePreview(scene.pixels, scene.width, scene.height, proposal);
  const sky = (i: number) => !scene.subject[i] && Math.floor(i / scene.width) < scene.height * 0.3;
  assert.ok(Math.abs(regionMean(after, sky) - regionMean(scene.pixels, sky)) < 1, 'sky brightness unchanged');
  assert.ok(regionMean(after, (i) => !!scene.subject[i]) > regionMean(scene.pixels, (i) => !!scene.subject[i]), 'subject lifted');
  assert.equal(stageNaturalRecipe(scene.pixels, scene.width, scene.height, DEFAULT_EDIT, proposal, high(scene)).outcome, 'full');
});

test('woodland bird: noisy dark foliage keeps its mood and is not lifted into grey', () => {
  const scene = woodlandDarkBird();
  for (const withMask of [false, true]) {
    const { edit, scene: report } = run(scene, withMask);
    assert.equal(edit.shadows, 0, 'no global shadow lift');
    assert.ok(edit.exposure <= 0.5, `exposure ${edit.exposure} must stay gentle`);
    assert.ok(NO_GLOBAL_DETAIL(edit), 'out-of-focus foreground leaves are never sharpened');
    assert.ok(report.shadowNoisy > 0.5, 'dark areas measured as noise-dominated');
  }
  // The legacy engine lifts these noisy shadows globally.
  assert.ok(autoEnhance(scene.pixels).edit.shadows > 0);
});

test('high ISO is honoured: no shadow lift and no local sharpen', () => {
  const scene = underexposedFlat();
  const result = run(scene, true, 3200);
  assert.equal(result.edit.shadows, 0);
  assert.equal(result.subjectEdit?.sharpen, undefined);
});

test('close robin with green bokeh: no neon greens, no global contrast, sharpening only inside the subject mask', () => {
  const scene = closeRobinGreen();
  const plain = run(scene);
  assert.equal(plain.edit.vibrance, 0);
  assert.equal(plain.edit.contrast, 0, 'per-channel contrast would push saturation in a colour-rich frame');
  assert.ok(NO_GLOBAL_DETAIL(plain.edit));
  const masked = run(scene, true);
  if (masked.subjectEdit?.sharpen) assert.ok(masked.subjectEdit.sharpen <= 0.25);
  const proposal = proposeSubjectAwareAuto({
    pixels: scene.pixels, width: scene.width, height: scene.height, edit: { ...DEFAULT_EDIT, ...masked.edit },
    subjectKind: 'wildlife', segmentation: high(scene), framingKey: 'k', maskId: 'auto-subject', extra: masked.subjectEdit,
  }).edit;
  const after = renderRecipePreview(scene.pixels, scene.width, scene.height, proposal);
  // Background pixels far from the bird are bit-identical.
  let changed = 0, far = 0;
  for (let i = 0; i < scene.width * scene.height; i += 1) {
    const x = i % scene.width, y = Math.floor(i / scene.width);
    if (x > scene.width * 0.85 || y < scene.height * 0.08) { far += 1; if (after[i * 4] !== scene.pixels[i * 4] || after[i * 4 + 1] !== scene.pixels[i * 4 + 1]) changed += 1; }
  }
  assert.ok(far > 0 && changed === 0, `${changed} far background pixels changed`);
});

test('a genuinely underexposed frame is lifted, and colour-muted frames get gentle vibrance', () => {
  const { edit, abstained } = run(underexposedFlat(), true);
  assert.equal(abstained, false);
  assert.ok(edit.exposure > 0);
  assert.ok(edit.vibrance > 0 && edit.vibrance <= 0.3);
});

function paleBird(blown: boolean): SyntheticScene {
  // A pale, textured bird close to clipping against mid-grey: real highlight detail is at risk.
  const width = 160, height = 120;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const subject = new Uint8Array(width * height);
  const gw = 32, gh = 24, grid = new Uint8Array(gw * gh);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const inside = ((x - 80) / 40) ** 2 + ((y - 60) / 32) ** 2 < 1;
    const t = 7 * Math.sin(x * 1.3 + y * 0.4) + 5 * Math.sin(y * 1.1);
    const v = inside ? (blown ? 255 : 238 + t) : 110 + (x % 7);
    pixels.set([v, v, inside ? v - 2 : v, 255], (y * width + x) * 4);
    subject[y * width + x] = inside ? 1 : 0;
  }
  for (let gy = 0; gy < gh; gy += 1) for (let gx = 0; gx < gw; gx += 1) {
    grid[gy * gw + gx] = ((gx * 5 + 2.5 - 80) / 40) ** 2 + ((gy * 5 + 2.5 - 60) / 32) ** 2 < 0.85 ? 255 : 0;
  }
  return { name: 'pale', width, height, pixels, subject, grid: { w: gw, h: gh, data: btoa(String.fromCharCode(...grid)) } };
}

test('textured highlights near clipping are recovered; a blown subject brings exposure down', () => {
  const pale = run(paleBird(false), true);
  assert.ok(pale.edit.highlights < 0, 'real bright detail is protected');
  const blown = run(paleBird(true), true);
  assert.ok(blown.edit.exposure < 0, 'a blown subject (not a sky) lowers exposure');
});

test('abstains explicitly on a balanced photo and refuses malformed input', () => {
  const plain = run(closeRobinGreen());
  assert.equal(plain.abstained, true);
  assert.ok(plain.notes.at(-1)?.includes('already works'));
  const bad = naturalAuto({ pixels: new Uint8ClampedArray(16), width: 2, height: 2 });
  assert.equal(bad.abstained, true);
  assert.deepEqual(bad.edit, { exposure: 0, warmth: 0, shadows: 0, highlights: 0, contrast: 0, vibrance: 0 });
});

test('a low-confidence or malformed mask is never trusted', () => {
  const scene = robinBrightBokeh();
  const low = naturalAuto({ pixels: scene.pixels, width: scene.width, height: scene.height, segmentation: { grid: scene.grid, confidence: 'low' } });
  assert.notEqual(low.scene.reference, 'subject');
  assert.equal(low.subjectEdit, null);
  assert.equal(subjectWeights({ w: 32, h: 24, data: '!!!' }, 10, 10), null);
  assert.equal(subjectWeights({ w: 4, h: 4, data: btoa('x'.repeat(16)) }, 10, 10), null);
});

test('16-bit previews give the same decisions as 8-bit ones', () => {
  for (const make of [robinBrightBokeh, woodlandDarkBird, closeRobinGreen]) {
    const scene = make();
    const deep = new Uint16Array(scene.pixels.length);
    for (let i = 0; i < deep.length; i += 1) deep[i] = scene.pixels[i] * 257;
    const a = run(scene, true);
    const b = naturalAuto({ pixels: deep, width: scene.width, height: scene.height, segmentation: high(scene) });
    assert.deepEqual(b.edit, a.edit, scene.name);
    assert.deepEqual(b.subjectEdit, a.subjectEdit, scene.name);
  }
});

test('deterministic: the same preview always gives the same recipe', () => {
  const scene = woodlandDarkBird();
  assert.deepEqual(run(scene, true), run(scene, true));
});

test('gate blocks crunchy bokeh, pushed plumage and grey shadows', () => {
  const robin = closeRobinGreen();
  const sharpened = renderRecipePreview(robin.pixels, robin.width, robin.height, { ...DEFAULT_EDIT, sharpen: 2, texture: 2 });
  assert.equal(assessNaturalAuto(robin.pixels, sharpened, robin.width, robin.height, high(robin)).safe, false);
  const pushed = renderRecipePreview(robin.pixels, robin.width, robin.height, { ...DEFAULT_EDIT, colour: 1.5 });
  const verdict = assessNaturalAuto(robin.pixels, pushed, robin.width, robin.height, high(robin));
  assert.equal(verdict.safe, false);
  const wood = woodlandDarkBird();
  const lifted = renderRecipePreview(wood.pixels, wood.width, wood.height, { ...DEFAULT_EDIT, exposure: 2, shadows: 2 });
  assert.equal(assessNaturalAuto(wood.pixels, lifted, wood.width, wood.height, high(wood)).safe, false);
});

test('gate blocks flattening a bright background', () => {
  const robin = robinBrightBokeh();
  const flattened = renderRecipePreview(robin.pixels, robin.width, robin.height, { ...DEFAULT_EDIT, highlights: -2, whites: -2 });
  const verdict = assessNaturalAuto(robin.pixels, flattened, robin.width, robin.height, high(robin));
  assert.equal(verdict.safe, false);
});

test('staged fallback: a failing recipe is retried gentler, then declined, never forced', () => {
  const wood = woodlandDarkBird();
  const harsh: PhotoEdit = { ...DEFAULT_EDIT, exposure: 2, shadows: 2 };
  const staged = stageNaturalRecipe(wood.pixels, wood.width, wood.height, DEFAULT_EDIT, harsh, high(wood));
  assert.notEqual(staged.outcome, 'full');
  if (staged.outcome === 'declined') assert.deepEqual(staged.edit, DEFAULT_EDIT);
  else assert.deepEqual(staged.edit, scaleRecipe(DEFAULT_EDIT, harsh, 0.5));
  const unchanged = stageNaturalRecipe(wood.pixels, wood.width, wood.height, DEFAULT_EDIT, DEFAULT_EDIT, high(wood));
  assert.equal(unchanged.outcome, 'nothing-needed');
});

test('scaling a recipe never touches manual values or existing masks', () => {
  const base: PhotoEdit = { ...DEFAULT_EDIT, exposure: 0.4, masks: [{ id: 'mine', kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.2, invert: false, feather: 0.5, edit: { exposure: 1 } }] };
  const proposal: PhotoEdit = { ...base, exposure: 1.4, shadows: 0.4, masks: [...base.masks!, { id: 'auto', kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1, invert: false, feather: 0.5, edit: { exposure: 0.5 } }] };
  const half = scaleRecipe(base, proposal, 0.5);
  assert.equal(half.exposure, 0.9);
  assert.equal(half.shadows, 0.2);
  assert.deepEqual(half.masks![0], base.masks![0]);
  assert.equal(half.masks![1].edit.exposure, 0.25);
});

/** The flat dark fixtures the browser tests use: a dim grey block on a near-black, noise-free background. */
function flatDark(bg: [number, number, number], block: [number, number, number]) {
  const width = 300, height = 200, pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    pixels.set([...(x >= 80 && x < 180 && y >= 55 && y < 145 ? block : bg), 255], (y * width + x) * 4);
  }
  return { pixels, width, height };
}

test('a clean, underexposed frame is lifted (browser fixtures for batch Auto and Suggest a look)', () => {
  for (const [bg, block] of [[[0x1b, 0x1c, 0x20], [0x41, 0x45, 0x53]], [[0x28, 0x2a, 0x34], [0x55, 0x58, 0x70]], [[0x23, 0x25, 0x2c], [0x65, 0x69, 0x71]]] as const) {
    const frame = flatDark([...bg], [...block]);
    const result = naturalAuto(frame);
    assert.ok(result.edit.exposure > 0, `exposure ${result.edit.exposure} for ${result.scene.kind}`);
    const staged = stageNaturalRecipe(frame.pixels, frame.width, frame.height, DEFAULT_EDIT, { ...DEFAULT_EDIT, ...result.edit });
    assert.ok(staged.outcome === 'full' || staged.outcome === 'gentler', staged.reason);
  }
  // A bright frame in the same set stays as it is.
  assert.ok(naturalAuto(flatDark([0xa0, 0xb0, 0xba], [0xc0, 0xce, 0xd2])).edit.exposure <= 0);
});
