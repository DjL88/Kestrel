import assert from 'node:assert/strict';
import test from 'node:test';
import { planExport, type ExportJob } from './exportOps.ts';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { DEFAULT_CROP } from './cropOps.ts';
import type { ExportRequest, SizePreset } from '../ui/contract.ts';

/**
 * G09 parity: the same settings plan the same output, whichever way the export is reached. Every route (the wizard, its
 * destinations and any later quick export or saved preset) ends in planExport, so a difference here would be a difference
 * in the files. The browser test tests/v2-export-parity.spec.ts checks the rendered bytes.
 */
const size = (id: string, over: Partial<SizePreset> = {}): SizePreset => ({ id, label: id, platform: 'instagram', width: 1080, height: 1350, ratioLabel: '4:5', kind: 'photo', enabled: true, linked: true, crop: { ...DEFAULT_CROP }, boardX: 0, boardY: 0, ...over });
const sizes = [size('a'), size('b', { width: 1200, height: 628, ratioLabel: '1.91:1' }), size('c', { width: 2000, height: 2000, ratioLabel: '1:1' })];
const edit = { ...DEFAULT_EDIT, exposure: 0.5 };
const frames = [
  { id: 'p1', filename: 'one.jpg', edit, sizeCrops: { b: { ...DEFAULT_CROP, panX: 12, zoom: 1.4 } } },
  { id: 'p2', filename: 'two.jpg' },
];
const request = (over: Partial<ExportRequest> = {}): ExportRequest => ({
  destination: 'local-zip', fileFormat: 'jpeg', jpegQuality: 0.9, groupIds: [], sizeIds: ['a', 'b', 'c'],
  includeBefore: false, includeAfter: true, includeOverlay: true, includeWatermark: true, includeVideo: false,
  photoIds: ['p1', 'p2'], ...over,
});
function jobs(over: Partial<ExportRequest> = {}): ExportJob[] {
  const plan = planExport(request(over), frames, sizes);
  assert.ok('jobs' in plan, 'error' in plan ? plan.error : '');
  return plan.jobs;
}
const key = (job: ExportJob) => `${job.frameId}/${job.format.id}`;
const byKey = (list: ExportJob[]) => new Map(list.map((job) => [key(job), job]));

test('a ZIP, separate files and a desktop folder plan exactly the same files', () => {
  const zip = jobs({ destination: 'local-zip' });
  assert.deepEqual(jobs({ destination: 'local-individual' }), zip);
  assert.deepEqual(jobs({ destination: 'local-folder' }), zip);
});

test('a format plans the same whether it is exported alone or with other formats, in any order', () => {
  const all = byKey(jobs());
  for (const id of ['a', 'b', 'c']) {
    for (const job of jobs({ sizeIds: [id] })) assert.deepEqual(job, all.get(key(job)), `${key(job)} alone`);
  }
  assert.deepEqual(byKey(jobs({ sizeIds: ['c', 'a', 'b'] })), all);
});

test('a photo plans the same whether it is exported alone or with others', () => {
  const all = byKey(jobs());
  for (const job of jobs({ photoIds: ['p1'] })) assert.deepEqual(job, all.get(key(job)));
  for (const job of jobs({ photoIds: ['p2'] })) assert.deepEqual(job, all.get(key(job)));
});

test('adding the unedited version does not change the edited one', () => {
  const edited = byKey(jobs());
  for (const job of jobs({ includeBefore: true })) {
    const alone = edited.get(key(job))!;
    assert.deepEqual(job.variants.find((v) => v.kind === 'edited'), alone.variants[0]);
    assert.deepEqual(job.variants.find((v) => v.kind === 'unedited')?.edit, DEFAULT_EDIT, 'the unedited version is the photo with no edit');
    assert.deepEqual({ ...job, variants: [] }, { ...alone, variants: [] });
  }
});

test('JPEG and PNG plan the same pixels: only the encoder and its quality differ', () => {
  const jpeg = jobs({ fileFormat: 'jpeg', jpegQuality: 0.9 });
  const png = jobs({ fileFormat: 'png' });
  assert.equal(png.length, jpeg.length);
  png.forEach((job, index) => {
    assert.equal(job.format.format, 'png');
    assert.equal(job.format.quality, 1);
    const strip = (j: ExportJob) => ({ ...j, format: { ...j.format, format: 'x', quality: 0 } });
    assert.deepEqual(strip(job), strip(jpeg[index]));
  });
});

test('each photo keeps its own crop for a format and the saved edit is the one exported', () => {
  const p1b = jobs().find((job) => key(job) === 'p1/b')!;
  assert.equal(p1b.crop.panX, 12);
  assert.equal(p1b.crop.zoom, 1.4);
  assert.deepEqual(jobs().find((job) => key(job) === 'p2/b')!.crop, { ...DEFAULT_CROP });
  assert.equal(p1b.variants[0].edit.exposure, 0.5);
});

test('planning the same settings twice gives the same plan, and planning does not change the request', () => {
  const settings = request();
  const frozen = structuredClone(settings);
  const first = planExport(settings, frames, sizes);
  assert.deepEqual(planExport(settings, frames, sizes), first);
  assert.deepEqual(settings, frozen);
});
