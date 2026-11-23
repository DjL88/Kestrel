import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS } from './registry';
import { PRESETS, chordLabel, effectiveKeymap, eventChord, findConflicts, resolveCommand } from './keymap';

const key = (init: Partial<KeyboardEvent> & { code: string; key: string }) => init;

test('has no clashing chords in any built-in preset', () => {
    for (const id of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
      assert.deepEqual(findConflicts(effectiveKeymap(id)), {});
    }
  });

test('gives every command a chord in the InFlight preset', () => {
    const map = effectiveKeymap('inflight');
    for (const command of COMMANDS) assert.ok(map[command.id], command.id);
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
