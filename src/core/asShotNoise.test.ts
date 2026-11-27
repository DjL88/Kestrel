import assert from 'node:assert/strict';
import test from 'node:test';
import { AS_SHOT_NOISE_MAX, asShotEdit, asShotLuminanceSlider, withAsShotNoise } from './asShotNoise';
import { stepEdit } from './editHistory';
import type { PhotoFrame } from './types';

const raw = (iso: number | undefined, extra: Partial<PhotoFrame> = {}) => ({
  id: 'f1', stableKey: 'k1', filename: '_DJL9642.NEF', sequenceIndex: 1, decision: 'unreviewed', burstGroupId: null, burstIndex: 1,
  burstCount: 1, exif: { iso }, isDemo: false, sourceKind: 'file', ...extra,
}) as PhotoFrame;

test('conservative and ISO-scaled: nothing up to ISO 800, a gentle rise per stop, never past the cap', () => {
  assert.equal(asShotLuminanceSlider(100), 0);
  assert.equal(asShotLuminanceSlider(800), 0);
  assert.equal(asShotLuminanceSlider(1600), 7);
  assert.equal(asShotLuminanceSlider(3200), 13);
  assert.equal(asShotLuminanceSlider(10000), 24);
  assert.equal(asShotLuminanceSlider(204800), AS_SHOT_NOISE_MAX);
  assert.equal(asShotLuminanceSlider(undefined), 0, 'unknown ISO: nothing assumed');
  assert.equal(asShotLuminanceSlider(Number.NaN), 0);
});

test('a new high-ISO RAW starts with it as a visible recipe value, recorded in History as InFlight\'s As shot step', () => {
  const frame = withAsShotNoise(raw(10000), 1000);
  assert.equal(frame.edit?.denoiseLuminance, 24 / 50, 'the Luminance slider starts at 24 (recipe 0.48), not hidden');
  assert.equal(frame.asShotLuminance, 24 / 50);
  assert.equal(frame.editHistory?.steps.length, 1);
  assert.equal(frame.editHistory?.steps[0].why?.by, 'as-shot', 'made by InFlight, not by the person');
  assert.match(frame.editHistory?.steps[0].why?.notes?.[0] ?? '', /ISO 10,000/);
  // One Undo takes it back, like any other step.
  const undone = stepEdit(frame, -1);
  assert.equal(undone.edit?.denoiseLuminance ?? 0, 0);
});

test('nothing changes for photos imported before, a person\'s own edit, low ISO, or anything that is not a RAW', () => {
  const edited = raw(10000, { edit: { exposure: 0.5 } as PhotoFrame['edit'] });
  assert.equal(withAsShotNoise(edited, 1), edited, 'an existing edit is kept as it is');
  const lowIso = raw(400);
  assert.equal(withAsShotNoise(lowIso, 1), lowIso);
  const jpeg = { ...raw(10000), filename: 'bird.jpg' } as PhotoFrame;
  assert.equal(withAsShotNoise(jpeg, 1), jpeg);
  // A photo imported before this existed has no asShotLuminance, so Reset still clears it completely.
  assert.equal(asShotEdit(raw(10000)), undefined);
});

test('"Reset" goes back to the As shot recipe, not to nothing', () => {
  const frame = withAsShotNoise(raw(10000), 1000);
  assert.deepEqual(asShotEdit(frame)?.denoiseLuminance, 24 / 50);
  assert.equal(asShotEdit({ asShotLuminance: 0 }), undefined);
});

test('the slider shows it as its starting value', async () => {
  const { editToRecipe } = await import('../v2/engineClient/recipeMap');
  const frame = withAsShotNoise(raw(10000), 1000);
  assert.equal(editToRecipe(frame.edit).denoiseLuminance, 24);
});
