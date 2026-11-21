import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KEY_BINDINGS } from './keyboardCommands.ts';
import { resolveShortcutAlias } from './shortcutAliases.ts';

const run = (event: Record<string, unknown>, extra: { bindings?: typeof DEFAULT_KEY_BINDINGS; isSuppressed?: boolean } = {}) =>
  resolveShortcutAlias({ event: { key: '', code: '', ...event }, bindings: extra.bindings ?? DEFAULT_KEY_BINDINGS, isSuppressed: extra.isSuppressed ?? false });

test('P picks (keeps), like Lightroom', () => {
  assert.deepEqual(run({ code: 'KeyP', key: 'p' }), { kind: 'command', id: 'cull.keep' });
});
test('Command or Control with Z undoes; with Shift (or Control+Y) redoes', () => {
  assert.deepEqual(run({ code: 'KeyZ', metaKey: true }), { kind: 'command', id: 'cull.undo' });
  assert.deepEqual(run({ code: 'KeyZ', ctrlKey: true }), { kind: 'command', id: 'cull.undo' });
  assert.deepEqual(run({ code: 'KeyZ', metaKey: true, shiftKey: true }), { kind: 'command', id: 'cull.redo' });
  assert.deepEqual(run({ code: 'KeyY', ctrlKey: true }), { kind: 'command', id: 'cull.redo' });
});
test('digits rate 0 to 5; Shift+digit does not', () => {
  assert.deepEqual(run({ code: 'Digit4' }), { kind: 'rate', rating: 4 });
  assert.deepEqual(run({ code: 'Digit0' }), { kind: 'rate', rating: 0 });
  assert.equal(run({ code: 'Digit4', shiftKey: true }), null);
});
test('Mod+E exports, D edits, Mod+/ shows shortcuts', () => {
  assert.deepEqual(run({ code: 'KeyE', metaKey: true }), { kind: 'export' });
  assert.deepEqual(run({ code: 'KeyD' }), { kind: 'edit' });
  assert.deepEqual(run({ code: 'Slash', ctrlKey: true }), { kind: 'command', id: 'cull.toggleShortcuts' });
});
test('a chord the person has bound always wins over an alias', () => {
  assert.equal(run({ code: 'KeyP' }, { bindings: { ...DEFAULT_KEY_BINDINGS, 'cull.compare': 'KeyP' } }), null);
});
test('typing, held keys, Alt chords and IME never trigger an alias', () => {
  assert.equal(run({ code: 'KeyP' }, { isSuppressed: true }), null);
  assert.equal(run({ code: 'Digit3', repeat: true }), null);
  assert.equal(run({ code: 'KeyZ', metaKey: true, altKey: true }), null);
  assert.equal(run({ code: 'KeyP', isComposing: true }), null);
  assert.equal(run({ code: 'KeyZ', metaKey: true, ctrlKey: true }), null);
});
test('plain unrelated keys are untouched', () => {
  assert.equal(run({ code: 'KeyQ' }), null);
});
