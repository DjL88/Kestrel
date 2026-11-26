import assert from 'node:assert/strict';
import test from 'node:test';
import { generateDemoShootFrames } from '../../core/cullingEngine';
import { stepEdit } from '../../core/editHistory';
import type { CullingState, PhotoFrame } from '../../core/types';
import { createDefaultOverlay } from '../ui/stub';
import { readOverlay } from './overlayOps';
import { MAX_KITS, addBrandKit, applyBrandKitToProject, deleteBrandKit, editBrandKit, overlayForKit, overlayWithKit, readBrandKits, shownLogoId, type BrandKit } from './brandKits';

const styled = () => ({
  ...createDefaultOverlay(false), watermarkPresetId: 'wm-mine', watermarkPosition: 'top-left' as const, watermarkOpacity: 55,
  watermarkScale: 120, watermarkContrast: 'dark-on-light' as const, textColour: 'dark' as const, textScrim: false, textAlign: 'right' as const,
  rows: createDefaultOverlay(false).rows.map((row) => ({ ...row, fontId: 'jetbrains', weight: 700 as const, uppercase: true, letterSpacing: 3 })),
});
const kits = (): BrandKit[] => addBrandKit([], '  Studio   kit ', styled(), 'kit-abc123', 10) as BrandKit[];

test('a kit keeps the logo, colours and text style of a photo, and nothing else', () => {
  const [kit] = kits();
  assert.equal(kit.name, 'Studio kit');
  assert.equal(kit.watermarkPresetId, 'wm-mine');
  assert.equal(kit.watermarkPosition, 'top-left');
  assert.equal(kit.watermarkContrast, 'dark-on-light');
  assert.equal(kit.textColour, 'dark');
  assert.equal(kit.fontId, 'jetbrains');
  assert.equal(kit.weight, 700);
  assert.equal('rows' in kit, false);
});

test('putting a kit on keeps the photo own words and layers, and switches the logo on', () => {
  const [kit] = kits();
  const photo = { ...createDefaultOverlay(false), textEnabled: true, rows: [{ ...createDefaultOverlay(false).rows[0], customText: 'Red kite, Wales' }] };
  const after = overlayWithKit(photo, kit);
  assert.equal(after.watermarkEnabled, true);
  assert.equal(after.watermarkPresetId, 'wm-mine');
  assert.equal(after.watermarkPlacement, 'anchor');
  assert.equal(after.textEnabled, true);
  assert.equal(after.rows[0].customText, 'Red kite, Wales');
  assert.equal(after.rows[0].fontId, 'jetbrains');
  assert.equal(after.rows[0].uppercase, true);
  assert.equal(after.textColour, 'dark');
});

test('kits can be renamed, restyled from another photo and removed', () => {
  const list = kits();
  const renamed = editBrandKit(list, 'kit-abc123', { name: ' Wedding ' }, 20) as BrandKit[];
  assert.equal(renamed[0].name, 'Wedding');
  assert.equal(renamed[0].savedAt, 10);
  assert.equal(editBrandKit(list, 'kit-abc123', { name: '   ' }, 20), 'empty');
  assert.equal(editBrandKit(list, 'kit-nope00', { name: 'x' }, 20), 'missing');
  const restyled = editBrandKit(list, 'kit-abc123', { overlay: { ...styled(), watermarkPresetId: 'wm-other', textColour: 'light' } }, 30) as BrandKit[];
  assert.equal(restyled[0].watermarkPresetId, 'wm-other');
  assert.equal(restyled[0].textColour, 'light');
  assert.equal(restyled[0].savedAt, 30);
  assert.deepEqual(deleteBrandKit(list, 'kit-abc123'), []);
});

test('empty names, bad ids, repeats and a full list are refused', () => {
  assert.equal(addBrandKit([], '  ', styled(), 'kit-abc123', 1), 'empty');
  assert.equal(addBrandKit([], 'x', styled(), '../evil', 1), 'missing');
  assert.equal(addBrandKit(kits(), 'x', styled(), 'kit-abc123', 1), 'missing');
  let full: BrandKit[] = [];
  for (let i = 0; i < MAX_KITS; i += 1) full = addBrandKit(full, `k${i}`, styled(), `kit-id${String(i).padStart(3, '0')}`, i) as BrandKit[];
  assert.equal(addBrandKit(full, 'one more', styled(), 'kit-zzz999', 1), 'full');
});

test('stored kits are read defensively', () => {
  assert.deepEqual(readBrandKits(null), []);
  assert.deepEqual(readBrandKits('not json'), []);
  assert.deepEqual(readBrandKits('{"a":1}'), []);
  const read = readBrandKits(JSON.stringify([
    { id: 'kit-good01', name: 'Good', watermarkPresetId: 'wm-inflight', watermarkOpacity: 999, weight: 1, textColour: 'pink' },
    { id: 'kit-good01', name: 'Again', watermarkPresetId: 'wm-inflight' },
    { id: '../evil', name: 'Evil', watermarkPresetId: 'wm-inflight' }, { id: 'kit-nologo', name: 'No logo' }, 7, null,
  ]));
  assert.deepEqual(read.map((kit) => kit.id), ['kit-good01']);
  assert.equal(read[0].watermarkOpacity, 100);
  assert.ok([400, 500, 600, 700].includes(read[0].weight));
  assert.equal(read[0].textColour, 'light');
});

test('applying a kit to photos gives each its own Undo step and leaves originals and recipes alone', () => {
  const frames = generateDemoShootFrames(3);
  const state = { shoot: { lastUpdatedAt: 1 } as CullingState['shoot'], frames } as CullingState;
  const [kit] = kits();
  const removedId = frames[2].id;
  state.frames[2] = { ...frames[2], removedAt: 5 };
  const result = applyBrandKitToProject(state, kit, [frames[0].id, frames[1].id, removedId, 'missing'], 100);
  assert.equal(result.changed, 2);
  const first = result.state.frames[0];
  assert.equal(readOverlay(first.overlay).watermarkPresetId, 'wm-mine');
  assert.equal(first.edit, frames[0].edit);
  assert.equal(first.originalSha256, frames[0].originalSha256);
  assert.equal(result.state.frames[2], state.frames[2]);
  const undone = stepEdit(JSON.parse(JSON.stringify(first)) as PhotoFrame, -1);
  assert.equal(readOverlay(undone.overlay).watermarkEnabled, false);
  assert.equal(applyBrandKitToProject(result.state, kit, [frames[0].id], 200).changed, 0);
});

test('a kit keeps the logo the photo shows, never a watermark this device lacks', () => {
  const overlay = { ...readOverlay(undefined), watermarkPresetId: 'wm-gone' };
  assert.equal(shownLogoId(overlay, ['wm-a', 'wm-b']), 'wm-a');
  assert.equal(shownLogoId({ ...overlay, watermarkPresetId: 'wm-b' }, ['wm-a', 'wm-b']), 'wm-b');
  assert.equal(shownLogoId(overlay, []), undefined);
  assert.equal(overlayForKit(overlay, ['wm-a']).watermarkPresetId, 'wm-a');
  assert.equal(overlayForKit(overlay, []).watermarkPresetId, 'wm-gone');
});
