import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PhotoFrame } from './types';
import { localSearchPrompts } from './localSearchPrompts';
import { parsePhotoSearch, searchPhotoCollection } from './photoSearch';

function frame(id: string, date: string | undefined, name: string, tags: string[] = [], autoTags: string[] = []): PhotoFrame {
  return {
    id, stableKey: 'original/' + id, filename: id + '.NEF', sequenceIndex: 1,
    decision: 'unreviewed', burstGroupId: null, burstIndex: 1, burstCount: 1,
    sourceKind: 'file', isDemo: false,
    exif: { capturedAtMs: date ? Date.parse(date) : undefined },
    subjectNames: name ? [name] : [], tags, autoTags,
  };
}

test('spring and winter phrases search the right photos offline, without nearby-month fallbacks', () => {
  const photos = [
    frame('mar', '2026-03-05T12:00:00Z', 'Kestrel'),
    frame('may', '2025-05-01T12:00:00Z', 'Kestrel'),
    frame('jun', '2026-06-01T12:00:00Z', 'Kestrel'),
    frame('dec', '2026-12-02T12:00:00Z', 'Robin'),
    frame('jan', '2027-01-12T12:00:00Z', 'Robin'),
    frame('feb', '2026-02-04T12:00:00Z', 'Robin'),
  ];
  assert.deepEqual(searchPhotoCollection(photos, 'Kestrel in spring').matches.map(p=>p.id), ['mar', 'may']);
  assert.deepEqual(searchPhotoCollection(photos, 'Robin in winter 2026').matches.map(p=>p.id), ['dec', 'jan']);
  assert.deepEqual(parsePhotoSearch('Kestrel in spring 2026').terms, ['kestrel']);
  assert.equal(parsePhotoSearch('Kestrel in spring 2026').season, 'spring');
  assert.equal(parsePhotoSearch('photos that may contain birds').month, undefined);
});

test('actual subject and capture month create backed search suggestions', () => {
  const frames = [frame('k', '2026-04-02T00:00:00Z', 'Kestrel'), frame('r', '2026-01-12T00:00:00Z', 'Robin', ['snow'])];
  const prompts = localSearchPrompts(frames);
  assert.ok(prompts.some(p=>p.label === 'Kestrel in spring'));
  assert.ok(prompts.some(p=>p.label === 'Robin in the snow'));
  for (const prompt of prompts) assert.ok(searchPhotoCollection(frames, prompt.query, 0).primary.length > 0);
});

test('snow is never inferred just from a winter month or unconfirmed auto-tags', () => {
  const frames = [frame('r', '2026-01-12T00:00:00Z', 'Robin', ['snow'], ['snow'])];
  assert.ok(localSearchPrompts(frames).some(p=>p.label === 'Robin in winter'));
  assert.ok(!localSearchPrompts(frames).some(p=>p.label === 'Robin in the snow'));
});

test('removed, undated, unknown and OCR-only identities do not fabricate subject/season prompts', () => {
  const removed = { ...frame('r', '2026-04-01T00:00:00Z', 'Coco'), removedAt: 1 };
  const undated = frame('u', undefined, 'Coco');
  const named = frame('n', '2026-04-01T00:00:00Z', '');
  named.searchEvidence = { schema: 1, sourceStableKey: named.stableKey, modelRevision: 'local', indexedAt: 1,
    ocr: [{ value: 'Private plate', status: 'confirmed' }], subjects: [{ value: 'Uncertain bird', status: 'needs-review' }] };
  assert.deepEqual(localSearchPrompts([removed, undated, named]), []);
});

test('maximum suggestions and stability are deterministic', () => {
  const frames = Array.from({ length: 20 }, (_, i) => frame('k' + i, '2026-04-02T00:00:00Z', 'Pet' + i));
  const first = localSearchPrompts(frames, 3);
  assert.equal(first.length, 3);
  assert.deepEqual(first, localSearchPrompts(frames, 3));
  assert.deepEqual(localSearchPrompts(frames, 0), []);
});

test('confirmed local subject evidence may suggest a prompt, but OCR alone never does', () => {
  const f = frame('bird', '2026-04-04T00:00:00Z', '');
  f.searchEvidence = { schema:1, sourceStableKey:f.stableKey, modelRevision:'local', indexedAt:1,
    ocr:[{ value:'G-ABCD', status:'confirmed' }], subjects:[{ value:'Kingfisher', status:'supported' }] };
  const labels = localSearchPrompts([f]).map(p=>p.label);
  assert.ok(labels.includes('Kingfisher in spring'));
  assert.ok(!labels.some(label=>label.includes('G-ABCD')));
});
