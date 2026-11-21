import { test } from 'node:test';
import assert from 'node:assert/strict';
import { raw16Proof, proofFromDecoderBuffer } from './raw16Preview';

test('RGB16 preview keeps a distinct 8-bit proof, never modifies working samples', () => {
  const data = new Uint16Array([12345, 23456, 34567, 65535, 0, 32768]);
  const before = data.slice();
  const result = raw16Proof({ width: 2, height: 1, data });
  assert.deepEqual(data, before);
  assert.deepEqual([result.width, result.height, result.source], [2, 1, 'rgb16-display-preview']);
  assert.equal(result.rgba[3], 255);
  assert.ok(Math.abs(result.rgba[0] - Math.round(12345 / 257)) <= 1);
});
test('linear-light downsample preserves bright detail and bounds output', () => {
  const result = raw16Proof({ width: 2, height: 1, data: Uint16Array.of(0,0,0,65535,65535,65535) }, 1);
  assert.deepEqual([result.width, result.height], [1,1]);
  assert.ok(result.rgba[0] >= 187 && result.rgba[0] <= 189);
  assert.equal(result.rgba[3], 255);
});
test('decoder header is checked and forged dimensions fail closed', () => {
  const bytes = new ArrayBuffer(8 + 6);
  const view = new DataView(bytes);
  view.setUint32(0, 1, true); view.setUint32(4, 1, true);
  view.setUint16(8, 12345, true);
  assert.equal(proofFromDecoderBuffer(bytes).width, 1);
  view.setUint32(0, 80_000_001, true);
  assert.throws(() => proofFromDecoderBuffer(bytes), /invalid dimensions/i);
});
test('invalid proof sizes and truncated RGB samples are rejected', () => {
  assert.throws(() => raw16Proof({width:2,height:2,data:new Uint16Array(3)}), /Invalid high-precision/);
  assert.throws(() => raw16Proof({width:1,height:1,data:new Uint16Array(3)}, 99999), /Invalid proof size/);
});
