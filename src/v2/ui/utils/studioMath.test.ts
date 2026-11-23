import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fitOverlayRows,
  rowWidthPercent,
  effectiveOutputSize,
  buildHistogramData,
  buildPreviewFilterCss,
  cropPanLimits,
  computeMultiSelection,
  detectOverlayOverflow,
  filterPhotos,
  formatOverlayRowText,
  resolveEffectiveRecipe,
  snapOverlayPosition,
} from './studioMath';
import type { EditRecipe, LookPreset, OverlaySettings, Photo, SizePreset } from '../contract';

const baseRecipe: EditRecipe = {
  lookId: 'natural',
  exposure: 0,
  highlights: 0,
  shadows: 0,
  contrast: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  clarity: 0,
  sharpen: 15,
  denoiseRawAi: true,
  denoiseLuminance: 12,
  denoiseColour: 10,
  upscaleFactor: 1,
  detailRecovery: 20,
  lensCorrection: true,
};

const mockSizePortrait: SizePreset = {
  id: 'ig-portrait',
  label: 'Instagram Portrait',
  platform: 'instagram',
  width: 1080,
  height: 1350,
  ratioLabel: '4:5',
  kind: 'photo',
  enabled: true,
  linked: true,
  crop: {
    zoom: 1,
    panX: 0,
    panY: 0,
    insetTop: 0,
    insetRight: 0,
    insetBottom: 0,
    insetLeft: 0,
    flipH: false,
    flipV: false,
    rotateDeg: 0,
  },
  boardX: 0,
  boardY: 0,
};

const mockPhoto: Photo = {
  id: 'p1',
  filename: 'KST_0101.ARW',
  title: 'Highland Kestrel',
  previewUrl: '/v2-sample/kestrel.jpg',
  thumbUrl: '/v2-sample/kestrel.jpg',
  state: 'ready',
  decision: 'keep',
  originalConnected: true,
  rating: 5,
  speciesLabel: 'Common Kestrel',
  category: 'Wildlife',
  sharpnessScore: 96,
  exif: {
    camera: 'Sony A7 IV',
    lens: 'FE 200-600mm f/5.6-6.3 G',
    aperture: 'f/6.3',
    shutter: '1/2000s',
    iso: 800,
    focalLength: '600mm',
    capturedAt: '14 Oct 2026 · 07:42',
    fileFormat: '16-bit ARW',
    fileSizeMb: 44.2,
    dimensions: '7008 × 4672',
    colourProfile: 'Display P3',
  },
  activeGroupId: 'g1',
  editGroups: [],
  sizes: [mockSizePortrait],
  videoZoom: { enabled: false, focalX: 50, focalY: 50, direction: 'in', durationSec: 5 },
  masks: [],
  assistCritique: {
    subjectNote: 'Sharp eye lock.',
    colourConfidence: 'Neutral daylight.',
    kelvinEstimate: '5400K',
    suggestions: [],
  },
};

test('buildPreviewFilterCss handles ±5 EV exposure safely within bounds', () => {
  const bright = buildPreviewFilterCss({ ...baseRecipe, exposure: 5 });
  const dark = buildPreviewFilterCss({ ...baseRecipe, exposure: -5 });
  assert.match(bright, /brightness\(2\.400\)/);
  assert.match(dark, /brightness\(0\.379\)/);
});

test('resolveEffectiveRecipe merges hovered look delta without mutating base', () => {
  const look: LookPreset = {
    id: 'warm-heather',
    name: 'Warm Heather',
    category: 'Editorial',
    description: 'Golden warmth',
    previewFilter: '',
    recipeDelta: { temperature: 22, contrast: 14 },
  };
  const merged = resolveEffectiveRecipe(baseRecipe, look);
  assert.equal(merged.temperature, 22);
  assert.equal(merged.contrast, 14);
  assert.equal(baseRecipe.temperature, 0);
});

test('formatOverlayRowText composes EXIF fields cleanly', () => {
  const text = formatOverlayRowText(
    {
      id: 'r1',
      fields: ['camera', 'lens'],
      customText: '',
      fontId: 'jakarta',
      sizePx: 14,
      weight: 600,
      uppercase: false,
      letterSpacing: 0,
    },
    mockPhoto
  );
  assert.equal(text, 'Sony A7 IV  ·  FE 200-600mm f/5.6-6.3 G');
});

test('detectOverlayOverflow flags narrow formats when font size is oversized', () => {
  const overlay: OverlaySettings = {
    textEnabled: true,
    textLayoutMode: 'as-is',
    textPosition: 'bottom-left',
    textX: 8,
    textY: 90,
    textOffsetX: 0,
    textOffsetY: 0,
    textColour: 'light',
    textScrim: true,
    rows: [
      {
        id: 'r1',
        fields: ['camera', 'lens', 'species'],
        customText: '',
        fontId: 'jakarta',
        sizePx: 36,
        weight: 700,
        uppercase: true,
        letterSpacing: 2,
      },
    ],
    watermarkEnabled: false,
    watermarkPresetId: 'wm-1',
    watermarkPosition: 'bottom-right',
    watermarkX: 92,
    watermarkY: 90,
    watermarkOpacity: 75,
    watermarkScale: 100,
    watermarkContrast: 'light-on-dark',
    snapEnabled: true,
  };

  const issues = detectOverlayOverflow(overlay, mockPhoto, [mockSizePortrait]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].sizeId, 'ig-portrait');
});

