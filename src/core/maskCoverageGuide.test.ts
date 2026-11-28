import assert from 'node:assert/strict';
import test from 'node:test';
import { createMask, type Mask } from './maskTypes.ts';
import { effectiveAlpha } from './masks.ts';
import { HATCH_ALPHA, TINT_ALPHA, isHatchStripe, maskCoverageGuide } from './maskCoverageGuide.ts';

test('a neutral oval and gradient display exactly the renderer weights, including restrictions', () => {
  const oval = createMask('radial', 'oval');
  const gradient = createMask('linear', 'gradient');
  for (const mode of ['intersect', 'subtract'] as const) {
    const limited: Mask = { ...oval, limit: { id: gradient.id, mode } };
    const masks = [limited, gradient];
    const guide = maskCoverageGuide(masks, oval.id, 120, 80)!;
    const expected = effectiveAlpha(limited, masks, 120, 80, { aspect: 80 / 120, view: { x: 0, y: 0, w: 1, h: 1 } });
    const alphaAt = (i: number) => Math.round(expected[i] * (isHatchStripe(i % 120, Math.floor(i / 120)) ? HATCH_ALPHA : TINT_ALPHA));
    assert.deepEqual(Array.from(guide.rgba.filter((_, i) => i % 4 === 3)), Array.from(expected, (_, i) => alphaAt(i)));
    assert.ok(guide.rgba.some((a, i) => i % 4 === 3 && a > 0));
  }
});
test('coverage is hatched, not a colour-only tint: stripes differ in lightness and opacity from the gaps', () => {
  const oval = { ...createMask('radial', 'oval'), feather: 0 } as Mask;
  const guide = maskCoverageGuide([oval], oval.id, 120, 80)!;
  const centre = (40 * 120 + 60) * 4;
  const stripe = isHatchStripe(60, 40) ? centre : centre + 4 * 4;
  const gap = isHatchStripe(60, 40) ? centre + 4 * 4 : centre;
  assert.notEqual(isHatchStripe(60, 40), isHatchStripe(64, 40));
  assert.equal(guide.rgba[stripe + 3], HATCH_ALPHA);
  assert.equal(guide.rgba[gap + 3], TINT_ALPHA);
  assert.ok(guide.rgba[stripe + 1] > guide.rgba[gap + 1] + 100);
  // Outside the oval there is no weight, so neither stripes nor tint.
  assert.equal(guide.rgba[3], 0);
});
test('hidden and missing masks do not show and work is bounded for full-size RAW dimensions', () => {
  const oval = createMask('radial', 'oval');
  assert.equal(maskCoverageGuide([{ ...oval, hidden: true }], oval.id, 8256, 5504), null);
  assert.equal(maskCoverageGuide([oval], 'wrong', 8256, 5504), null);
  assert.equal(maskCoverageGuide([oval], oval.id, 0, 5504), null);
  const guide = maskCoverageGuide([oval], oval.id, 8256, 5504)!;
  assert.equal(guide.width, 384);
  assert.equal(guide.height, 256);
  assert.equal(guide.rgba.length, 384 * 256 * 4);
});

test('the outline guide draws only a line round the mask: white on the edge, a dark ring outside, the inside left clear', () => {
  const mask = { ...createMask('radial', 'o'), cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.25, feather: 0 } as Mask;
  const guide = maskCoverageGuide([mask], 'o', 200, 200, 'outline')!;
  const at = (x: number, y: number) => Array.from(guide.rgba.slice((y * guide.width + x) * 4, (y * guide.width + x) * 4 + 4));
  const cx = Math.round(guide.width / 2);
  // The centre and the far corner are untouched: the photo shows through.
  assert.equal(at(cx, cx)[3], 0);
  assert.equal(at(2, 2)[3], 0);
  // Along the middle row, coming in from the left: first the dark ring, then the white line, then the clear inside.
  const row = Math.round(guide.height / 2);
  let white = -1;
  for (let x = 0; x < guide.width && white < 0; x++) if (at(x, row)[0] === 255 && at(x, row)[3] >= 200) white = x;
  assert.ok(white > 0, 'an edge was drawn');
  let dark = -1;
  for (let x = white - 1; x >= Math.max(0, white - 5) && dark < 0; x--) if (at(x, row)[0] < 60 && at(x, row)[3] >= 150) dark = x;
  assert.ok(dark >= 0, 'a dark ring sits just outside the line');
  assert.equal(at(white + 4, row)[3], 0, 'the inside stays clear');
  // Only a thin line: almost all pixels are clear.
  let painted = 0;
  for (let i = 3; i < guide.rgba.length; i += 4) if (guide.rgba[i] > 0) painted++;
  assert.ok(painted / (guide.width * guide.height) < 0.05, `${painted} painted`);
  // The fill style is unchanged and still the default.
  assert.deepEqual(maskCoverageGuide([mask], 'o', 200, 200), maskCoverageGuide([mask], 'o', 200, 200, 'fill'));
});

test('the outline is drawn finely (up to 1,024 px) and follows a curve smoothly, not in whole-pixel steps', () => {
  // A soft-edged circle stored as a coarse subject grid (the size tap to select keeps): 64 cells across.
  const cells = 64, values: number[] = [];
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    const r = Math.hypot((x + 0.5) / cells - 0.5, (y + 0.5) / cells - 0.5) * cells;
    values.push(Math.max(0, Math.min(1, 0.3 * cells - r + 0.5)));
  }
  const grid = { w: cells, h: cells, data: btoa(String.fromCharCode(...values.map(v => Math.round(v * 255)))) };
  const mask = { ...createMask('radial', 's'), kind: 'subject', grid, framingKey: '', confidence: 'high', strokes: [], feather: 0 } as unknown as Mask;
  const guide = maskCoverageGuide([mask], 's', 2000, 2000, 'outline')!;
  assert.equal(guide.width, 1024);
  // Where the white line is strongest, its distance from the centre stays close to the circle's radius all the way round.
  const radius = 0.3 * guide.width, centre = guide.width / 2;
  let worst = 0, counted = 0;
  for (let y = 0; y < guide.height; y++) for (let x = 0; x < guide.width; x++) {
    const i = (y * guide.width + x) * 4;
    if (guide.rgba[i] !== 255 || guide.rgba[i + 3] < 250) continue;
    counted++;
    worst = Math.max(worst, Math.abs(Math.hypot(x + 0.5 - centre, y + 0.5 - centre) - radius));
  }
  assert.ok(counted > 1000, `${counted} line pixels`);
  // A 64-cell grid shown at 1,024 px is 16 px a cell: a staircase would stray by several pixels.
  assert.ok(worst < 3, `the line strays ${worst.toFixed(2)} px from the curve`);
});

test('guideEdgeFor: the outline is drawn as finely as it is shown, in steps, up to 2K; the fill stays small', async () => {
  const { guideEdgeFor, OUTLINE_EDGE, FILL_EDGE, OUTLINE_EDGE_MAX } = await import('./maskCoverageGuide.ts');
  assert.equal(guideEdgeFor(800, 'outline'), OUTLINE_EDGE);
  assert.equal(guideEdgeFor(1100, 'outline'), 1536);
  assert.equal(guideEdgeFor(1536, 'outline'), 1536);
  assert.equal(guideEdgeFor(8280, 'outline'), OUTLINE_EDGE_MAX);
  assert.equal(guideEdgeFor(Number.NaN, 'outline'), OUTLINE_EDGE);
  assert.equal(guideEdgeFor(5000, 'fill'), FILL_EDGE);
});
