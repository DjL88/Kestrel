import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_KEY_BINDINGS,
  detectKeymapConflicts,
  formatChordLabel,
  normalizeKeyChord,
  resolveKeyboardCommand,
} from './keyboardCommands';

test('normalizeKeyChord builds deterministic chord strings and ignores standalone modifiers', () => {
  assert.equal(normalizeKeyChord({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), null);
  assert.equal(normalizeKeyChord({ key: 'k', code: 'KeyK' }), 'KeyK');
  assert.equal(
    normalizeKeyChord({ key: 'Z', code: 'KeyZ', shiftKey: true }),
    'Shift+KeyZ'
  );
  assert.equal(normalizeKeyChord({ key: ' ', code: 'Space' }), 'Space');
});

test('resolveKeyboardCommand blocks decision repeat while allowing navigation repeat', () => {
  const keepInitial = resolveKeyboardCommand({
    event: { key: 'k', code: 'KeyK', repeat: false },
    bindings: DEFAULT_KEY_BINDINGS,
    activeMode: 'cull',
    isSuppressed: false,
  });
  assert.equal(keepInitial?.id, 'cull.keep');

  const keepRepeated = resolveKeyboardCommand({
    event: { key: 'k', code: 'KeyK', repeat: true },
    bindings: DEFAULT_KEY_BINDINGS,
    activeMode: 'cull',
    isSuppressed: false,
  });
  assert.equal(keepRepeated, null);

  const navRepeated = resolveKeyboardCommand({
    event: { key: 'ArrowRight', code: 'ArrowRight', repeat: true },
    bindings: DEFAULT_KEY_BINDINGS,
    activeMode: 'cull',
    isSuppressed: false,
  });
  assert.equal(navRepeated?.id, 'cull.knobCw');
});

test('resolveKeyboardCommand suppresses all commands when typing or inside modal', () => {
  const suppressed = resolveKeyboardCommand({
    event: { key: 'k', code: 'KeyK', repeat: false },
    bindings: DEFAULT_KEY_BINDINGS,
    activeMode: 'cull',
    isSuppressed: true,
  });
  assert.equal(suppressed, null);
});

test('detectKeymapConflicts finds duplicate bindings within a mode', () => {
  assert.deepEqual(detectKeymapConflicts(DEFAULT_KEY_BINDINGS, 'cull'), {});

  const conflicted = {
    ...DEFAULT_KEY_BINDINGS,
    'cull.reject': 'KeyK',
  };
  const conflicts = detectKeymapConflicts(conflicted, 'cull');
  assert.deepEqual(conflicts['KeyK'], ['cull.keep', 'cull.reject']);
});

test('formatChordLabel produces concise readable keycaps', () => {
  assert.equal(formatChordLabel('KeyK'), 'K');
  assert.equal(formatChordLabel('Shift+KeyZ'), 'Shift+Z');
  assert.equal(formatChordLabel('ArrowRight'), '→');
});


test('ambiguous remapped culling shortcuts never trigger an arbitrary decision', () => {
  const bindings = { ...DEFAULT_KEY_BINDINGS, 'cull.reject': 'KeyK' };
  assert.equal(resolveKeyboardCommand({
    event: { key: 'k', code: 'KeyK' }, bindings, activeMode: 'cull', isSuppressed: false,
  }), null);
  // A non-conflicting command remains usable.
  assert.equal(resolveKeyboardCommand({
    event: { key: 'u', code: 'KeyU' }, bindings, activeMode: 'cull', isSuppressed: false,
  })?.id, 'cull.unreviewed');
  // Conflicts are scoped to the active mode, not all commands.
  const crossMode = { ...DEFAULT_KEY_BINDINGS, 'edit.copy': 'KeyK' };
  assert.equal(resolveKeyboardCommand({
    event: { key: 'k', code: 'KeyK' }, bindings: crossMode, activeMode: 'cull', isSuppressed: false,
  })?.id, 'cull.keep');
});

test('code-less keyboard events retain punctuation shortcut bindings', () => {
  const cases: Array<[string, string]> = [
    ['/', 'Slash'], ['\\', 'Backslash'], ['-', 'Minus'],
    ['=', 'Equal'], ['[', 'BracketLeft'], [']', 'BracketRight'],
    [',', 'Comma'], ['.', 'Period'],
  ];
  for (const [key, chord] of cases) {
    assert.equal(normalizeKeyChord({ key, code: '' }), chord);
  }
  assert.equal(resolveKeyboardCommand({
    event: { key: '/', code: '' },
    bindings: DEFAULT_KEY_BINDINGS, activeMode: 'cull', isSuppressed: false,
  })?.id, 'cull.toggleShortcuts');
  assert.equal(resolveKeyboardCommand({
    event: { key: '\\', code: '' },
    bindings: DEFAULT_KEY_BINDINGS, activeMode: 'edit', isSuppressed: false,
  })?.id, 'edit.beforeAfter');
});


test('IME composition and dead keys never keep or reject photos', () => {
  for (const event of [
    { key: 'k', code: 'KeyK', isComposing: true },
    { key: 'x', code: 'KeyX', isComposing: true },
    { key: 'Process', code: 'KeyK' },
    { key: 'Dead', code: 'KeyX' },
    { key: 'k', code: 'KeyK', keyCode: 229 },
  ]) {
    assert.equal(resolveKeyboardCommand({ event, bindings: DEFAULT_KEY_BINDINGS,
      activeMode: 'cull', isSuppressed: false }), null);
  }
  assert.equal(resolveKeyboardCommand({ event: { key: 'k', code: 'KeyK', isComposing: false },
    bindings: DEFAULT_KEY_BINDINGS, activeMode: 'cull', isSuppressed: false })?.id, 'cull.keep');
});
