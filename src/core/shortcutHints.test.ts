import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KEY_BINDINGS } from './keyboardCommands.ts';
import { photoMenuHints } from './shortcutHints.ts';

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
