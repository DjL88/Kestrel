import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PhotoFrame } from './types';
import { parsePhotoSearch, photoSearchableText, retainPhotoSearchEvidence, searchPhotoCollection } from './photoSearch';

const at = (year: number, month: number, day = 15) => Date.UTC(year, month - 1, day, 12);
function photo(id: string, label: string, capturedAtMs?: number): PhotoFrame {
  return {
    id, stableKey: 'folder/' + id, filename: id + '.NEF',
    sequenceIndex: 1, decision: 'unreviewed', burstGroupId: null,
    burstCount: 1, burstIndex: 1, sourceKind: 'file', isDemo: false,
    exif: { capturedAtMs }, tags: label ? [label] : [],
  };
}

test('natural-language May search finds kingfishers across years, with primary before neighbours', () => {
  const april = photo('april', 'Kingfisher', at(2026, 4));
  const may = photo('may', 'Kingfisher', at(2026, 5));
  const june = photo('june', 'Kingfisher', at(2025, 6));
  const other = photo('other', 'Osprey', at(2026, 5));
  const unknownDate = photo('unknown', 'Kingfisher');
  const result = searchPhotoCollection([april, may, june, other, unknownDate], 'Find Kingfisher photos from May');
  assert.deepEqual(result.primary.map((x) => x.id), ['may']);
  assert.deepEqual(result.nearby.map((x) => x.id), ['april', 'june']);
  assert.deepEqual(result.matches.map((x) => x.id), ['may', 'april', 'june']);
  assert.match(result.nearbyMessage ?? '', /not photos from May/);
});

test('May 2025 is year-specific; exact/only suppresses fallback and unknown dates are never guessed', () => {
  const photos = [
    photo('april25', 'Kingfisher', at(2025, 4)),
    photo('may25', 'Kingfisher', at(2025, 5)),
    photo('june26', 'Kingfisher', at(2026, 6)),
    photo('undated', 'Kingfisher'),
  ];
  const normal = searchPhotoCollection(photos, 'Show Kingfisher photos from May 2025');
  assert.deepEqual(normal.matches.map((x) => x.id), ['may25', 'april25']);
  const strict = searchPhotoCollection(photos, 'Show only Kingfisher photos from May 2025');
  assert.deepEqual(strict.matches.map((x) => x.id), ['may25']);
  assert.equal(strict.nearbyMessage, undefined);
});

test('three May matches do not expand; exact month and its boundaries apply per frame', () => {
  const matches = [1, 2, 3].map((n) => photo('may' + n, 'Kingfisher', at(2026, 5, n)));
  const april = photo('april', 'Kingfisher', at(2026, 4));
  const result = searchPhotoCollection([april, ...matches], 'Kingfisher in May');
  assert.equal(result.primary.length, 3);
  assert.equal(result.nearby.length, 0);
  assert.deepEqual(result.matches.map((x) => x.id), ['may1', 'may2', 'may3']);
});

test('nearby spans year boundary for January but not unrelated earlier years', () => {
  const list = [
    photo('dec24', 'Kingfisher', at(2024, 12)),
    photo('jan25', 'Kingfisher', at(2025, 1)),
    photo('feb25', 'Kingfisher', at(2025, 2)),
    photo('dec23', 'Kingfisher', at(2023, 12)),
  ];
  const result = searchPhotoCollection(list, 'Find Kingfisher photos in January 2025');
  assert.deepEqual(result.matches.map((x) => x.id), ['jan25', 'dec24', 'feb25']);
});

test('OCR and corroborated subjects are searchable independently of manual tags; uncertain text is not', () => {
  const f = photo('g-okes', '', at(2026, 5));
  const originalTags = f.tags;
  const indexed = retainPhotoSearchEvidence(f, {
    frameId: f.id, sourceStableKey: f.stableKey, modelRevision: 'local-ocr-v1', indexedAt: 100,
    ocr: [{ value: 'G-OKES', status: 'agreed' }, { value: 'EB 74918', status: 'needs-review' }],
    subjects: [{ value: 'Kingfisher', status: 'supported' }],
  });
  assert.notEqual(indexed, f);
  assert.strictEqual(indexed.tags, originalTags);
  assert.equal(f.searchEvidence, undefined);
  assert.match(photoSearchableText(indexed), /G-OKES/);
  assert.deepEqual(searchPhotoCollection([indexed], 'G-OKES').matches.map((x) => x.id), [f.id]);
  assert.deepEqual(searchPhotoCollection([indexed], 'Kingfisher from May').matches.map((x) => x.id), [f.id]);
  assert.deepEqual(searchPhotoCollection([indexed], 'EB 74918').matches, []);
});

test('stale frame, invalid source digest, removed photo and older scans cannot overwrite an index', () => {
  const current = photo('a', 'Kingfisher', at(2026, 5));
  const checksum = 'b'.repeat(64);
  const receipt = {
    frameId: current.id, sourceStableKey: current.stableKey, sourceSha256: checksum,
    modelRevision: 'local-reader-1', indexedAt: 10,
    ocr: [{ value: 'ring-123', status: 'agreed' as const }],
  };
  assert.strictEqual(retainPhotoSearchEvidence(current, { ...receipt, frameId: 'other' }), current);
  assert.strictEqual(retainPhotoSearchEvidence(current, receipt, 'a'.repeat(64)), current);
  const removed = { ...current, removedAt: 1 };\n  assert.strictEqual(retainPhotoSearchEvidence(removed, receipt), removed);\n  const indexed = retainPhotoSearchEvidence(current, receipt, checksum);\n  assert.strictEqual(retainPhotoSearchEvidence(indexed, { ...receipt, indexedAt: 9 }, checksum), indexed);
});
