import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeRawMasterRecipe, nativeRawMasterFraming } from './nativeRawMaster';

test('16-bit RAW master preflight keeps a complete, bounded global tone recipe', () => {
  const output = nativeRawMasterRecipe({ edit: {
    exposure: 0.75, warmth: -0.2, colour: 0.3, highlights: -0.7, shadows: 0.2,
    contrast: 0.1, blacks: -0.2, whites: -0.1, brightness: 0.05, vibrance: 0.1,
  } });
  assert.deepEqual(output, {
    exposure: 0.75, warmth: -0.2, colour: 0.3, brightness: 0.05,
    contrast: 0.1, highlights: -0.7, shadows: 0.2, whites: -0.1,
    blacks: -0.2, vibrance: 0.1,
  });
});

test('unedited RAW can export a high-bit-depth master without manufacturing adjustments', () => {
  const result = nativeRawMasterRecipe({});
  assert.ok(Object.values(result).every((value) => value === 0));
});

test('native RAW master refuses every unsupported detail or mask operation', () => {
  for (const key of ['texture', 'clarity', 'sharpen', 'denoise'] as const) {
    assert.throws(() => nativeRawMasterRecipe({ edit: {
      exposure: 0, warmth: 0, colour: 0, [key]: 0.5,
    } }), /does not yet support/i);
  }
  assert.throws(() => nativeRawMasterRecipe({ edit: {
    exposure: 0, warmth: 0, colour: 0, masks: [{ id: 'fake' }] as never,
  } }), /masks/i);
});

test('16-bit RAW master accepts saved crop and quarter-turn values without discarding them', () => {
  const original = { ratio: null, turns: 0, straighten: 0, x: 0.5, y: 0.5 };
  assert.deepEqual(nativeRawMasterFraming(undefined), { ...original, size: 1 });
  assert.deepEqual(nativeRawMasterFraming(original), { ...original, size: 1 });
  const crop = { ...original, ratio: 1, turns: 1, x: 0.3, y: 0.8, size: 0.65 };
  assert.deepEqual(nativeRawMasterFraming(crop), crop);
  assert.deepEqual(nativeRawMasterFraming({ ...crop, turns: 3 }), { ...crop, turns: 3 });
});

test('RAW master fails closed on unsupported straightening and invalid crop coordinates', () => {
  const original = { ratio: null, turns: 0, straighten: 0, x: 0.5, y: 0.5 };
  assert.throws(() => nativeRawMasterFraming({ ...original, straighten: 0.25 }), /straighten/i);
  for (const turns of [-1, 4, 0.25, Infinity]) {
    assert.throws(() => nativeRawMasterFraming({ ...original, turns }), /quarter-turn/i);
  }
  for (const ratio of [0, -1, 101, NaN, Infinity]) {
    assert.throws(() => nativeRawMasterFraming({ ...original, ratio }), /aspect ratio/i);
  }
  for (const framing of [
    { ...original, x: -0.1 }, { ...original, x: 1.1 }, { ...original, y: 1.1 },
    { ...original, size: 0.07 }, { ...original, size: 1.1 },
    { ...original, size: NaN }, { ...original, y: Infinity },
  ]) {
    assert.throws(() => nativeRawMasterFraming(framing), /crop position or size/i);
  }
});

test('native RAW master does not accept out-of-range or non-finite edits', () => {
  for (const value of [NaN, Infinity, -Infinity, 13]) {
    assert.throws(() => nativeRawMasterRecipe({ edit: {
      exposure: value, warmth: 0, colour: 0,
    } }), /Invalid exposure/);
  }
  assert.throws(() => nativeRawMasterRecipe({ edit: {
    exposure: 0, warmth: 0, colour: 2.1,
  } }), /Invalid colour/);
});
