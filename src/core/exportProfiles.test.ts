import test from 'node:test';
import assert from 'node:assert/strict';
import exifr from 'exifr';
import { unzipSync } from 'fflate';
import { archiveExports } from '../providers/browserExport';
import { EXPORT_PROFILES, exportFilename, exportScale } from './exportProfiles';
import { datedExport } from './exportTimestamp';

test('social export fits the maximum without stretching or upscaling', () => {
  const instagram = EXPORT_PROFILES.find((profile) => profile.id === 'ig')!;
  assert.equal(exportScale(6000, 4000, instagram), 1080 / 6000);
  assert.equal(exportScale(4000, 6000, instagram), 1440 / 6000);
  assert.equal(exportScale(500, 500, instagram), 1);
  assert.equal(exportScale(8000, 6500, EXPORT_PROFILES[0]), 1);
  assert.equal(exportFilename('DSC_1253.NEF', instagram, true), 'ig_DSC_1253-preview.jpg');
});

test('embedded timestamp is readable and ZIP retains files with duplicate names', async () => {
  const date = new Date('2026-11-15T08:25:40Z');
  const jpeg = new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' });
  const file = datedExport(jpeg, 'ig_example.jpg', date);
  assert.equal(file.lastModified, date.getTime());
  const metadata = await exifr.parse(Buffer.from(await file.arrayBuffer()), { reviveValues: false });
  assert.equal(metadata.DateTimeOriginal, '2026:11:15 08:25:40');
  const archive = await archiveExports([file, file]);
  const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  assert.deepEqual(Object.keys(entries), ['ig_example.jpg', 'ig_example-2.jpg']);
  assert.deepEqual(entries['ig_example.jpg'], new Uint8Array(await file.arrayBuffer()));
});