test('computeMultiSelection handles ctrl toggle and shift range', () => {
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const range = computeMultiSelection(ids, ['p2'], 'p2', 'p4', { shift: true });
  assert.deepEqual(range, ['p2', 'p3', 'p4']);

  const toggled = computeMultiSelection(ids, ['p2', 'p3'], 'p2', 'p3', { ctrl: true });
  assert.deepEqual(toggled, ['p2']);
});

test('filterPhotos filters by flagged state and species/camera query', () => {
  const p2: Photo = { ...mockPhoto, id: 'p2', decision: 'unreviewed', speciesLabel: 'Red Deer' };
  assert.equal(filterPhotos([mockPhoto, p2], 'flagged', '').length, 1);
  assert.equal(filterPhotos([mockPhoto, p2], 'all', 'deer').length, 1);
  assert.equal(filterPhotos([mockPhoto, p2], 'all', 'sony').length, 2);
});

test('snapOverlayPosition aligns to peer overlay baseline and mirrored margin', () => {
  const snapped = snapOverlayPosition(90.5, 89.2, { x: 8, y: 90, visible: true }, true);
  assert.equal(snapped.x, 92);
  assert.equal(snapped.y, 90);
  assert.equal(snapped.guides.length, 2);
});

test('buildHistogramData returns 32 bounded RGB + luma bins', () => {
  const hist = buildHistogramData({ ...baseRecipe, exposure: 1.5, temperature: 25 }, 2);
  assert.equal(hist.luma.length, 32);
  assert.equal(hist.red.length, 32);
  assert.ok(hist.luma.every((v) => v >= 0 && v <= 100));
});


test('a format is capped at the picture\'s own pixels, never enlarged', () => {
  const capped = effectiveOutputSize({ width: 3000, height: 2000 }, { width: 1500, height: 1000 });
  assert.deepEqual([capped.width, capped.height, capped.capped], [1500, 1000, true]);
  assert.deepEqual([capped.requestedWidth, capped.requestedHeight], [3000, 2000]);
  const fits = effectiveOutputSize({ width: 1080, height: 1350 }, { width: 6000, height: 4000 });
  assert.deepEqual([fits.width, fits.height, fits.capped], [1080, 1350, false]);
});

test('a different shape uses only the part of the picture it shows', () => {
  // A 4:5 portrait cut from a 3:2 picture 6000 x 4000 can be at most 3200 x 4000, so 2000 x 2500 is fine but 4000 x 5000 is not.
  assert.equal(effectiveOutputSize({ width: 2000, height: 2500 }, { width: 6000, height: 4000 }).capped, false);
  const portrait = effectiveOutputSize({ width: 4000, height: 5000 }, { width: 6000, height: 4000 });
  assert.deepEqual([portrait.width, portrait.height, portrait.capped], [3200, 4000, true]);
});

test('crop zoom and insets use up pixels, and an unknown picture size caps nothing', () => {
  const zoomed = effectiveOutputSize({ width: 3000, height: 2000, crop: { zoom: 2, insetTop: 0, insetRight: 0, insetBottom: 0, insetLeft: 0 } }, { width: 6000, height: 4000 });
  assert.deepEqual([zoomed.width, zoomed.height, zoomed.capped], [3000, 2000, false]);
  const tight = effectiveOutputSize({ width: 3000, height: 2000, crop: { zoom: 3, insetTop: 0, insetRight: 0, insetBottom: 0, insetLeft: 0 } }, { width: 6000, height: 4000 });
  assert.deepEqual([tight.width, tight.height, tight.capped], [2000, 1333, true]);
  assert.equal(effectiveOutputSize({ width: 3000, height: 2000 }, undefined).capped, false);
  assert.equal(effectiveOutputSize({ width: 3000, height: 2000 }, { width: 0, height: 0 }).capped, false);
});

