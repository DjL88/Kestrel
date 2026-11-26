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
  const pad = withPadChord(DEFAULT_PAD, 'K2', 'KeyF'); // F is Flag on the keyboard; K2 runs Set aside
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

test('the keyboard guide lists the pad keys that act, so no key works unseen', async () => {
  const { padGuideRows, DEFAULT_PAD } = await import('./pad');
  const { effectiveKeymap } = await import('./keymap');
  const rows = padGuideRows(DEFAULT_PAD, effectiveKeymap('inflight'));
  const bySlot = Object.fromEntries(rows.map((row) => [row.slot, row]));
  // Z, K, C and Space are pad keys that the keymap does not show, so they are listed.
  assert.deepEqual(bySlot.K4, { slot: 'K4', chord: 'KeyZ', command: 'edit.undo' });
  assert.deepEqual(bySlot.K6, { slot: 'K6', chord: 'Space', command: 'view.grid' });
  // X already sets aside on the keyboard and the arrows already step photos, so they are not repeated.
  assert.equal(bySlot.K2, undefined);
  assert.equal(bySlot.KNOB_CW, undefined);
  // A slot with no command does nothing, so it is not listed.
  assert.equal(padGuideRows({ ...DEFAULT_PAD, K1: { chord: 'KeyK', command: null } }, effectiveKeymap('inflight')).some((row) => row.slot === 'K1'), false);
});

test('pad keys turned off do nothing and leave the guide, and the set-up is kept for turning them on again', async () => {
  const { padInForce, padGuideRows, DEFAULT_PAD, resolveWithPad } = await import('./pad');
  const { effectiveKeymap } = await import('./keymap');
  const keymap = effectiveKeymap('inflight');
  const off = padInForce(DEFAULT_PAD, false);
  const z = { code: 'KeyZ', key: 'z' };
  assert.equal(resolveWithPad({ event: z, keymap, pad: off, isMac: false, inField: false }), null);
  assert.equal(resolveWithPad({ event: z, keymap, pad: padInForce(DEFAULT_PAD, true), isMac: false, inField: false })?.id, 'edit.undo');
  assert.deepEqual(padGuideRows(off, keymap), []);
  // The keyboard's own keys still work with the pad off.
  assert.equal(resolveWithPad({ event: { code: 'KeyX', key: 'x' }, keymap, pad: off, isMac: false, inField: false })?.id, 'photo.reject');
  // Turning off forgets nothing: every slot still has its key.
  for (const slot of Object.keys(DEFAULT_PAD) as (keyof typeof DEFAULT_PAD)[]) assert.equal(off[slot].chord, DEFAULT_PAD[slot].chord);
  assert.equal(padInForce(DEFAULT_PAD, true), DEFAULT_PAD);
});
