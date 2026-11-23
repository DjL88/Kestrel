import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PAD, PAD_SLOTS, padClashes, padSlotFor, resolveWithPad, withPadChord, withPadCommand } from './pad';
import { effectiveKeymap } from './keymap';

const key = (init: Partial<KeyboardEvent> & { code: string; key: string }) => init;
const keymap = effectiveKeymap('inflight');
const run = (event: ReturnType<typeof key>, pad = DEFAULT_PAD, inField = false) => resolveWithPad({ event, keymap, pad, isMac: false, inField })?.id;

test('the default pad keeps the keys V1 pads already send, and runs registry commands', () => {
  assert.equal(run(key({ code: 'KeyK', key: 'k' })), 'photo.flag');
  assert.equal(run(key({ code: 'ArrowRight', key: 'ArrowRight' })), 'photo.next');
  assert.equal(run(key({ code: 'ArrowLeft', key: 'ArrowLeft', repeat: true })), 'photo.prev'); // a dial may repeat
  assert.equal(run(key({ code: 'KeyK', key: 'k', repeat: true })), undefined); // a held decision key does not
  assert.equal(PAD_SLOTS.length, 8);
});

test('a slot can be given another command or another key; pad keys never fire while typing', () => {
  const pad = withPadChord(withPadCommand(DEFAULT_PAD, 'K1', 'photo.rate5'), 'K1', 'KeyJ');
  assert.equal(run(key({ code: 'KeyJ', key: 'j' }), pad), 'photo.rate5');
  assert.equal(run(key({ code: 'KeyK', key: 'k' }), pad), undefined);
  assert.equal(run(key({ code: 'KeyJ', key: 'j' }), pad, true), undefined);
  assert.equal(padSlotFor(key({ code: 'KeyJ', key: 'j' }), pad, false), 'K1');
});

test('a pad key that is also a keyboard shortcut for another command runs nothing and is reported', () => {
  const pad = withPadChord(DEFAULT_PAD, 'K2', 'KeyF'); // F is Flag on the keyboard; K2 runs Clear rating
  assert.equal(run(key({ code: 'KeyF', key: 'f' }), pad), undefined);
  assert.deepEqual(padClashes(pad, keymap).map((c) => c.slot), ['K2']);
  assert.deepEqual(padClashes(DEFAULT_PAD, keymap), []);
});

test('the same command on the keyboard and the pad is not a clash', () => {
  const pad = withPadChord(withPadCommand(DEFAULT_PAD, 'K1', 'photo.flag'), 'K1', 'KeyF');
  assert.equal(run(key({ code: 'KeyF', key: 'f' }), pad), 'photo.flag');
  assert.deepEqual(padClashes(pad, keymap), []);
});

test('an unassigned slot runs nothing', () => {
  assert.equal(run(key({ code: 'KeyK', key: 'k' }), withPadCommand(DEFAULT_PAD, 'K1', null)), undefined);
});
