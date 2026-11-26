import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, availableCommands } from './registry';
import { PRESETS, commandsUsing, withChord, withoutOverride, chordLabel, effectiveKeymap, eventChord, exportKeymap, findConflicts, importKeymap, resolveCommand } from './keymap';

const key = (init: Partial<KeyboardEvent> & { code: string; key: string }) => init;

test('has no clashing chords in any built-in preset', () => {
    for (const id of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
      assert.deepEqual(findConflicts(effectiveKeymap(id)), {});
    }
  });

test('gives every command a chord in the InFlight preset', () => {
    const map = effectiveKeymap('inflight');
    // Next and previous photo are for a macro pad dial for now: arrow keys would fight the Compare slider.
  // Fit and 100% wait for the macro pad decision (Lightroom's Z is the pad's Undo), so they start without a key.
  // Slider nudges are for dials and pads, which send whatever key they are set to.
  const keyless = new Set(['photo.next', 'photo.prev', 'view.zoomFit', 'view.zoom100', 'adjust.sliderUp', 'adjust.sliderDown', 'adjust.sliderUpMore', 'adjust.sliderDownMore', 'photo.rateUp', 'photo.rateDown']);
  for (const command of COMMANDS.filter((c) => !keyless.has(c.id) && !c.preview)) assert.ok(map[command.id], command.id);
  });

test('a preview command has its key only while the preview is on, so an off preview never takes a key', () => {
  for (const preset of ['inflight', 'lightroom'] as const) {
    const off = effectiveKeymap(preset);
    const on = effectiveKeymap(preset, {}, { nextToReview: true });
    assert.equal(off['photo.nextToReview'], undefined);
    assert.equal(off['photo.prevToReview'], undefined);
    assert.equal(on['photo.nextToReview'], 'KeyN');
    assert.equal(on['photo.prevToReview'], 'Shift+KeyN');
    assert.deepEqual(findConflicts(on), {}, preset);
  }
  // Someone who already put N on another command keeps it working while the preview is off: no ambiguity.
  const mine = effectiveKeymap('inflight', { 'view.grid': 'KeyN' });
  assert.equal(resolveCommand({ event: key({ code: 'KeyN', key: 'n' }), keymap: mine, isMac: false, inField: false })?.id, 'view.grid');
  assert.deepEqual(availableCommands().filter((c) => c.preview), []);
  assert.deepEqual(availableCommands({ nextToReview: true }).filter((c) => c.preview).map((c) => c.id), ['photo.nextToReview', 'photo.prevToReview']);
});

test('reads Cmd as Mod on a Mac and Ctrl as Mod elsewhere', () => {
    assert.equal(eventChord(key({ code: 'KeyZ', key: 'z', metaKey: true }), true), 'Mod+KeyZ');
    assert.equal(eventChord(key({ code: 'KeyZ', key: 'z', ctrlKey: true }), true), 'Mod+KeyZ');
    assert.equal(eventChord(key({ code: 'KeyZ', key: 'z', ctrlKey: true, metaKey: true }), true), 'Mod+Ctrl+KeyZ');
    assert.equal(eventChord(key({ code: 'KeyZ', key: 'z', ctrlKey: true, shiftKey: true }), false), 'Mod+Shift+KeyZ');
  });

test('runs a command only when exactly one command owns the chord', () => {
    const map = effectiveKeymap('inflight');
    const undo = resolveCommand({ event: key({ code: 'KeyZ', key: 'z', ctrlKey: true }), keymap: map, isMac: false, inField: false });
    assert.equal(undo?.id, 'edit.undo');
    const clash = { ...map, 'view.grid': 'KeyF' };
    assert.equal(resolveCommand({ event: key({ code: 'KeyF', key: 'f' }), keymap: clash, isMac: false, inField: false }), null);
  });

