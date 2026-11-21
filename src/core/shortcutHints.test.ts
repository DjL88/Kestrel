import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KEY_BINDINGS } from './keyboardCommands.ts';
import { ariaShortcutFromHint, photoMenuHints } from './shortcutHints.ts';

test('hints follow the person\'s own bindings', () => {
  const hints = photoMenuHints({ ...DEFAULT_KEY_BINDINGS, 'cull.keep': 'KeyJ' }, true);
  assert.equal(hints.keep, 'J');
  assert.equal(hints.trash, 'X');
  assert.equal(hints.copy, '⇧C');
  assert.equal(hints.export, '⌘E');
});
test('Windows and Linux show Ctrl', () => {
  assert.equal(photoMenuHints(DEFAULT_KEY_BINDINGS, false).export, 'Ctrl+E');
});

test('alias hints do not promise actions shadowed by a custom binding', () => {
  const hints = photoMenuHints({
    ...DEFAULT_KEY_BINDINGS,
    'cull.compare': 'KeyD',
    'cull.toggleGrid': 'Digit3',
    'cull.toggleZoom': 'Meta+KeyE',
  }, true);
  assert.equal(hints.edit, undefined, 'D is bound to Compare');
  assert.equal(hints.rate3, undefined, '3 is assigned elsewhere');
  assert.equal(hints.export, undefined, 'Command+E is assigned elsewhere');
  assert.equal(hints.rate5, '5', 'other ratings stay available');
});

test('accessible shortcut names use WAI-ARIA key values, not display glyphs', () => {
  assert.equal(ariaShortcutFromHint('⌘E'), 'Meta+E');
  assert.equal(ariaShortcutFromHint('⇧C'), 'Shift+C');
  assert.equal(ariaShortcutFromHint('Ctrl+E'), 'Control+E');
  assert.equal(ariaShortcutFromHint('5'), '5');
  assert.equal(ariaShortcutFromHint('→'), 'ArrowRight');
  assert.equal(ariaShortcutFromHint(undefined), undefined);
  assert.equal(ariaShortcutFromHint('Unknown'), undefined);
});
