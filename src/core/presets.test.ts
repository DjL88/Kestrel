import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILT_IN_PRESETS, addPreset, parsePresets, removePreset, sanitiseEdit } from './presets';

test('sanitising drops unknown keys, clamps values and ignores masks', () => {
  const edit = sanitiseEdit({ exposure: 9, shadows: -9, warmth: 'hot', masks: [{}], evil: 1, contrast: NaN });
  assert.deepEqual(edit, { exposure: 2, warmth: 0, colour: 0, shadows: -2 });
});

test('built-in presets are valid and have unique ids', () => {
  const ids = new Set(BUILT_IN_PRESETS.map((preset) => preset.id));
  assert.equal(ids.size, BUILT_IN_PRESETS.length);
  for (const preset of BUILT_IN_PRESETS) assert.deepEqual(sanitiseEdit(preset.edit), preset.edit);
});

test('saving replaces a preset of the same name and removing works', () => {
  let list = addPreset([], ' My look ', { exposure: 0.5, warmth: 0, colour: 0 }, 'a');
  list = addPreset(list, 'my LOOK', { exposure: 1, warmth: 0, colour: 0 }, 'b');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'a');
  assert.equal(list[0].edit.exposure, 1);
  assert.deepEqual(removePreset(list, 'a'), []);
  assert.equal(addPreset([], '   ', { exposure: 0, warmth: 0, colour: 0 }, 'c').length, 0);
});

test('stored presets that are corrupt are ignored rather than crashing', () => {
  assert.deepEqual(parsePresets('not json'), []);
  assert.deepEqual(parsePresets('{"a":1}'), []);
  const list = parsePresets(JSON.stringify([{ id: 'x', name: 'Ok', edit: { exposure: 1 } }, { id: 3 }, null]));
  assert.equal(list.length, 1);
  assert.equal(list[0].edit.exposure, 1);
});

test('twelve built-in looks include three distinct real monochrome slider recipes', () => {
  assert.equal(BUILT_IN_PRESETS.length, 12);
  const mono = BUILT_IN_PRESETS.filter((preset) => preset.id.startsWith('mono-'));
  assert.equal(mono.length, 3);
  assert.deepEqual(mono.map((preset) => preset.name), ['Mono natural', 'Mono bold', 'Mono soft']);
  for (const preset of mono) {
    assert.equal(preset.edit.colour, -2);
    assert.equal(preset.edit.warmth, 0);
    assert.deepEqual(sanitiseEdit(preset.edit), preset.edit);
  }
  assert.notDeepEqual(mono[0].edit, mono[1].edit);
  assert.notDeepEqual(mono[1].edit, mono[2].edit);
});
