import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEditDeltas } from './autoDiff';
import { computeClippingOverlay } from './clippingOverlay';
import { buildXmpSidecar } from './xmpSidecar';
import { DEFAULT_EDIT } from './photoEdits';
import { createSubjectMask } from './maskTypes';

test('computeClippingOverlay counts highlight, shadow, and single-channel clips accurately and paints warnings', () => {
  const src = new Uint8ClampedArray([
    255, 255, 255, 255, // pure white clip
    0, 0, 1, 255,       // shadow crush
    255, 110, 40, 255,  // red single-channel clip
    120, 130, 140, 255, // safe midtone
  ]);
  const overlay = new Uint8ClampedArray(src.length);
  const summary = computeClippingOverlay(src, overlay);
  assert.deepEqual(summary, {
    highlightPixels: 1,
    shadowPixels: 1,
    channelPixels: 1,
    totalPixels: 4,
  });
  assert.equal(overlay[0], 239);  // red marker
  assert.equal(overlay[6], 246);  // blue marker
  assert.equal(overlay[8], 245);  // amber marker
  assert.equal(overlay[15], 0);   // untouched midtone alpha 0
});

test('computeEditDeltas returns transparent before/after strings for numeric sliders and subject masks', () => {
  const before = { ...DEFAULT_EDIT, exposure: 0, tint: 0 };
  const mask = createSubjectMask('subject', { w: 4, h: 4, data: 'AAAAAA==' }, 'framing', 'high');
  const after = {
    ...DEFAULT_EDIT,
    exposure: 1,
    tint: 0.5,
    colour: -2,
    masks: [mask],
  };
  const deltas = computeEditDeltas(before, after);
  assert.deepEqual(
    deltas.map((d) => d.key),
    ['exposure', 'tint', 'colour', 'subjectMask'],
  );
  assert.equal(deltas[0].afterText, '+0.40 EV');
  assert.equal(deltas[1].afterText, '+4%');
  assert.equal(deltas[2].afterText, 'Mono');
  assert.equal(deltas[3].afterText, '1 (+1)');
});

test('buildXmpSidecar generates valid escaped XML with Camera Raw attributes, tags, and lossless Kestrel recipe', () => {
  const xml = buildXmpSidecar({
    filename: 'DSC_0042.NEF',
    decision: 'keep',
    rating: 5,
    tags: ['Kestrel & Hawk', 'Flight <2026>'],
    subjectNames: ['Common Kestrel'],
    edit: { ...DEFAULT_EDIT, exposure: 1, tint: -0.5, contrast: 0.6 },
    framing: { ratio: 16 / 9, turns: 0, x: 0.5, y: 0.5, size: 0.85, straighten: -1.25 },
  });
  assert.ok(xml.startsWith('<?xpacket begin='));
  assert.ok(xml.includes('xmp:Rating="5"'));
  assert.ok(xml.includes('xmp:Label="Green"'));
  assert.ok(xml.includes('crs:Exposure2012="0.40"'));
  assert.ok(xml.includes('crs:Tint="-25"'));
  assert.ok(xml.includes('crs:HasCrop="True"'));
  assert.ok(xml.includes('Kestrel &amp; Hawk'));
  assert.ok(xml.includes('Flight &lt;2026&gt;'));
  assert.ok(xml.includes('Common Kestrel'));
  assert.ok(xml.includes('kestrel:RecipeJson="'));
});