test('never fires plain keys while typing, but Export and Settings still work', () => {
    const map = effectiveKeymap('inflight');
    assert.equal(resolveCommand({ event: key({ code: 'KeyF', key: 'f' }), keymap: map, isMac: false, inField: true }), null);
    assert.equal(resolveCommand({ event: key({ code: 'KeyE', key: 'e', ctrlKey: true }), keymap: map, isMac: false, inField: true })?.id, 'file.export');
  });

test('ignores held keys for decisions, IME composition and standalone modifiers', () => {
    const map = effectiveKeymap('inflight');
    assert.equal(resolveCommand({ event: key({ code: 'KeyF', key: 'f', repeat: true }), keymap: map, isMac: false, inField: false }), null);
    assert.equal(resolveCommand({ event: key({ code: 'KeyF', key: 'f', isComposing: true }), keymap: map, isMac: false, inField: false }), null);
    assert.equal(eventChord(key({ code: 'ShiftLeft', key: 'Shift' }), false), null);
  });

test('matches ? by character so any keyboard layout works', () => {
    const map = effectiveKeymap('inflight');
    assert.equal(resolveCommand({ event: key({ code: 'Slash', key: '?', shiftKey: true }), keymap: map, isMac: false, inField: false })?.id, 'help.toggle');
  });

test('applies overrides, and an empty override unbinds', () => {
    const map = effectiveKeymap('inflight', { 'photo.flag': 'KeyP', 'view.grid': '' });
    assert.equal(map['photo.flag'], 'KeyP');
    assert.equal(map['view.grid'], undefined);
  });

test('shows platform wording', () => {
    assert.equal(chordLabel('Mod+Shift+KeyZ', true), 'Cmd+Shift+Z');
    assert.equal(chordLabel('Mod+KeyE', false), 'Ctrl+E');
    assert.equal(chordLabel(undefined, false), 'Not set');
  });

test('Cmd/Ctrl+K opens command search, including while typing', () => {
    const map = effectiveKeymap('inflight');
    assert.equal(map['app.commandSearch'], 'Mod+KeyK');
    assert.equal(resolveCommand({ event: key({ code: 'KeyK', key: 'k', ctrlKey: true }), keymap: map, isMac: false, inField: false })?.id, 'app.commandSearch');
    assert.equal(resolveCommand({ event: key({ code: 'KeyK', key: 'k', ctrlKey: true }), keymap: map, isMac: false, inField: true })?.id, 'app.commandSearch');
    assert.deepEqual(findConflicts(map), {});
  });

test('a chord equal to the preset default is stored as no override; reset removes an override', () => {
  const base = { preset: 'inflight' as const, overrides: {} };
  const changed = withChord(base, 'photo.flag', 'KeyP');
  assert.deepEqual(changed.overrides, { 'photo.flag': 'KeyP' });
  assert.deepEqual(withChord(changed, 'photo.flag', 'KeyF').overrides, {});
  assert.deepEqual(withoutOverride(changed, 'photo.flag').overrides, {});
  assert.deepEqual(withChord(base, 'view.grid', '').overrides, { 'view.grid': '' });
});

test('assigning a chord another command uses is allowed but reported, never silently resolved', () => {
  const saved = withChord({ preset: 'inflight', overrides: {} }, 'view.grid', 'KeyF');
  const map = effectiveKeymap(saved.preset, saved.overrides);
  assert.deepEqual(commandsUsing(map, 'KeyF', 'view.grid'), ['photo.flag']);
  assert.deepEqual(Object.values(findConflicts(map))[0].sort(), ['photo.flag', 'view.grid']);
});

test('a keymap exports and re-imports to the exact same keymap', () => {
  const saved = withChord({ preset: 'lightroom' as const, overrides: {} }, 'photo.flag', 'KeyP');
  const result = importKeymap(exportKeymap(saved));
  assert.ok(result.ok);
  if (result.ok) {
    assert.deepEqual(result.keymap, saved);
    assert.deepEqual(result.dropped, []);
  }
});

