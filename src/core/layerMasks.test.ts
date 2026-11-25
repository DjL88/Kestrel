import assert from 'node:assert/strict';
import test from 'node:test';
import { layerMask, readLayers, validLayer, type PhotoLayer } from './layers';
import { maskLayerAlpha } from './layerCompose';
import { maskAlpha, fullContext } from './masks';
import { createMask } from './maskTypes';

const layer = (patch: Partial<PhotoLayer> = {}): PhotoLayer => ({
  id: 'l1', assetId: 'a'.repeat(64), label: 'Sky', aspect: 0.5, x: 0.5, y: 0.5, width: 1, rotation: 0, opacity: 1,
  blend: 'normal', softEdge: 0, shape: 'rectangle', hidden: false, ...patch,
});

test('a layer may name one of the photo\'s masks and say inside or outside; anything malformed is refused', () => {
  assert.ok(validLayer(layer()));
  assert.ok(validLayer(layer({ maskId: 'mask-1', maskInvert: true })));
  assert.ok(!validLayer(layer({ maskId: '' })));
  assert.ok(!validLayer(layer({ maskId: 'x'.repeat(81) })));
  assert.ok(!validLayer({ ...layer(), maskInvert: 'yes' }));
  assert.deepEqual(readLayers([layer({ maskId: 'mask-1' }), { ...layer({ id: 'l2' }), maskId: 7 }]).map((l) => l.id), ['l1']);
});

test('the named mask is found while the photo has it; once removed, the layer has none (and the panel says so)', () => {
  const masks = [createMask('radial', 'mask-1'), createMask('linear', 'mask-2')];
  assert.equal(layerMask(layer({ maskId: 'mask-2' }), masks)?.id, 'mask-2');
  assert.equal(layerMask(layer({ maskId: 'gone' }), masks), undefined);
  assert.equal(layerMask(layer(), masks), undefined);
});

test('the mask cuts the layer: inside a radial mask it shows, outside it is clear; inverted is the opposite', () => {
  const width = 40, height = 30;
  const radial = { ...createMask('radial', 'm'), feather: 0 };
  const alpha = maskAlpha(radial, width, height, fullContext(width, height));
  const centre = (height / 2) * width + width / 2;
  const opaque = () => new Uint8ClampedArray(width * height * 4).fill(255);
  const inside = opaque();
  maskLayerAlpha(inside, alpha, false);
  assert.equal(inside[centre * 4 + 3], 255);
  assert.equal(inside[3], 0, 'the corner, outside the mask, is clear');
  const outside = opaque();
  maskLayerAlpha(outside, alpha, true);
  assert.equal(outside[centre * 4 + 3], 0);
  assert.equal(outside[3], 255);
  // Colour is never touched; only how much of the layer shows.
  for (let i = 0; i < inside.length; i += 4) assert.deepEqual([...inside.slice(i, i + 3)], [255, 255, 255]);
});
