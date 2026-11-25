import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_EXPORT_SETTINGS, EXPORT_PRESETS_KEY_V2, LAST_EXPORT_KEY_V2, MAX_PRESETS, deletePreset, exportTargetFor,
  parseExportSettings, readLastExport, readPresets, requestFromSettings, savePreset, writeLastExport, writePresets,
  type ExportSettings,
} from './exportSettings.ts';
import { planExport } from './exportOps.ts';
import { DEFAULT_CROP } from './cropOps.ts';
import type { SizePreset } from '../ui/contract.ts';

const size = (id: string, over: Partial<SizePreset> = {}): SizePreset => ({ id, label: id, platform: 'instagram', width: 1080, height: 1350, ratioLabel: '4:5', kind: 'photo', enabled: true, linked: true, crop: { ...DEFAULT_CROP }, boardX: 0, boardY: 0, ...over });
const sizes = [size('a'), size('b', { width: 1200, height: 628 }), size('off', { enabled: false }), size('vid', { kind: 'video' })];
const photo = { id: 'p1', activeGroupId: 'g1', sizes };
const frames = [{ id: 'p1', filename: 'one.jpg' }, { id: 'p2', filename: 'two.jpg' }];
const settings: ExportSettings = { ...DEFAULT_EXPORT_SETTINGS, fileFormat: 'jpeg', jpegQuality: 80, maxSize: '2560', sizeIds: ['b'], includeBefore: true };

function memoryStorage() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
}

test('the wizard, a saved preset and Export again make the same request and the same plan from the same settings', () => {
  const storage = memoryStorage();
  const target = exportTargetFor(photo, ['p1', 'p2'], false);
  const wizard = requestFromSettings(settings, target);
  // Saved as a preset and read back.
  const saved = savePreset([], 'Web', settings, () => 'id1');
  assert.ok('presets' in saved);
  writePresets(storage, saved.presets);
  const preset = requestFromSettings(readPresets(storage)[0].settings, target);
  // Remembered as the last export and replayed.
  writeLastExport(storage, settings);
  const quick = requestFromSettings(readLastExport(storage)!, target);
  assert.deepEqual(preset, wizard);
  assert.deepEqual(quick, wizard);
  const plan = planExport(wizard, frames, sizes);
  assert.ok('jobs' in plan);
  assert.deepEqual(planExport(preset, frames, sizes), plan);
  assert.deepEqual(planExport(quick, frames, sizes), plan);
});

test('the request carries the settings exactly', () => {
  const request = requestFromSettings(settings, exportTargetFor(photo, [], false));
  assert.equal(request.jpegQuality, 0.8);
  assert.equal(request.maxLongestEdgePx, 2560);
  assert.deepEqual(request.sizeIds, ['b']);
  assert.deepEqual(request.photoIds, ['p1'], 'no selection exports the photo on screen');
  assert.deepEqual(request.groupIds, ['g1'], 'one photo exports its active edit group');
  assert.equal(request.includeBefore, true);
  assert.equal(request.includeOverlay, true);
  assert.equal(request.includeWatermark, true);
  assert.equal(requestFromSettings({ ...settings, maxSize: 'full' }, exportTargetFor(photo, [], false)).maxLongestEdgePx, undefined);
  assert.equal(requestFromSettings({ ...settings, maxSize: 'custom', customMaxSize: 777 }, exportTargetFor(photo, [], false)).maxLongestEdgePx, 777);
  assert.deepEqual(requestFromSettings(settings, exportTargetFor(photo, ['p1', 'p2'], false)).groupIds, [], 'a batch uses each photo’s active group');
});

test('"every format" follows what is switched on for the photo; a saved list keeps only formats still switched on', () => {
  const all = requestFromSettings({ ...settings, sizeIds: null }, exportTargetFor(photo, [], false));
  assert.deepEqual(all.sizeIds, ['a', 'b'], 'switched-off and video formats are not exported');
  const stale = requestFromSettings({ ...settings, sizeIds: ['off', 'gone', 'a'] }, exportTargetFor(photo, [], false));
  assert.deepEqual(stale.sizeIds, ['a']);
});

