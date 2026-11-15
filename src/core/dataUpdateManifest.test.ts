import test from 'node:test';
import assert from 'node:assert/strict';
import { dueForDataCheck, parseDataManifest, planDataUpdate } from './dataUpdateManifest';

const sha = 'a'.repeat(64);
const base = { schema: 1, revision: 1, assets: [
  { id: 'equipment', kind: 'equipment', version: '2026.11.1', path: '/data/equipment-1.json', bytes: 1024, sha256: sha },
] };

test('strict manifest accepts immutable bounded data assets', () => {
  const valid = parseDataManifest(base);
  assert.ok(valid);
  assert.equal(valid.assets[0].kind, 'equipment');
});

test('rejects traversal, foreign URLs, duplicates, unknown fields, oversized ONNX and untrusted input', () => {
  assert.equal(parseDataManifest({ ...base, assets: [{ ...base.assets[0], path: '/data/../secret' }] }), null);
  assert.equal(parseDataManifest({ ...base, assets: [{ ...base.assets[0], path: 'https://example.com/model.onnx' }] }), null);
  assert.equal(parseDataManifest({ ...base, assets: [base.assets[0], base.assets[0]] }), null);
  assert.equal(parseDataManifest({ ...base, injected: 'code' }), null);
  assert.equal(parseDataManifest({ ...base, assets: [{ ...base.assets[0], bytes: 257 * 1024 * 1024 }] }), null);
  assert.equal(parseDataManifest({ ...base, assets: [{ ...base.assets[0], sha256: 'bad' }] }), null);
  assert.equal(parseDataManifest({ ...base, revision: 0 }), null);
  assert.equal(parseDataManifest(null), null);
});

test('only a newer manifest plans changed assets', () => {
  const current = parseDataManifest(base)!;
  const next = parseDataManifest({ ...base, revision: 2, assets: [
    { ...base.assets[0], sha256: 'b'.repeat(64), version: '2026.11.2' },
    { id: 'species', kind: 'onnx', version: '1.0', path: '/data/species.onnx', bytes: 100, sha256: sha },
  ] })!;
  assert.equal(planDataUpdate(current, next).length, 2);
  assert.equal(planDataUpdate(current, current).length, 0);
  assert.equal(planDataUpdate(next, current).length, 0);
});

test('background check is quiet offline and limited to once daily', () => {
  const now = Date.UTC(2026, 10, 15);
  assert.equal(dueForDataCheck(null, now, false), false);
  assert.equal(dueForDataCheck(null, now, true), true);
  assert.equal(dueForDataCheck(now - 23 * 60 * 60 * 1000, now, true), false);
  assert.equal(dueForDataCheck(now - 24 * 60 * 60 * 1000, now, true), true);
  assert.equal(dueForDataCheck(now + 1000, now, true), true);
});
