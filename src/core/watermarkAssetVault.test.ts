import test from 'node:test';
import assert from 'node:assert/strict';
import { createWatermarkAssetRepository, isWatermarkAssetId, legacyWatermarkBlob } from './watermarkAssetVault';

const png = new Blob([Uint8Array.from([
  137,80,78,71,13,10,26,10,0,0,0,0,73,69,78,68,174,66,96,130,
])], { type: 'image/png' });
function harness() {
  const files = new Map<string, Blob>();
  const repo = createWatermarkAssetRepository({
    async put(id, blob) { files.set(id, blob); },
    async get(id) { return files.get(id) ?? null; },
  });
  return { files, repo };
}
test('a local watermark is stored once by content ID and round-trips unmodified', async () => {
  const { files, repo } = harness();
  const a = await repo.save(png);
  const b = await repo.save(new Blob([await png.arrayBuffer()], { type: 'image/png' }));
  assert.equal(a, b);
  assert.equal(files.size, 1);
  assert.equal(isWatermarkAssetId(a), true);
  assert.deepEqual(new Uint8Array(await (await repo.load(a))!.arrayBuffer()), new Uint8Array(await png.arrayBuffer()));
});
test('a missing or altered asset never silently produces a different image', async () => {
  const { files, repo } = harness();
  const id = await repo.save(png);
  assert.equal(await repo.load('invalid'), null);
  assert.equal(await repo.load('a'.repeat(64)), null);
  files.set(id, new Blob([new Uint8Array([255,216,255,1])], { type: 'image/jpeg' }));
  await assert.rejects(repo.load(id), /changed/);
});
test('rejects scripts, wrong signatures, unsupported images and oversized files', async () => {
  const { files, repo } = harness();
  for (const invalid of [
    new Blob(['<svg onload="alert(1)"/>'], { type: 'image/svg+xml' }),
    new Blob(['text'], { type: 'image/png' }),
    new Blob([new Uint8Array(3_000_001)], { type: 'image/png' }),
  ]) await assert.rejects(repo.save(invalid), /Choose a PNG/);
  assert.equal(files.size, 0);
});
test('old embedded data URLs can migrate locally, but remote/script URLs cannot', async () => {
  const blob = legacyWatermarkBlob('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
  assert.equal((await harness().repo.save(blob)).length, 64);
  assert.throws(() => legacyWatermarkBlob('javascript:alert(1)'), /not a valid/);
  assert.throws(() => legacyWatermarkBlob('https://example.com/mark.png'), /not a valid/);
});
