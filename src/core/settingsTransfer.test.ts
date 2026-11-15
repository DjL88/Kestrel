import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSettingsFile, parseSettingsFile } from './settingsTransfer.ts';

const store: Record<string, string> = {
  'kestrel.preferences.v1': '{"bindings":{}}', 'kestrel-theme-v1': 'dark', 'kestrel.helper.v1': 'SECRET-API-KEY',
  'kestrel.licence.v1': 'KESTREL1.x.y', 'kestrel-project': 'big project data',
};

test('only look-and-feel settings are written, never keys, licences or projects', () => {
  const file = buildSettingsFile((key) => store[key] ?? null, new Date('2026-11-15T10:00:00Z'));
  assert.deepEqual(Object.keys(file.settings).sort(), ['kestrel-theme-v1', 'kestrel.preferences.v1']);
  assert.equal(JSON.stringify(file).includes('SECRET'), false);
});

test('a saved file reads back the same', () => {
  const file = buildSettingsFile((key) => store[key] ?? null, new Date());
  const back = parseSettingsFile(JSON.stringify(file));
  assert.equal(back.ok, true);
  if (back.ok) assert.deepEqual(back.settings, file.settings);
});

test('a hand-edited file cannot smuggle in other keys', () => {
  const evil = JSON.stringify({ format: 'kestrel-settings', version: 1, savedAt: 'x', settings: { 'kestrel.helper.v1': 'x', 'kestrel.licence.v1': 'y', 'kestrel-theme-v1': 'light', 'kestrel-font': 5 } });
  const back = parseSettingsFile(evil);
  assert.equal(back.ok, true);
  if (back.ok) { assert.deepEqual(back.settings, { 'kestrel-theme-v1': 'light' }); assert.equal(back.skipped, 3); }
});

test('wrong files are refused with a plain message', () => {
  for (const text of ['', 'nope', '{}', '{"format":"other","version":1,"settings":{}}', '{"format":"kestrel-settings","version":1,"settings":{}}']) {
    assert.equal(parseSettingsFile(text).ok, false, text);
  }
});
