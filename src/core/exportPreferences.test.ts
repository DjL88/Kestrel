import assert from 'node:assert/strict';
import test from 'node:test';
import { readExportPreferences, readExportPresets } from './exportPreferences';
import { NO_OVERLAY, overlayLines } from './exportOverlay';
import { NO_WATERMARK } from './watermark';
import { customFormat } from './exportFormats';
import { stemFor } from './exportNaming';

test('restores supported export options and discards invalid values', () => {
  const options = readExportPreferences({ getItem: () => JSON.stringify({
    fits: { master: 'keep', unknown: 'fill' },
    overrides: { master: { prefix: 'bird_', quality: 2 } },
    turned: { master: true }, bars: 'blur',
  }) });
  assert.deepEqual(options, {
    fits: { master: 'keep' }, overrides: { master: { prefix: 'bird_' } },
    turned: { master: true }, bars: 'blur',
  });
});

test('broken storage leaves export defaults available', () => {
  assert.equal(readExportPreferences({ getItem: () => '{' }).bars, 'white');
});

test('named presets retain unique standard formats and discard duplicate names', () => {
  const presets = readExportPresets({ getItem: () => JSON.stringify([
    { name: ' Delivery ', formats: ['master', 'unknown', 'master'], overrides: { master: { quality: 0.9 } } },
    { name: 'delivery', formats: ['master'] },
    { name: 'Invalid', formats: ['unknown'] },
  ]) });
  assert.equal(presets.length, 1);
  assert.equal(presets[0].name, 'Delivery');
  assert.deepEqual(presets[0].formats, ['master']);
  assert.equal(presets[0].overrides.master.quality, 0.9);
});

test('a complete reusable delivery recipe survives closing and reopening export', () => {
  const recipe = {
    name: 'Wildlife delivery', formats: ['master'], bars: 'blur',
    overlay: { ...NO_OVERLAY, on: true, title: 'Wildlife', location: 'Herefordshire',
      camera: false, lens: false, settings: false, scale: 1.25, shade: 0.4,
      watermark: { ...NO_WATERMARK, on: true, text: 'Dave', font: 'atkinson', tone: 'auto', opacity: 0.85 },
    },
    naming: { name: 'Wildlife', numbers: 'sequence' },
    custom: { width: 2048, height: 1365, format: 'jpeg', fit: 'keep', quality: 93, prefix: 'web_' },
    // None of this photo-specific or permission-bearing state may be restored.
    anchors: { 'private-photo|master': { x: 0.1, y: 0.2 } }, sourcePath: '/private/original.nef',
    timestamp: 'custom', customDate: '2026-11-20',
  };
  const read = () => readExportPresets({ getItem: () => JSON.stringify([recipe]) })[0];
  const preset = read();
  assert.deepEqual(preset.overlay?.watermark, { ...recipe.overlay.watermark, imageData: undefined });
  assert.deepEqual(overlayLines({}, preset.overlay!), ['Wildlife', 'Herefordshire']);
  assert.equal(stemFor(preset.naming!, 'DSC_1234.NEF', 0, 25), 'Wildlife-01');
  assert.deepEqual(customFormat(preset.custom!), { format: {
    id: 'custom', label: 'Custom · 2048 × 1365', width: 2048, height: 1365,
    format: 'jpeg', fit: 'keep', quality: 0.93, prefix: 'web_',
  } });
  for (const key of ['anchors', 'sourcePath', 'timestamp', 'customDate']) assert.equal(key in preset, false);
  preset.overlay!.watermark!.text = 'Changed after applying';
  assert.equal(read().overlay!.watermark!.text, 'Dave', 'applied settings do not mutate saved recipes');
});

test('custom-only presets remain usable and invalid custom sizes cannot be resumed', () => {
  const custom = { width: 1200, height: 800, format: 'png', fit: 'fill', quality: 100, prefix: 'print_' };
  const presets = readExportPresets({ getItem: () => JSON.stringify([
    { name: 'Custom only', formats: [], custom },
    { name: 'Too big', formats: [], custom: { ...custom, width: 99999 } },
    { name: 'Wrong format', formats: [], custom: { ...custom, format: 'svg' } },
    { name: 'Wrong fit', formats: [], custom: { ...custom, fit: 'invent' } },
    { name: 'Still valid standard', formats: ['master'], custom: { ...custom, quality: -3 } },
  ]) });
  assert.deepEqual(presets.map(p => p.name), ['Custom only', 'Still valid standard']);
  assert.deepEqual(presets[0].custom, custom);
  assert.equal(presets[1].custom, undefined);
});

test('legacy presets leave presentation unspecified, while malformed entries do not hide valid ones', () => {
  const presets = readExportPresets({ getItem: () => JSON.stringify([
    null, false, { name: 'Legacy', formats: ['master'] },
    { name: 'Malformed presentation', formats: ['master'], overlay: [], naming: 7 },
  ]) });
  assert.equal(presets.length, 2);
  for (const preset of presets) {
    assert.equal(preset.overlay, undefined);
    assert.equal(preset.naming, undefined);
    assert.equal(preset.custom, undefined);
  }
});

test('restored presentation rejects unsafe artwork, clamps sliders and uses bundled fonts', () => {
  const presets = readExportPresets({ getItem: () => JSON.stringify([
    { name: 'Unsafe', formats: ['master'], overlay: { on: true, scale: 100, shade: -5,
      title: 'a'.repeat(200), watermark: { ...NO_WATERMARK, on: true, kind: 'image',
        imageData: 'data:image/svg+xml;base64,PHN2Zz4=', font: 'arbitrary-css',
      },
    } },
    { name: 'Raster', formats: ['master'], overlay: { watermark: {
      ...NO_WATERMARK, on: true, kind: 'image', imageData: 'data:image/png;base64,iVBORw==',
    } } },
  ]) });
  const overlay = presets[0].overlay!;
  assert.equal(overlay.scale, 1.75);
  assert.equal(overlay.shade, 0);
  assert.equal(overlay.title!.length, 100);
  assert.equal(overlay.watermark!.imageData, undefined);
  assert.equal(overlay.watermark!.on, false);
  assert.equal(overlay.watermark!.font, 'inter');
  assert.equal(presets[1].overlay!.watermark!.imageData, 'data:image/png;base64,iVBORw==');
});
