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
    // With no trusted subject a noisy dark frame is lifted only a little; a found, dark subject is lifted for itself (28 Nov 2026).
    if (!withMask) assert.ok(edit.exposure <= 0.5, `exposure ${edit.exposure} must stay gentle`);
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

test('exposure and warmth suggestions land on the 0.1 slider steps', () => {
  for (const make of [robinBrightBokeh, woodlandDarkBird, closeRobinGreen, underexposedFlat]) {
    const { edit } = run(make(), true);
    for (const value of [edit.exposure, edit.warmth]) assert.equal(Math.round(value * 10) / 10, value);
  }
});

// The owner's kingfisher, 27 Nov 2026: a lit bird against a near-black river with a few specks of splash got no edit at
// all ("looks good"). The dark background is the mood and stays, but a dim subject is lifted, and the safety checks
// pass a plain lift of such a frame (they used to call it "crunchier" because the specks got brighter with everything else).
test('a dim subject on a dark background is lifted, the background stays dark, and the checks accept it', async () => {
  const { darkBackgroundBird } = await import('./syntheticScenes');
  const { planAuto } = await import('./unifiedAuto');
  for (const withMask of [true, false]) {
    const scene = darkBackgroundBird(50);
    const segmentation = withMask ? high(scene) : null;
    const natural = naturalAuto({ pixels: scene.pixels, width: scene.width, height: scene.height, segmentation });
    assert.equal(natural.lowKey, false, 'a dim subject is underexposed, not a mood');
    assert.equal(natural.scene.kind, 'underexposed');
    assert.ok(natural.edit.exposure >= 0.5 && natural.edit.exposure <= 5, `a real lift, within bounds: ${natural.edit.exposure}`);
    assert.equal(natural.edit.shadows, 0, 'the dark background is not opened into grey');
    const plan = planAuto({ pixels: scene.pixels, width: scene.width, height: scene.height, base: DEFAULT_EDIT, natural, segmentation, proposal: { ...DEFAULT_EDIT, ...natural.edit } });
    // Without a trusted subject the bright splash counts as the subject and a 2 EV lift would blow it, so the gate may refuse.
    if (!withMask) continue;
    assert.equal(plan.verdict.kind, 'improved', 'the lift passes the quality gate');
    // The picture after the edit: the bird is clearly brighter, the background is still dark.
    const after = renderRecipePreview(scene.pixels, scene.width, scene.height, plan.proposal);
    const bird = (i: number) => scene.subject[i] === 1, background = (i: number) => scene.subject[i] === 0;
    // With a trusted subject the full lift passes (about +19% in 8-bit levels); without one the gentler half is offered.
    assert.ok(regionMean(after, bird) > regionMean(scene.pixels, bird) * (withMask ? 1.15 : 1.05), 'the subject is lifted');
    assert.ok(regionMean(after, background) < 60, `the background stays far darker than the subject: ${regionMean(after, background)}`);
  }
});

test('a well-lit subject on a dark background is left exactly as it is', async () => {
  const { darkBackgroundBird } = await import('./syntheticScenes');
  const scene = darkBackgroundBird(130);
  const natural = naturalAuto({ pixels: scene.pixels, width: scene.width, height: scene.height, segmentation: high(scene) });
  assert.equal(natural.scene.kind, 'low-key');
  assert.equal(natural.edit.exposure, 0);
  assert.equal(natural.edit.shadows, 0);
  assert.ok(natural.notes.some((note) => note.includes('the mood is kept')));
});

test('sharpening the out-of-focus background is still refused, with or without a lift', () => {
  const scene = closeRobinGreen();
  const before = renderRecipePreview(scene.pixels, scene.width, scene.height, DEFAULT_EDIT);
  const crunchy = renderRecipePreview(scene.pixels, scene.width, scene.height, { ...DEFAULT_EDIT, exposure: 0.5, clarity: 1, sharpen: 1 });
  const verdict = assessNaturalAuto(before, crunchy, scene.width, scene.height, high(scene));
  assert.equal(verdict.safe, false, verdict.reason);
});

