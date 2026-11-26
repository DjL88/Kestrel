import assert from 'node:assert/strict';
import test from 'node:test';
import { CLOUD_RECIPE_MAX_BYTES, FULL_FILE_CONSENT_OFF, formatUploadSize, grantFullFileConsent, parseCloudRecipe, parseFullFileConsent,
  planRecipeUpload, recipeIsEmpty, withdrawFullFileConsent } from './cloudRecipe.ts';

const preview = { bytes: 1_400_000, megapixels: 4.4 };
const original = { bytes: 48_000_000, megapixels: 45 };
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const job = { jobId: 'job-1', input: 'smart-preview' as const };

test('the smart preview is sent by default and the original is never offered without the opt-in', () => {
  const plan = planRecipeUpload({ preview, original }, FULL_FILE_CONSENT_OFF);
  assert.equal(plan.status, 'ready');
  if (plan.status !== 'ready') return;
  assert.deepEqual([plan.send.kind, plan.send.bytes], ['smart-preview', 1_400_000]);
  assert.equal(plan.alternative, undefined);
});

test('with the opt-in on, the original is offered only when it is estimated faster', () => {
  const slower = planRecipeUpload({ preview, original }, grantFullFileConsent(1));
  assert.equal(slower.status === 'ready' && slower.alternative, undefined, 'a 48 MB original is slower than a 1.4 MB preview');
  const faster = planRecipeUpload({ preview: null, previewBuildMs: 60_000, original: { bytes: 2_000_000, megapixels: 12 } }, grantFullFileConsent(1));
  assert.ok(faster.status === 'ready' && faster.send.kind === 'smart-preview' && faster.alternative?.kind === 'original');
});

test('no preview: the original is the only choice with the opt-in, otherwise nothing can be sent', () => {
  assert.deepEqual(planRecipeUpload({ preview: null, original }, FULL_FILE_CONSENT_OFF), { status: 'unavailable', reason: 'no-preview' });
  const plan = planRecipeUpload({ preview: null, original }, grantFullFileConsent(1));
  assert.ok(plan.status === 'ready' && plan.send.kind === 'original' && plan.send.bytes === original.bytes);
});

test('the opt-in can be withdrawn and anything malformed reads as off', () => {
  assert.equal(withdrawFullFileConsent(5).on, false);
  assert.equal(parseFullFileConsent({ on: 'yes' }).on, false);
  assert.equal(parseFullFileConsent(null).on, false);
  assert.deepEqual(parseFullFileConsent({ on: true, changedAtMs: 7 }), { on: true, changedAtMs: 7 });
});

test('sizes are shown in words before sending', () => {
  assert.equal(formatUploadSize(1_400_000), '1.4 MB');
  assert.equal(formatUploadSize(830_000), '830 KB');
  assert.equal(formatUploadSize(48_000_000), '48.0 MB');
});

test('a well-formed recipe for this job is read, values rounded', () => {
  const recipe = parseCloudRecipe(encode({ protocol: 1, jobId: 'job-1', input: 'smart-preview', settings: { exposure: 0.333, shadows: 20 },
    producer: { name: 'fake', version: '1' }, notes: ['Lifted the shadows a little.'] }), job);
  assert.deepEqual(recipe?.settings, { exposure: 0.33, shadows: 20 });
  assert.equal(recipe?.producer?.name, 'fake');
  assert.equal(recipe && recipeIsEmpty(recipe), false);
});

test('anything that is not a small recipe for this job is refused whole', () => {
  const base = { protocol: 1, jobId: 'job-1', input: 'smart-preview', settings: { exposure: 1 } };
  assert.equal(parseCloudRecipe(encode({ ...base, jobId: 'other' }), job), null, 'different job');
  assert.equal(parseCloudRecipe(encode({ ...base, input: 'original' }), job), null, 'different input than was sent');
  assert.equal(parseCloudRecipe(encode({ ...base, settings: { exposure: 9 } }), job), null, 'out of range');
  assert.equal(parseCloudRecipe(encode({ ...base, settings: { masks: [] } }), job), null, 'not a slider');
  assert.equal(parseCloudRecipe(encode({ ...base, pixels: 'AAAA' }), job), null, 'extra field');
  assert.equal(parseCloudRecipe(encode({ ...base, settings: { exposure: Number.NaN } }), job), null);
  assert.equal(parseCloudRecipe(new Uint8Array(CLOUD_RECIPE_MAX_BYTES + 1).fill(32), job), null, 'too big');
  assert.equal(parseCloudRecipe(new TextEncoder().encode('not json'), job), null);
});