test('a folder on the desktop becomes separate downloads on the web, and back: the same files either way', () => {
  const folder = { ...settings, destination: 'local-folder' as const };
  assert.equal(requestFromSettings(folder, exportTargetFor(photo, [], false)).destination, 'local-individual');
  assert.equal(requestFromSettings({ ...settings, destination: 'local-individual' }, exportTargetFor(photo, [], true)).destination, 'local-folder');
  assert.equal(requestFromSettings(settings, exportTargetFor(photo, [], true)).destination, 'local-zip');
  const web = planExport(requestFromSettings(folder, exportTargetFor(photo, [], false)), frames, sizes);
  const desktop = planExport(requestFromSettings(folder, exportTargetFor(photo, [], true)), frames, sizes);
  assert.deepEqual(desktop, web);
  assert.equal(requestFromSettings(settings, exportTargetFor(photo, [], true), true).destination, 'local-individual', 'a RAW TIFF is always its own file');
});

test('damaged or tampered stored settings are refused, never half-applied', () => {
  for (const bad of [
    null, [], 'x', { ...settings, fileFormat: 'gif' }, { ...settings, jpegQuality: 0 }, { ...settings, jpegQuality: 101 },
    { ...settings, jpegQuality: 50.5 }, { ...settings, maxSize: '999' }, { ...settings, customMaxSize: -1 },
    { ...settings, destination: 'cloud' }, { ...settings, sizeIds: 'a' }, { ...settings, sizeIds: [1] },
    { ...settings, includeBefore: false, includeAfter: false, includeOriginal: false }, { ...settings, includeAfter: 'yes' },
  ]) assert.equal(parseExportSettings(bad), null, JSON.stringify(bad));
  const storage = memoryStorage();
  storage.map.set(LAST_EXPORT_KEY_V2, '{not json');
  assert.equal(readLastExport(storage), null);
  storage.map.set(EXPORT_PRESETS_KEY_V2, JSON.stringify([{ id: 'x', name: 'Good', settings }, { id: 'y', name: 'Bad', settings: { ...settings, fileFormat: 'gif' } }, { id: 'x', name: 'Dup', settings }, { id: 'z', name: '  ', settings }]));
  assert.deepEqual(readPresets(storage).map((p) => p.name), ['Good']);
});

test('presets: a name is needed, the same name replaces, the list has a limit, and delete removes only that one', () => {
  assert.deepEqual(savePreset([], '   ', settings, () => 'x'), { problem: 'empty' });
  let n = 0;
  const id = () => `id${n++}`;
  const first = savePreset([], 'Web  large', settings, id);
  assert.ok('presets' in first);
  assert.equal(first.saved.name, 'Web large');
  const replaced = savePreset(first.presets, 'web LARGE', { ...settings, jpegQuality: 60 }, id);
  assert.ok('presets' in replaced);
  assert.equal(replaced.presets.length, 1);
  assert.equal(replaced.presets[0].settings.jpegQuality, 60);
  assert.equal(replaced.presets[0].id, first.saved.id);
  let list = replaced.presets;
  for (let i = 1; i < MAX_PRESETS; i += 1) { const r = savePreset(list, `P${i}`, settings, id); assert.ok('presets' in r); list = r.presets; }
  assert.deepEqual(savePreset(list, 'One more', settings, id), { problem: 'full' });
  assert.ok('presets' in savePreset(list, 'P3', settings, id), 'replacing still works when full');
  assert.equal(deletePreset(list, list[0].id).length, MAX_PRESETS - 1);
  // A saved preset is a copy: changing the settings later does not change it.
  const live = { ...settings, sizeIds: ['a'] };
  const kept = savePreset([], 'Copy', live, id);
  live.sizeIds!.push('b');
  assert.ok('presets' in kept);
  assert.deepEqual(kept.saved.settings.sizeIds, ['a']);
});

test('storage that refuses a write is reported, not ignored', () => {
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.equal(writePresets(full, []), false);
  assert.equal(writeLastExport(full, settings), false);
});
