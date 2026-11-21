import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { planXmpImports, SidecarImportError } from './xmpImportPlan';
import type { ImportedPhotoSidecar } from './photoSidecar';
import type { PhotoFrame } from './types';

const photo = (filename: string, patch: Record<string, unknown> = {}): PhotoFrame => ({
  id: filename, stableKey: filename, filename, exif: {}, decision: 'unreviewed', isDemo: false,
  ...patch,
}) as unknown as PhotoFrame;
const xmp = (filename: string, contents = '<rdf/>') =>
  new File([contents], filename, { type: 'application/rdf+xml' });
const zip = (entries: Record<string, Uint8Array>) =>
  new File([new Uint8Array(zipSync(entries))], 'kestrel-xmp-sidecars.zip', { type: 'application/zip' });
const parsed: ImportedPhotoSidecar = { rating: 4, decision: 'keep', keywords: ['Kingfisher'] };
const reader = async () => parsed;

test('only explicitly selected, unambiguous originals are given matching XMP', async () => {
  const one = photo('one.NEF'), two = photo('two.CR3'), other = photo('three.JPG');
  const planned = await planXmpImports([xmp('one.xmp'), xmp('three.xmp')], [one], [one, two, other], reader);
  assert.deepEqual(planned, [{ frameId: one.id, metadata: parsed }]);
  assert.equal(one.decision, 'unreviewed', 'planning never changes the photograph');
});

test('ZIP exported by File can be re-imported without touching unselected photos', async () => {
  const one = photo('one.NEF'), two = photo('two.CR3'), third = photo('three.DNG');
  const archive = zip({ 'one.xmp': strToU8('<rdf/>'), 'two.xmp': strToU8('<rdf/>'), 'three.xmp': strToU8('<rdf/>') });
  const plans = await planXmpImports([archive], [one, two], [one, two, third], reader);
  assert.deepEqual(plans.map(plan => plan.frameId), ['one.NEF', 'two.CR3']);
});

test('RAW and JPEG with the same basename cannot receive an ambiguous XMP', async () => {
  const raw = photo('image.NEF'), jpeg = photo('image.JPG');
  await assert.rejects(planXmpImports([xmp('image.xmp')], [raw], [raw, jpeg], reader),
    (error: SidecarImportError) => error.reason === 'ambiguous');
});

test('reject-over-keep requires individual review; all plans remain unapplied', async () => {
  const one = photo('one.NEF'), keeper = photo('keeper.NEF', { decision: 'keep' });
  let calls = 0;
  await assert.rejects(planXmpImports([xmp('one.xmp'), xmp('keeper.xmp')], [one, keeper], [one, keeper],
    async (_, frame) => {
      calls++;
      return { ...parsed, decision: frame.id === keeper.id ? 'reject' : 'keep' };
    }), (error: SidecarImportError) => error.reason === 'keeper');
  assert.equal(calls, 2);
  assert.equal(one.decision, 'unreviewed');
  assert.equal(keeper.decision, 'keep');
});

test('refuse malicious paths, malformed archives, duplicates and ZIP bombs before parsing', async () => {
  const frame = photo('bird.NEF');
  const reject = async (files: File[], expected: string) => {
    await assert.rejects(planXmpImports(files, [frame], [frame], async () => {
      assert.fail('unsafe input should never reach the XMP parser');
    }), (error: SidecarImportError) => error.reason === expected);
  };
  await reject([xmp('../bird.xmp')], 'unsafe');
  await reject([xmp('bird.xmp'), xmp('BIRD.XMP')], 'ambiguous');
  await reject([zip({ '../bird.xmp': strToU8('<rdf/>') })], 'unsafe');
  await reject([zip({ 'bird.xmp': new Uint8Array(2_000_000) })], 'unsafe');
  await reject([new File(['garbage'], 'file.zip')], 'unsafe');
});

test('no matching selected originals does not claim a successful import', async () => {
  const frame = photo('bird.NEF');
  await assert.rejects(planXmpImports([xmp('other.xmp')], [frame], [frame], reader),
    (error: SidecarImportError) => error.reason === 'no-match');
  await assert.rejects(planXmpImports([], [frame], [frame], reader),
    (error: SidecarImportError) => error.reason === 'empty');
});
