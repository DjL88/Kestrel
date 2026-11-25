import assert from 'node:assert/strict';
import test from 'node:test';
import { NAFNET_TILE, nafnetOutput } from './nafnet';
import { NAFNET_W32, OPTIONAL_MODELS, optionalModelBytes } from './optionalModels';
import { TRUEDETAIL_TILE, runTrueDetailTiles } from './trueDetailTiles';

test('NAFNet uses the TrueDetail tile contract', () => assert.equal(NAFNET_TILE, TRUEDETAIL_TILE));

test('output is clamped to 0..1, never rescaled; a non-finite sample refuses the tile', () => {
  const raw = Float32Array.from([-0.01, 0.5, 1.02]);
  assert.deepEqual(Array.from(nafnetOutput(raw, 3)), [0, 0.5, 1]);
  assert.throws(() => nafnetOutput(Float32Array.from([0, NaN, 0]), 3), /Invalid/);
  assert.throws(() => nafnetOutput(new Float32Array(2), 3), /shape/);
});

test('through the shared tile runner, an identity model leaves the photo unchanged and strength 0 skips it', async () => {
  const w = 300; const h = 200;
  const source = Uint16Array.from({ length: w * h * 3 }, (_, i) => (i * 37) % 65536);
  let calls = 0;
  const identity = async (input: Float32Array) => { calls += 1; return nafnetOutput(input.slice()); };
  const out = await runTrueDetailTiles(source, w, h, identity, { strength: 1 });
  assert.ok(calls > 1);
  let worst = 0;
  for (let i = 0; i < source.length; i += 1) worst = Math.max(worst, Math.abs(out[i] - source[i]));
  assert.ok(worst <= 1, `worst ${worst}`);
  calls = 0;
  assert.deepEqual(await runTrueDetailTiles(source, w, h, identity, { strength: 0 }), source);
  assert.equal(calls, 0);
});

test('the NAFNet pack is pinned, MIT, about 59 MB', () => {
  assert.ok(OPTIONAL_MODELS.includes(NAFNET_W32));
  assert.equal(NAFNET_W32.licence, 'MIT');
  assert.equal(optionalModelBytes(NAFNET_W32), 58841423);
});
