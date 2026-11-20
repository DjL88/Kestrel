import assert from 'node:assert/strict';
import test from 'node:test';
import { LANGUAGES, mergeMessages, missingKeys, unknownKeys } from './locale';
import { AREAS } from '../i18n/areas';

/**
 * Release-facing integrity checks, not a claim of native-speaker approval.
 * Draft languages may be partial; every missing phrase must still resolve to
 * readable British English rather than a blank or a missing key.
 */
function leaves(value: unknown, path = ''): Array<{ path: string; value: unknown }> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, child]) =>
      leaves(child, path ? `${path}.${key}` : key));
  }
  return [{ path, value }];
}

test('every photographer-facing translation area is registered exactly once', () => {
  const names = AREAS.map((area) => area.name);
  assert.deepEqual([...names].sort(), ['app', 'editor', 'export', 'library', 'projects', 'viewer']);
  assert.equal(new Set(names).size, names.length);
});

test('British English is non-empty and every language has safe, correctly shaped area output', () => {
  for (const area of AREAS) {
    const sourceLeaves = leaves(area.source);
    assert.ok(sourceLeaves.length > 0, `${area.name} has no source phrases`);
    for (const { path, value } of sourceLeaves) {
      assert.ok(typeof value === 'string' || typeof value === 'function',
        `${area.name}.${path}: source must be a phrase or formatter`);
      if (typeof value === 'string') assert.ok(value.trim(), `${area.name}.${path}: blank source`);
    }

    for (const { code } of LANGUAGES) {
      const translation = area.translations[code];
      assert.deepEqual(unknownKeys(area.source, translation), [],
        `${area.name}/${code}: unknown or wrongly typed translation keys`);
      const resolved = mergeMessages(area.source as never, translation as never) as unknown;
      const resolvedLeaves = leaves(resolved);
      assert.deepEqual(resolvedLeaves.map((item) => item.path), sourceLeaves.map((item) => item.path),
        `${area.name}/${code}: fallback changed the message structure`);
      for (const { path, value } of resolvedLeaves) {
        assert.equal(typeof value, typeof sourceLeaves.find((item) => item.path === path)?.value,
          `${area.name}/${code}/${path}: fallback changed the phrase type`);
        if (typeof value === 'string') assert.ok(value.trim(),
          `${area.name}/${code}/${path}: blank translated or fallback phrase`);
      }
    }
  }
});

test('coverage is measurable and draft languages are never mistaken for fully approved', () => {
  for (const area of AREAS) {
    for (const { code, status } of LANGUAGES) {
      const missing = missingKeys(area.source, area.translations[code]);
      assert.ok(Array.isArray(missing), `${area.name}/${code}: coverage not measurable`);
      assert.ok(missing.every((key) => typeof key === 'string' && key.length > 0));
      // Native-language approval is a separate human review gate, not inferred
      // from a zero missing-key count. Draft status must remain explicit.
      if (code !== 'en-GB' && status !== 'draft') {
        assert.ok(status === 'ready', `${code}: unexpected release status`);
      }
    }
  }
});

test('blank translations fall back instead of masquerading as translated content', () => {
  const source = { heading: 'Photo library', nested: { decision: 'Undecided' } };
  const translated = { heading: '   ', nested: { decision: '' } };
  assert.deepEqual(mergeMessages(source, translated), source);
});