test('import refuses a file that is not JSON, not a keymap export, or from a newer format version', () => {
  assert.deepEqual(importKeymap('not json'), { ok: false, error: 'That file is not valid JSON.' });
  assert.deepEqual(importKeymap('null'), { ok: false, error: 'That file is not a keymap export.' });
  assert.deepEqual(importKeymap('[]'), { ok: false, error: 'That file is not an InFlight keymap export.' });
  assert.deepEqual(importKeymap(JSON.stringify({ foo: 'bar' })), { ok: false, error: 'That file is not an InFlight keymap export.' });
  const future = importKeymap(JSON.stringify({ kind: 'kestrel-keymap', version: 99, preset: 'inflight', overrides: {} }));
  assert.equal(future.ok, false);
  const badPreset = importKeymap(JSON.stringify({ kind: 'kestrel-keymap', version: 1, preset: 'photomechanic', overrides: {} }));
  assert.deepEqual(badPreset, { ok: false, error: 'That file does not name a key set InFlight knows.' });
});

test('import drops an unknown command id or an overlong chord, and names what it dropped, without failing the rest', () => {
  const overrides = { 'photo.flag': 'KeyP', 'not.a.real.command': 'KeyX', 'view.grid': 'x'.repeat(40) };
  const result = importKeymap(JSON.stringify({ kind: 'kestrel-keymap', version: 1, preset: 'inflight', overrides }));
  assert.ok(result.ok);
  if (result.ok) {
    assert.deepEqual(result.keymap.overrides, { 'photo.flag': 'KeyP' });
    assert.deepEqual(result.dropped.sort(), ['not.a.real.command', 'view.grid']);
  }
});

test('import keeps a deliberately unbound command (the empty-string override)', () => {
  const result = importKeymap(JSON.stringify({ kind: 'kestrel-keymap', version: 1, preset: 'inflight', overrides: { 'view.grid': '' } }));
  assert.ok(result.ok);
  if (result.ok) assert.deepEqual(result.keymap.overrides, { 'view.grid': '' });
});

test('culling keys in every preset: arrows move between photos, X sets aside, U clears, with no clash', () => {
  for (const preset of Object.values(PRESETS)) {
    assert.equal(preset.keymap['photo.next'], 'ArrowRight');
    assert.equal(preset.keymap['photo.prev'], 'ArrowLeft');
    assert.equal(preset.keymap['photo.reject'], 'KeyX');
    assert.equal(preset.keymap['photo.unflag'], 'KeyU');
    const chords = Object.values(preset.keymap);
    assert.equal(new Set(chords).size, chords.length, 'one command per key');
  }
});

test('a key a control already used never runs a shortcut too', async () => {
  const { keyAlreadyHandled } = await import('./keymap');
  const el = (tagName: string, attrs: Record<string, string> = {}, type?: string) => ({ tagName, type, getAttribute: (name: string) => attrs[name] ?? null });
  // The Adjust tabs move with the arrows and call preventDefault: the photo must not change as well.
  assert.equal(keyAlreadyHandled(el('BUTTON', { role: 'tab' }), { key: 'ArrowRight', defaultPrevented: true }), true);
  // Space and Enter press a focused button, link, tab, menu item, option or checkbox, never a shortcut such as the pad's Space.
  for (const target of [el('BUTTON'), el('A'), el('DIV', { role: 'menuitem' }), el('DIV', { role: 'option' }), el('INPUT', {}, 'checkbox'), el('SUMMARY')]) {
    assert.equal(keyAlreadyHandled(target, { key: ' ' }), true, target.tagName);
    assert.equal(keyAlreadyHandled(target, { key: 'Enter' }), true, target.tagName);
  }
  // Arrow keys on a filmstrip thumbnail or a plain button still step through photos; letters still rate and flag.
  assert.equal(keyAlreadyHandled(el('DIV', { role: 'option' }), { key: 'ArrowRight' }), false);
  assert.equal(keyAlreadyHandled(el('BUTTON'), { key: 'ArrowLeft' }), false);
  assert.equal(keyAlreadyHandled(el('BUTTON'), { key: 'x' }), false);
  // Space on the photo itself, or with Cmd/Ctrl held, is left to the keymap.
  assert.equal(keyAlreadyHandled(el('DIV'), { key: ' ' }), false);
  assert.equal(keyAlreadyHandled(el('BUTTON'), { key: 'Enter', metaKey: true }), false);
  assert.equal(keyAlreadyHandled(null, { key: ' ' }), false);
});

