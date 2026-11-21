import assert from 'node:assert/strict';
import test from 'node:test';
import { metadataForExport, NO_EXPORT_METADATA, parseExportMetadataOptions } from './exportMetadataOptions';

test('optional export metadata starts switched off', () => {
  const frame = { subjectNames: ['Kingfisher'], tags: ['Bird'], autoTags: [] };
  assert.equal(metadataForExport(frame, NO_EXPORT_METADATA), null);
  assert.equal(parseExportMetadataOptions({ enabled: 'true' }).enabled, false);
});

test('prefill from confirmed species and manual tags, not automatically suggested guesses', () => {
  const frame = {
    subjectNames: ['Dipper'], tags: ['Dipper', 'Bird', 'Osprey', 'Wetland'], autoTags: ['Osprey'],
  };
  const options = { ...NO_EXPORT_METADATA, enabled: true, title: null, includeKeywords: true };
  const result = metadataForExport(frame, options)!;
  assert.equal(result.title, 'Dipper');
  assert.deepEqual(result.keywords, ['Dipper', 'Bird', 'Wetland']);
  assert.equal((result as unknown as Record<string, unknown>).gps, undefined);
});

test('blank and explicit overrides do not force any private details into export', () => {
  const frame = { subjectNames: ['Bird'], tags: ['Wildlife'], autoTags: [] };
  const options = { ...NO_EXPORT_METADATA, enabled: true, title: '', creator: 'Me', includeKeywords: false, keywords: 'Do not include' };
  assert.deepEqual(metadataForExport(frame, options), {
    title: '', caption: '', creator: 'Me', copyright: '', keywords: [],
  });
});

test('stored presets accept bounded metadata fields without implicit opt-in', () => {
  const result = parseExportMetadataOptions({ enabled: false, title: 't'.repeat(1000), creator: 'C'.repeat(500), includeKeywords: true });
  assert.equal(result.title?.length, 200);
  assert.equal(result.creator.length, 200);
  assert.equal(result.enabled, false);
  assert.equal(parseExportMetadataOptions(null).title, null);
});
