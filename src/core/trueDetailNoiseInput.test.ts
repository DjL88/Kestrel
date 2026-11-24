import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRUEDETAIL_TILE } from './trueDetailTiles.ts';
import { prepareDenoiseInput } from './trueDetailNoiseInput.ts';

test('RGB plus sigma preserves all RGB planes and adds a normalized noise map',()=>{
  const plane=TRUEDETAIL_TILE**2;
  const input=new Float32Array(plane*3).fill(0.25);
  const original=input.slice();
  const result=prepareDenoiseInput(input,'rgb-sigma',25);
  assert.equal(result.channels,4);
  assert.equal(result.data.length,plane*4);
  assert.deepEqual(result.data.slice(0,plane*3),original);
  assert.ok(result.data.slice(plane*3).every(v=>Math.abs(v-25/255)<1e-7));
  assert.deepEqual(input,original);
});
test('model contracts reject missing, invalid or unexpected noise levels',()=>{
  const rgb=new Float32Array(TRUEDETAIL_TILE**2*3);
  assert.equal(prepareDenoiseInput(rgb,'rgb').data,rgb);
  for(const sigma of [undefined,NaN,-1,76,Infinity]) assert.throws(()=>prepareDenoiseInput(rgb,'rgb-sigma',sigma));
  assert.throws(()=>prepareDenoiseInput(rgb,'rgb',25));
  assert.throws(()=>prepareDenoiseInput(new Float32Array(1),'rgb'));
  rgb[0]=NaN;
  assert.throws(()=>prepareDenoiseInput(rgb,'rgb-sigma',25));
});