// The owner's kingfisher again (27 Nov 2026, after #1899 shipped the lift): the Info panel showed InFlight's own "Low-key" tag
// (measured on the pixels, source 'computed'), and that tag was read as "the photographer wants it dark", which removed
// the lift. InFlight's own measurement is not the person's intent: where the frame also measures as low-key, the dim
// subject is still lifted and the dark background stays dark. The person's own tag, night and astro still hold the lift.
test('InFlight\'s own low-key tag does not stop a dim subject being lifted; a tag the person chose still does', async () => {
  const { darkBackgroundBird } = await import('./syntheticScenes');
  for (const withMask of [true, false]) {
    for (const level of [50, 70]) {
      const scene = darkBackgroundBird(level);
      const segmentation = withMask ? high(scene) : null;
      const input = { pixels: scene.pixels, width: scene.width, height: scene.height, segmentation };
      const plain = naturalAuto(input);
      const ours = naturalAuto({ ...input, sceneHints: { preserveDark: true, darkMeasuredOnly: true } });
      assert.ok(plain.edit.exposure > 0, `the case being guarded: a dim bird is lifted (${level})`);
      assert.equal(ours.edit.exposure, plain.edit.exposure, 'the same lift with our own tag');
      assert.equal(ours.heldBack, null);
      assert.ok(ours.notes.some((note) => note.includes('InFlight\'s own measurement')), 'it says why it is still lifting');
      assert.equal(ours.edit.shadows, 0, 'the background is still not opened');
      const chosen = naturalAuto({ ...input, sceneHints: { preserveDark: true } });
      assert.equal(chosen.edit.exposure, 0, 'a tag the person chose keeps it dark');
      assert.equal(chosen.heldBack, 'dark-on-purpose', 'and Auto can say so');
      const after = renderRecipePreview(scene.pixels, scene.width, scene.height, { ...DEFAULT_EDIT, ...ours.edit });
      assert.ok(regionMean(after, (i) => scene.subject[i] === 0) < 60, 'the background stays far darker than the subject');
    }
  }
});

test('our own low-key tag never holds back a lift, and a frame that does not measure as low-key is still lifted', () => {
  const scene = underexposedFlat();
  const input = { pixels: scene.pixels, width: scene.width, height: scene.height };
  const plain = naturalAuto(input);
  assert.ok(plain.edit.exposure > 0 && !plain.lowKey, 'the case being guarded: a dim, flat frame that is not low-key is lifted');
  const held = naturalAuto({ ...input, sceneHints: { preserveDark: true, darkMeasuredOnly: true } });
  assert.equal(held.edit.exposure, plain.edit.exposure, 'a tag InFlight measured itself is never the photographer\'s intent, so it holds nothing back');
  assert.equal(held.heldBack, null);
  const chosen = naturalAuto({ ...input, sceneHints: { preserveDark: true } });
  assert.equal(chosen.edit.exposure, 0, 'a tag the person chose does hold it');
  assert.equal(chosen.heldBack, 'dark-on-purpose');
});

test('a well-lit bird on black, with the splash, is left alone and the hint changes nothing', async () => {
  const { darkBackgroundBird } = await import('./syntheticScenes');
  const scene = darkBackgroundBird(130);
  const base = { pixels: scene.pixels, width: scene.width, height: scene.height, segmentation: high(scene) };
  const plain = naturalAuto(base), tagged = naturalAuto({ ...base, sceneHints: { preserveDark: true, darkMeasuredOnly: true } });
  assert.deepEqual(tagged.edit, plain.edit);
  assert.equal(tagged.heldBack, null, 'nothing was taken away, so nothing is blamed on the tag');
});

// The owner's dark kingfisher (28 Nov 2026 beta): Auto left it very dark; the owner set Exposure +2.0 EV and Highlights -90
// by hand. A dim, saturated subject on a dark, noisy scene is underexposed wildlife: it is not low-key, and it is lifted by
// well over the old half-stop ceiling while its brightest channel keeps clear of clipping.
test('a dark, noisy kingfisher-like frame is lifted by about two stops, not left dark and not labelled low-key', async () => {
  const { darkBackgroundBird } = await import('./syntheticScenes');
  const { planAuto } = await import('./unifiedAuto');
  const scene = darkBackgroundBird(40);
  const segmentation = high(scene);
  // Own measured low-key tag plus high ISO: the hint that used to freeze Auto.
  const natural = naturalAuto({ pixels: scene.pixels, width: scene.width, height: scene.height, segmentation, iso: 3200,
    sceneHints: { preserveDark: true, darkMeasuredOnly: true } });
  assert.equal(natural.lowKey, false);
  assert.notEqual(natural.scene.kind, 'low-key');
  assert.equal(natural.heldBack, null);
  const ev = natural.edit.exposure * 0.4;
  assert.ok(ev >= 1.5 && ev <= 2.0, `about +2 EV, as a human edit gives: ${ev} EV`);
  const plan = planAuto({ pixels: scene.pixels, width: scene.width, height: scene.height, base: DEFAULT_EDIT, natural, segmentation, proposal: { ...DEFAULT_EDIT, ...natural.edit } });
  assert.equal(plan.verdict.kind, 'improved');
  const after = renderRecipePreview(scene.pixels, scene.width, scene.height, plan.proposal);
  const bird = (i: number) => scene.subject[i] === 1;
  assert.ok(regionMean(after, bird) > regionMean(scene.pixels, bird) * 1.6, 'the subject is clearly brighter');
});

test('an already well-exposed subject is not pushed by the bigger dark-subject lift', async () => {
  const { darkBackgroundBird } = await import('./syntheticScenes');
  const scene = darkBackgroundBird(110);
  const natural = naturalAuto({ pixels: scene.pixels, width: scene.width, height: scene.height, segmentation: high(scene) });
  assert.ok(natural.edit.exposure <= 1.2, `a modest exposure only: ${natural.edit.exposure}`);
});
