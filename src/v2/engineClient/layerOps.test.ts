import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_LAYERS, readLayers, softEdgeAlpha, validLayer, visibleLayers, type PhotoLayer } from '../../core/layers';
import { addLayer, moveLayer, newLayer, removeLayer, updateLayer } from './overlayOps';
import type { OverlaySettings } from '../ui/contract';

const HASH = 'a'.repeat(64);
const layer = (id: string, extra: Partial<PhotoLayer> = {}): PhotoLayer => ({ ...newLayer(id, HASH, id, 1, 2 / 3), ...extra });

test('a malformed or duplicate layer is left out rather than guessed at', () => {
  assert.equal(validLayer(layer('a')), true);
  assert.equal(validLayer({ ...layer('a'), assetId: 'not-a-hash' }), false);
  assert.equal(validLayer({ ...layer('a'), opacity: 2 }), false);
  assert.equal(validLayer({ ...layer('a'), blend: 'multiply' }), false);
  assert.deepEqual(readLayers([layer('a'), layer('a'), { id: 'x' }, layer('b')]).map((l) => l.id), ['a', 'b']);
  assert.equal(readLayers(Array.from({ length: 12 }, (_, i) => layer(`l${i}`))).length, MAX_LAYERS);
  assert.deepEqual(readLayers('nope'), []);
});

test('a new layer fits inside the frame and starts centred, solid and visible', () => {
  const tall = newLayer('t', HASH, 'tall', 4, 2 / 3); // a tall image on a landscape frame
  assert.ok(tall.width * tall.aspect <= 0.9 * (2 / 3) + 1e-9, 'its height fits the frame');
  assert.deepEqual([tall.x, tall.y, tall.opacity, tall.hidden], [0.5, 0.5, 1, false]);
});

test('layers can be added up to the limit, changed within range, reordered and removed', () => {
  let overlay: OverlaySettings = {} as OverlaySettings;
  for (let i = 0; i < MAX_LAYERS + 2; i += 1) overlay = addLayer(overlay, layer(`l${i}`));
  assert.equal(overlay.layers!.length, MAX_LAYERS);
  overlay = updateLayer(overlay, 'l0', { opacity: 5, width: 0, rotation: 400 });
  const l0 = overlay.layers![0];
  assert.ok(validLayer(l0), 'out-of-range values are clamped, not stored');
  assert.equal(l0.opacity, 1);
  overlay = moveLayer(overlay, 'l0', 1);
  assert.deepEqual(overlay.layers!.slice(0, 2).map((l) => l.id), ['l1', 'l0']);
  assert.equal(moveLayer(overlay, 'l1', -1), overlay, 'the bottom layer cannot move further down');
  for (let i = 0; i < MAX_LAYERS; i += 1) overlay = removeLayer(overlay, `l${i}`);
  assert.equal('layers' in overlay, false);
});

test('hidden or see-through layers are not drawn', () => {
  assert.deepEqual(visibleLayers([layer('a'), layer('b', { hidden: true }), layer('c', { opacity: 0 })]).map((l) => l.id), ['a']);
});

test('soft edge: solid in the middle, fading to nothing at the edge; an oval is clear outside', () => {
  assert.equal(softEdgeAlpha(0.5, 0.5, 'rectangle', 0, 1), 1);
  assert.equal(softEdgeAlpha(0.5, 0.5, 'rectangle', 0.2, 1), 1);
  assert.ok(softEdgeAlpha(0.01, 0.5, 'rectangle', 0.2, 1) < 0.2);
  assert.ok(softEdgeAlpha(0.5, 0.5, 'oval', 0, 1) > 0.99);
  assert.equal(softEdgeAlpha(0.02, 0.02, 'oval', 0, 1), 0);
  const mid = softEdgeAlpha(0.3, 0.5, 'oval', 0.5, 1);
  assert.ok(mid > 0 && mid < 1, 'a full soft oval fades from the centre');
});
