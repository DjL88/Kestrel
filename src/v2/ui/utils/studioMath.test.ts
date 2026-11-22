import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHistogramData,
  buildPreviewFilterCss,
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