test('with the box size known, the centre, the edges and the gap to the other overlay all snap exactly', () => {
  const geometry = { box: { w: 40, h: 10 }, peer: { left: 8, right: 48, top: 80, bottom: 90 }, gap: { x: 1.5, y: 2 } };
  // The stored position is always the centre of the box.
  assert.equal(snapOverlayPosition(49, 30, { x: 0, y: 0, visible: false }, true, 3.2, geometry).x, 50);
  // Left safe edge: 8% + half the 40%-wide box = centre at 28%.
  const left = snapOverlayPosition(27, 30, { x: 0, y: 0, visible: false }, true, 3.2, geometry);
  assert.equal(left.x, 28);
  assert.equal(left.x - geometry.box.w / 2, 8);
  assert.ok(left.guides.some((guide) => guide.label === 'Left margin'));
  // Bottom edge sits 2% above the peer's top at 80%: centre = 80 - 2 - 10/2 = 73%.
  const above = snapOverlayPosition(30, 74.5, { x: 0, y: 0, visible: false }, true, 3.2, geometry);
  assert.equal(above.y, 73);
  assert.equal(above.y + geometry.box.h / 2, 78);
  assert.ok(above.guides.some((guide) => guide.label === 'Space above'));
  // Without geometry the old snapping is unchanged.
  assert.equal(snapOverlayPosition(49, 30, { x: 0, y: 0, visible: false }, true).x, 50);
});

test('overflow is judged on the share of the frame, so a normal text row is not flagged on a narrow format', () => {
  const row = { id: 'r', fields: ['camera'] as const, customText: 'Sony A7 IV · FE 200–600mm f/5.6–6.3 G', fontId: 'jakarta', sizePx: 14, weight: 600 as const, uppercase: false, letterSpacing: 0.2 };
  const share = rowWidthPercent({ ...row, fields: ['custom'] }, row.customText);
  assert.ok(share > 30 && share < 60, `share was ${share}`);
  assert.ok(rowWidthPercent({ ...row, sizePx: 40, fields: ['custom'] }, row.customText) > 84, 'a very large size does overflow');
});

test('fitting scales every row together, just enough, and leaves text that already fits alone', () => {
  const base = { fields: ['custom'] as const, customText: 'A fairly long caption for this photograph', fontId: 'jakarta', weight: 500 as const, uppercase: false, letterSpacing: 0 };
  const overlay = { textLayoutMode: 'as-is', textOffsetX: 0, rows: [{ ...base, id: 'a', sizePx: 40 }, { ...base, id: 'b', sizePx: 20 }] } as never;
  const photo = {} as never;
  const fitted = fitOverlayRows(overlay, photo);
  assert.ok(fitted[0].sizePx < 40 && fitted[1].sizePx < 20);
  assert.ok(Math.abs(fitted[0].sizePx / fitted[1].sizePx - 2) < 0.2, 'the rows keep their proportions');
  const small = { textLayoutMode: 'as-is', textOffsetX: 0, rows: [{ ...base, id: 'a', sizePx: 12 }] } as never;
  assert.equal(fitOverlayRows(small, photo)[0].sizePx, 12);
});

test('crop pan bounds use each format aspect rather than the active format', () => {
  const source = { width: 6000, height: 4000 };
  const landscape = cropPanLimits(source, { width: 3000, height: 2000 }, 1);
  const portrait = cropPanLimits(source, { width: 1080, height: 1350 }, 1);
  assert.deepEqual(landscape, { x: 0, y: 0 });
  assert.ok(portrait.x > 0);
  assert.equal(portrait.y, 0);
  assert.deepEqual(cropPanLimits(source, { width: 1080, height: 1350 }, 2), {
    x: ((1.5 / 0.8) * 2 - 1) * 50,
    y: 50,
  });
});

test('crop pan bounds reject invalid zoom and missing source dimensions safely', () => {
  const bounds = cropPanLimits(undefined, { width: 1500, height: 1000 }, Number.NaN);
  assert.deepEqual(bounds, { x: 0, y: 0 });
  const invalid = cropPanLimits({ width: 0, height: 0 }, { width: 0, height: 0 }, -10);
  assert.ok(Number.isFinite(invalid.x) && Number.isFinite(invalid.y));
});


test('overlay centre anchor stays continuous across 35% and 65% while dragging', () => {
  const geometry = { box: { w: 20, h: 10 }, peer: null, gap: { x: 1, y: 1 } };
  for (const x of [34.9, 35, 35.1, 64.9, 65, 65.1]) {
    const position = snapOverlayPosition(x, 42, { x: 50, y: 50, visible: false }, false, 3.2, geometry);
    assert.equal(position.x, Number(x.toFixed(1)));
    // A fixed centre anchor gives continuous left and right edges.
    assert.equal(Number((position.x - geometry.box.w / 2).toFixed(1)), Number((x - 10).toFixed(1)));
  }
});

test('overlay geometry snaps the box centre to its safe left and right edges', () => {
  const geometry = { box: { w: 20, h: 10 }, peer: null, gap: { x: 1, y: 1 } };
  const left = snapOverlayPosition(17, 42, { x: 50, y: 50, visible: false }, true, 3.2, geometry);
  const right = snapOverlayPosition(83, 42, { x: 50, y: 50, visible: false }, true, 3.2, geometry);
  assert.equal(left.x, 18); // left edge = 8
  assert.equal(right.x, 82); // right edge = 92
  assert.ok(left.guides.some((guide) => guide.label === 'Left margin'));
  assert.ok(right.guides.some((guide) => guide.label === 'Right margin'));
});
