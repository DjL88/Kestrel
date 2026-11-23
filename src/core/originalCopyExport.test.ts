import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { BROWSER_ORIGINAL_ZIP_LIMIT, copyUnchangedOriginal, originalCopyFilename, planOriginalCopies } from './originalCopyExport';

const frame = (id: string, filename: string, isDemo = false, originalSha256?: string) =>
  ({ id, filename, stableKey: id, isDemo, originalSha256 });
const digest = async (blob: Blob) => createHash('sha256').update(new Uint8Array(await blob.arrayBuffer())).digest('hex');

test('original naming keeps genuine extensions but safely disambiguates camera counter collisions', () => {
  const plan = planOriginalCopies([frame('a', 'DSC_0023.NEF'), frame('b', 'dsc_0023.nef'), frame('c', 'DSC_0024.JPG')]);
  assert.deepEqual(plan.map(item => item.filename), ['DSC_0023.NEF', 'dsc_0023-2.nef', 'DSC_0024.JPG']);
  assert.ok(plan.every(item => item.subfolder === 'Original'));
  assert.equal(originalCopyFilename('../photo.NEF'), 'photo.NEF');
  assert.throws(() => originalCopyFilename('CON.NEF'), /reserved/);
  assert.throws(() => originalCopyFilename(''), /safe/);
  assert.equal(originalCopyFilename('A'.repeat(180) + '.NEF').endsWith('.NEF'), true);
  assert.equal(originalCopyFilename('A'.repeat(180) + '.NEF').length <= 150, true);
  assert.ok(BROWSER_ORIGINAL_ZIP_LIMIT < 150_000_000);
});

test('original byte copy preserves camera payload, extension, EXIF-capable bytes and timestamp', async () => {
  const source = new Blob([Uint8Array.from([255,216,255,1,2,3,4,5,6])], { type: 'image/jpeg' });
  const out = await copyUnchangedOriginal(frame('photo', 'DSC_0900.JPG', false, await digest(source)), {
    ensureOriginal: async () => source, originalInfo: () => ({ size: source.size, lastModified: 1_700_000_000_000 }),
  }, 'DSC_0900.JPG');
  assert.equal(out.name, 'DSC_0900.JPG');
  assert.equal(out.size, source.size);
  assert.equal(out.lastModified, 1_700_000_000_000);
  assert.deepEqual(new Uint8Array(await out.arrayBuffer()), new Uint8Array(await source.arrayBuffer()));
});

test('a missing, demo, truncated, or replaced original refuses to use the preview', async () => {
  const item = frame('photo', 'Bird.NEF');
  await assert.rejects(copyUnchangedOriginal(item, {
    ensureOriginal: async () => undefined, originalInfo: () => ({ size: 30_000_000 }),
  }, item.filename), /Reconnect/);
  await assert.rejects(copyUnchangedOriginal(item, {
    ensureOriginal: async () => new Blob(['short']), originalInfo: () => ({ size: 30_000_000 }),
  }, item.filename), /changed/);
  assert.throws(() => planOriginalCopies([frame('demo', 'fake.NEF', true)]), /Demo/);
  await assert.rejects(copyUnchangedOriginal(frame('demo', 'fake.NEF', true), {
    ensureOriginal: async () => new Blob(['demo']), originalInfo: () => undefined,
  }, 'fake.NEF'), /demo/);
});

test('cancellation does not publish a partial original copy', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(copyUnchangedOriginal(frame('a', 'bird.NEF'), {
    ensureOriginal: async () => { throw new Error('should not read'); },
    originalInfo: () => ({ size: 100 }),
  }, 'bird.NEF', controller.signal), /aborted/i);
});


test('Original export refuses same-size substituted bytes even if filename and timestamp agree', async () => {
  const original = new Blob([new Uint8Array([9, 9, 9, 1])]);
  const replacement = new Blob([new Uint8Array([9, 9, 9, 2])]);
  const saved = frame('bird', 'Bird.NEF', false, await digest(original));
  await assert.rejects(copyUnchangedOriginal(saved, {
    ensureOriginal: async () => replacement,
    originalInfo: () => ({ size: original.size, lastModified: 1234567890000 }),
  }, 'Bird.NEF'), /SHA-256/);
});

test('legacy Original exports without authenticated SHA never silently copy an arbitrary same-name file', async () => {
  const source = new Blob([new Uint8Array([1, 2, 3, 4])]);
  await assert.rejects(copyUnchangedOriginal(frame('legacy', 'Bird.NEF'), {
    ensureOriginal: async () => source, originalInfo: () => ({ size: 4, lastModified: 123 }),
  }, 'Bird.NEF'), /SHA-256/);
});
