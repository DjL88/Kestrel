import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILT_IN_PRESETS, MAX_USER_LOOKS, addPreset, exportUserLooks, importUserLooks, matchesPresetEdit, parsePresets, parseUserLooks, removePreset,
  removeUserLook, renameUserLook, sanitiseEdit, saveUserLook, userLookRecipe, type UserLook,
} from './presets';

test('sanitising drops unknown keys, clamps values and ignores masks', () => {
  const edit = sanitiseEdit({ exposure: 9, shadows: -9, warmth: 'hot', masks: [{}], evil: 1, contrast: NaN });
  assert.deepEqual(edit, { exposure: 9, warmth: 0, colour: 0, shadows: -2 }, 'exposure runs to 12.5 now; other controls stop at 2');
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

test('selected look follows actual slider settings, not the last clicked button', () => {
  const natural = BUILT_IN_PRESETS.find((preset) => preset.id === 'natural')!;
  assert.equal(matchesPresetEdit(natural.edit, natural.edit), true);
  assert.equal(matchesPresetEdit({ ...natural.edit, masks: [] }, natural.edit), true);
  assert.equal(matchesPresetEdit({ ...natural.edit, exposure: 0.1 }, natural.edit), false);
  const mono = BUILT_IN_PRESETS.find((preset) => preset.id === 'mono-bold')!;
  assert.equal(matchesPresetEdit(mono.edit, natural.edit), false);
});

test('your look keeps only global sliders, clamped, and keeps zeros so it applies the same everywhere', () => {
  const recipe = userLookRecipe({ exposure: 9, contrast: 0, shadows: -250, sharpen: -4, vibrance: 12.3456, temperature: NaN, masks: [{}], toneCurve: [[0, 0]], lensProfile: { id: 'x' }, lookId: 'natural', evil: 1, saturation: '5' });
  assert.deepEqual(recipe, { exposure: 5, shadows: -100, contrast: 0, vibrance: 12.35, sharpen: 0 });
});

test('saving your look: names are trimmed, the same name updates that look and keeps its id, empty or full is refused', () => {
  let list = saveUserLook([], '  Misty   morning ', { exposure: 0.3 }, 'a', 1)!;
  assert.deepEqual(list, [{ id: 'a', name: 'Misty morning', recipe: { exposure: 0.3 }, savedAt: 1 }]);
  list = saveUserLook(list, 'MISTY MORNING', { exposure: -1, contrast: 10 }, 'b', 2)!;
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'a');
  assert.deepEqual(list[0].recipe, { exposure: -1, contrast: 10 });
  assert.equal(saveUserLook(list, '   ', { exposure: 1 }, 'c', 3), null, 'no name');
  assert.equal(saveUserLook(list, 'Nothing', { masks: [] }, 'c', 3), null, 'nothing to keep');
  const full: UserLook[] = Array.from({ length: MAX_USER_LOOKS }, (_, i) => ({ id: `l${i}`, name: `Look ${i}`, recipe: { exposure: 0 }, savedAt: 0 }));
  assert.equal(saveUserLook(full, 'One more', { exposure: 1 }, 'z', 1), null, 'full');
  assert.equal(saveUserLook(full, 'look 3', { exposure: 1 }, 'z', 1)![3].recipe.exposure, 1, 'replacing still works when full');
});

test('renaming refuses a clash or an empty name, removing deletes only that look', () => {
  let list = saveUserLook([], 'One', { exposure: 1 }, 'a', 1)!;
  list = saveUserLook(list, 'Two', { exposure: 2 }, 'b', 1)!;
  assert.equal(renameUserLook(list, 'a', 'two'), null);
  assert.equal(renameUserLook(list, 'a', ' '), null);
  assert.equal(renameUserLook(list, 'missing', 'Three'), null);
  assert.equal(renameUserLook(list, 'a', 'one')![0].name, 'one', 'changing only the case of its own name is fine');
  assert.deepEqual(removeUserLook(list, 'a').map((look) => look.id), ['b']);
});

test('stored looks that are corrupt, duplicated or hostile are left out rather than crashing', () => {
  assert.deepEqual(parseUserLooks(null), []);
  assert.deepEqual(parseUserLooks('{'), []);
  assert.deepEqual(parseUserLooks('{"looks":[]}'), []);
  const list = parseUserLooks(JSON.stringify([
    { id: 'a', name: 'Fine', recipe: { contrast: 500 }, savedAt: 5 },
    { id: 'a', name: 'Same id', recipe: { contrast: 1 } },
    { id: 'b', name: 'fine', recipe: { contrast: 1 } },
    { id: '../../x', name: 'Bad id', recipe: { contrast: 1 } },
    { id: 'c', name: 'Empty', recipe: { masks: [] } },
    { id: 'd', name: '', recipe: { contrast: 1 } },
    null, 7,
  ]));
  assert.deepEqual(list, [{ id: 'a', name: 'Fine', recipe: { contrast: 100 }, savedAt: 5 }]);
});

test('a looks file round-trips, updates looks of the same name, and refuses files it cannot trust', () => {
  let ids = 0;
  const makeId = () => `n${++ids}`;
  const mine = saveUserLook(saveUserLook([], 'Moody', { contrast: 20, exposure: -0.5 }, 'a', 1)!, 'Bright', { exposure: 1 }, 'b', 1)!;
  const file = exportUserLooks(mine);
  assert.ok(!file.includes('"id"'), 'ids stay on the device');
  const elsewhere = importUserLooks([], file, makeId, 9);
  assert.equal(elsewhere.error, undefined);
  assert.deepEqual(elsewhere.looks.map(({ name, recipe }) => ({ name, recipe })), mine.map(({ name, recipe }) => ({ name, recipe })));
  assert.equal(elsewhere.added, 2);

  const update = JSON.stringify({ format: 'kestrel-looks', version: 1, looks: [{ name: 'moody', recipe: { contrast: 999 } }, { name: 'Odd', recipe: { evil: 1 } }, { name: '', recipe: { exposure: 1 } }, null, { name: 'New', recipe: { vibrance: 30 } }] });
  const merged = importUserLooks(mine, update, makeId, 10);
  assert.deepEqual([merged.added, merged.replaced, merged.skipped], [1, 1, 3]);
  assert.equal(merged.looks[0].id, 'a');
  assert.deepEqual(merged.looks[0].recipe, { contrast: 100 });
  assert.equal(merged.looks.length, 3);

  for (const [text, error] of [['nope', 'unreadable'], ['[]', 'not-looks'], ['{"format":"kestrel-keymap","looks":[]}', 'not-looks'], ['{"format":"kestrel-looks","version":2,"looks":[]}', 'newer']] as const) {
    const result = importUserLooks(mine, text, makeId, 11);
    assert.equal(result.error, error);
    assert.equal(result.looks, mine, 'nothing changes on an error');
  }
});
