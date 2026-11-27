import assert from 'node:assert/strict';
import test from 'node:test';
import { FULL_FILE_CONSENT_OFF, grantFullFileConsent, withdrawFullFileConsent } from '../../core/cloudRecipe.ts';
import { recordEdit, stepEdit } from '../../core/editHistory.ts';
import type { PhotoFrame } from '../../core/types';
import { inMemoryCloudRecipeService } from '../../providers/cloudRecipeService.ts';
import { cloudRecipeEdit, cloudRecipeWhy, prepareCloudRecipe, sendCloudRecipe, type RecipeSources } from './runCloudRecipe.ts';

const frame = { id: 'p1', stableKey: 'k1', filename: 'DSC_0001.NEF', exif: { width: 8256, height: 5504 } } as unknown as PhotoFrame;
const previewBlob = new Blob([new Uint8Array(1_400_000)], { type: 'image/jpeg' });
const originalBlob = new Blob([new Uint8Array(3_000_000)]);
let originalReads = 0;
const sources = (preview: Blob | null = previewBlob): RecipeSources => ({
  smartPreview: async () => preview,
  ensureOriginal: async () => { originalReads++; return originalBlob; },
});

test('the default job sends the smart preview, gets settings back and the cloud copy is deleted', async () => {
  originalReads = 0;
  const service = inMemoryCloudRecipeService(() => ({ exposure: 0.4, shadows: 30 }), { producer: { name: 'fake', version: '0' } });
  const prepared = await prepareCloudRecipe(frame, sources(), FULL_FILE_CONSENT_OFF);
  assert.equal(prepared.offer.sendLabel, '1.4 MB smart preview');
  assert.equal(originalReads, 0, 'the original is not even read without the opt-in');
  assert.equal(service.received.length, 0, 'preparing an offer sends nothing');
  const outcome = await sendCloudRecipe(prepared, 'send', FULL_FILE_CONSENT_OFF, service);
  assert.equal(outcome.status, 'ready');
  assert.deepEqual(service.received.map(({ kind, bytes, deleted }) => ({ kind, bytes, deleted })), [{ kind: 'smart-preview', bytes: 1_400_000, deleted: true }]);
  assert.equal(service.held.size, 0);
});

test('applying the recipe is one step that Undo takes back', async () => {
  const service = inMemoryCloudRecipeService(() => ({ exposure: 0.4, shadows: 30 }));
  const prepared = await prepareCloudRecipe(frame, sources(), FULL_FILE_CONSENT_OFF);
  const outcome = await sendCloudRecipe(prepared, 'send', FULL_FILE_CONSENT_OFF, service);
  assert.ok(outcome.status === 'ready');
  if (outcome.status !== 'ready') return;
  const before = { exposure: 0, warmth: 1, colour: 0 };
  const edited = recordEdit({ ...frame, edit: before }, { edit: cloudRecipeEdit(before, outcome.recipe) }, 10, cloudRecipeWhy(outcome.recipe, outcome.sent));
  assert.equal(edited.edit?.exposure, 1, '0.4 EV is one engine step');
  assert.equal(edited.edit?.warmth, 1, 'settings the recipe does not name are kept');
  assert.match(edited.editHistory!.steps.at(-1)!.why!.notes![0], /1\.4 MB smart preview/);
  assert.deepEqual(stepEdit(edited, -1).edit, before);
});

test('a failed job still deletes the upload and changes nothing', async () => {
  const service = inMemoryCloudRecipeService(() => { throw new Error('runner down'); });
  const prepared = await prepareCloudRecipe(frame, sources(), FULL_FILE_CONSENT_OFF);
  await assert.rejects(sendCloudRecipe(prepared, 'send', FULL_FILE_CONSENT_OFF, service), /runner down/);
  assert.equal(service.received[0].deleted, true);
  assert.equal(service.held.size, 0);
});

test('the full original goes only with the opt-in, and not once it is withdrawn', async () => {
  const service = inMemoryCloudRecipeService(() => ({ contrast: 10 }));
  const offFlow = await prepareCloudRecipe(frame, sources(null), FULL_FILE_CONSENT_OFF);
  assert.equal(offFlow.offer.plan.status, 'unavailable');
  const on = grantFullFileConsent(1);
  const prepared = await prepareCloudRecipe(frame, sources(null), on);
  assert.equal(prepared.offer.sendLabel, '3.0 MB full original');
  await assert.rejects(sendCloudRecipe(prepared, 'send', withdrawFullFileConsent(2), service), /switched off/);
  assert.equal(service.received.length, 0);
  const outcome = await sendCloudRecipe(prepared, 'send', on, service);
  assert.equal(outcome.status, 'ready');
  assert.deepEqual(service.received.map(({ kind, deleted }) => ({ kind, deleted })), [{ kind: 'original', deleted: true }]);
});

test('a recipe the device cannot trust is refused, not applied', async () => {
  const service = inMemoryCloudRecipeService(() => ({ exposure: 50 }));
  const prepared = await prepareCloudRecipe(frame, sources(), FULL_FILE_CONSENT_OFF);
  assert.equal((await sendCloudRecipe(prepared, 'send', FULL_FILE_CONSENT_OFF, service)).status, 'refused');
  const empty = inMemoryCloudRecipeService(() => ({}));
  assert.equal((await sendCloudRecipe(prepared, 'send', FULL_FILE_CONSENT_OFF, empty)).status, 'empty');
});

test('with no smart preview (web, phones, JPEGs) a copy of the preview is offered, and named as a copy', async () => {
  const service = inMemoryCloudRecipeService(() => ({ exposure: 0.4 }));
  const copy = new Blob([new Uint8Array(900_000)], { type: 'image/jpeg' });
  const prepared = await prepareCloudRecipe(frame, { ...sources(null), previewCopy: async () => copy }, FULL_FILE_CONSENT_OFF);
  assert.equal(prepared.offer.previewSource, 'copy');
  assert.equal(prepared.offer.sendLabel, '900 KB preview copy (2,560 px at most)');
  const outcome = await sendCloudRecipe(prepared, 'send', FULL_FILE_CONSENT_OFF, service);
  assert.ok(outcome.status === 'ready');
  if (outcome.status !== 'ready') return;
  assert.match(cloudRecipeWhy(outcome.recipe, outcome.sent, outcome.previewSource).notes![0]!, /preview copy/);
  const smart = await prepareCloudRecipe(frame, { ...sources(), previewCopy: async () => { throw new Error('not asked'); } }, FULL_FILE_CONSENT_OFF);
  assert.equal(smart.offer.previewSource, 'smart', 'the smart preview wins when there is one');
});
