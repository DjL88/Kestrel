import assert from 'node:assert/strict';
import test from 'node:test';
import { planConnectedExports, platformExportFolder } from './exportBatchDestinations.ts';
import { EXPORT_FORMATS } from './exportFormats.ts';
import { KEEP_NAMES } from './exportNaming.ts';
import type { PhotoFrame } from './types.ts';

const frame = (name: string, id: string): PhotoFrame => ({
  id, stableKey: id, filename: name, sequenceIndex: 0, decision: 'keep',
  burstGroupId: null, burstIndex: 0, burstCount: 0, exif: {}, isDemo: false, sourceKind: 'file',
});

test('before-and-after saves in its own folder without modifying the original', () => {
  const comparison = EXPORT_FORMATS.find(format => format.id === 'before-after')!;
  assert.equal(platformExportFolder(comparison), 'Before-After');
  const planned = planConnectedExports([frame('Bird.NEF', 'source')], [comparison], KEEP_NAMES);
  assert.deepEqual(planned.map(entry => entry.item.subfolder), ['Before-After']);
  assert.match(planned[0].item.filename, /before-after\.jpg$/);
});

test('social destinations create their own subfolders without collisions', () => {
  const ig = EXPORT_FORMATS.find(f => f.id === 'ig-45')!;
  const fb = EXPORT_FORMATS.find(f => f.id === 'fb-45')!;
  const planned = planConnectedExports([frame('DSC_0001.NEF', 'a'), frame('DSC_0001.NEF', 'b')], [ig, fb], KEEP_NAMES);
  assert.equal(planned.length, 4);
  assert.deepEqual(planned.map(p => p.item.subfolder), ['Instagram', 'Facebook', 'Instagram', 'Facebook']);
  assert.equal(new Set(planned.map(p => p.item.subfolder.toLowerCase() + '/' + p.item.filename.toLowerCase())).size, 4);
  assert.ok(planned.every(p => p.item.filename.endsWith('.jpg')));
});

test('full-size JPEG uses a clear dedicated batch folder', () => {
  const jpeg = EXPORT_FORMATS.find(format => format.id === 'full-jpeg')!;
  const planned = planConnectedExports([frame('DSC_1234.NEF', 'raw')], [jpeg], KEEP_NAMES);
  assert.equal(platformExportFolder(jpeg), 'JPEG');
  assert.deepEqual(planned.map(entry => entry.item.subfolder), ['JPEG']);
  assert.match(planned[0].item.filename, /-preview_kestrel\.jpg$/);
});

test('full-size files use Master while custom goes to Custom', () => {
  assert.equal(platformExportFolder(EXPORT_FORMATS[0]), 'Master');
  assert.equal(platformExportFolder({ id: 'custom' }), 'Custom');
});

test('duplicate export names in one platform get stable numeric suffixes', () => {
  const ig = EXPORT_FORMATS.find(f => f.id === 'ig-45')!;
  const planned = planConnectedExports([frame('Bird.JPG', 'a'), frame('Bird.JPG', 'b')], [ig], KEEP_NAMES);
  assert.match(planned[1].item.filename, /-2\.jpg$/);
  assert.equal(planned[0].item.sourceId, '0:0');
  assert.equal(planned[1].item.sourceId, '1:0');
});

test('no outputs for empty selection', () => {
  assert.deepEqual(planConnectedExports([], [EXPORT_FORMATS[0]], KEEP_NAMES), []);
  assert.deepEqual(planConnectedExports([frame('bird.jpg', 'a')], [], KEEP_NAMES), []);
});