test('+ and - zoom from either key of the pair and the number pad, and Cmd/Ctrl with them stays browser zoom', () => {
  const map = effectiveKeymap('inflight');
  const run = (init: Partial<KeyboardEvent> & { code: string; key: string }) => resolveCommand({ event: key(init), keymap: map, isMac: false, inField: false })?.id ?? null;
  assert.equal(run({ code: 'Equal', key: '=' }), 'view.zoomIn');
  assert.equal(run({ code: 'Equal', key: '+', shiftKey: true }), 'view.zoomIn');
  assert.equal(run({ code: 'NumpadAdd', key: '+' }), 'view.zoomIn');
  assert.equal(run({ code: 'Minus', key: '-' }), 'view.zoomOut');
  assert.equal(run({ code: 'NumpadSubtract', key: '-' }), 'view.zoomOut');
  assert.equal(run({ code: 'Equal', key: '=', ctrlKey: true }), null);
  assert.equal(run({ code: 'Minus', key: '-', ctrlKey: true }), null);
  // Typing a minus sign in a number field never zooms.
  assert.equal(resolveCommand({ event: key({ code: 'Minus', key: '-' }), keymap: map, isMac: false, inField: true }), null);
});

test('Ctrl+Y redoes and F11 is full screen on Windows, alongside the key set, and never on a Mac', async () => {
  const { keyboardMatches, chordsLabel, alternateChords } = await import('./keymap');
  const map = effectiveKeymap('inflight');
  const run = (init: Partial<KeyboardEvent> & { code: string; key: string }, isMac: boolean) => resolveCommand({ event: key(init), keymap: map, isMac, inField: false })?.id ?? null;
  assert.equal(run({ code: 'KeyY', key: 'y', ctrlKey: true }, false), 'edit.redo');
  assert.equal(run({ code: 'KeyZ', key: 'z', ctrlKey: true, shiftKey: true }, false), 'edit.redo');
  assert.equal(run({ code: 'F11', key: 'F11' }, false), 'view.fullscreen');
  assert.equal(run({ code: 'KeyY', key: 'y', metaKey: true }, true), null);
  assert.equal(chordsLabel('edit.redo', map, false), 'Ctrl+Shift+Z / Ctrl+Y');
  assert.equal(chordsLabel('edit.redo', map, true), 'Cmd+Shift+Z');
  // A person's own key wins: Ctrl+Y given to Export means Export, and Redo keeps only its own key.
  const mine = { ...map, 'file.export': 'Mod+KeyY' };
  assert.deepEqual(keyboardMatches('Mod+KeyY', mine, false).map((c) => c.id), ['file.export']);
  assert.deepEqual(alternateChords('edit.redo', mine, false), []);
  // Clearing Redo clears its second key too.
  const cleared = { ...map }; delete cleared['edit.redo'];
  assert.equal(resolveCommand({ event: key({ code: 'KeyY', key: 'y', ctrlKey: true }), keymap: cleared, isMac: false, inField: false }), null);
});

test('Lightroom keys: E for a single photo, F6 for the filmstrip, Cmd/Ctrl+D to select no photos', () => {
  const lr = effectiveKeymap('lightroom');
  assert.equal(lr['view.loupe'], 'KeyE');
  assert.equal(lr['view.filmstrip'], 'F6');
  assert.equal(lr['edit.selectNone'], 'Mod+KeyD');
  assert.equal(effectiveKeymap('inflight')['edit.selectNone'], 'Mod+Shift+KeyA');
});
