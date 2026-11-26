import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS } from './registry';
import {
  BUTTON_REPEAT_DELAY_MS, BUTTON_REPEAT_MS, DEFAULT_GAMEPAD, EMPTY_GAMEPAD_STATE, GAMEPAD_SLOTS, GAMEPAD_SLOT_LABELS, STICK_FASTEST_MS, STICK_SLOWEST_MS,
  firstGamepad, parseGamepadProfile, slotStrengths, stepGamepad, stickRepeatMs, withGamepadCommand, type GamepadSnapshot,
} from './gamepad';

/** A standard-layout controller at rest, with some buttons held and some axes moved. */
function pad(pressed: number[] = [], axes: number[] = [0, 0, 0, 0], values: Record<number, number> = {}): GamepadSnapshot {
  return {
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: values[i] ?? (pressed.includes(i) ? 1 : 0) })),
    axes,
  };
}

test('the starting set-up culls on the D-pad and turns sliders with the sticks', () => {
  assert.equal(DEFAULT_GAMEPAD.LEFT, 'photo.prev');
  assert.equal(DEFAULT_GAMEPAD.RIGHT, 'photo.next');
  assert.equal(DEFAULT_GAMEPAD.UP, 'photo.rateUp');
  assert.equal(DEFAULT_GAMEPAD.DOWN, 'photo.rateDown');
  assert.equal(DEFAULT_GAMEPAD['LX+'], 'adjust.sliderUp');
  assert.equal(DEFAULT_GAMEPAD['RX-'], 'adjust.sliderDownMore');
  const known = new Set(COMMANDS.map((c) => c.id));
  for (const slot of GAMEPAD_SLOTS) {
    assert.ok(GAMEPAD_SLOT_LABELS[slot], `label for ${slot}`);
    const command = DEFAULT_GAMEPAD[slot];
    if (command) assert.ok(known.has(command), `${slot} runs a real command`);
  }
});

test('a button press runs its command once, and a decision never repeats while held', () => {
  let state = EMPTY_GAMEPAD_STATE;
  let result = stepGamepad(state, pad([0]), 0, DEFAULT_GAMEPAD);
  assert.deepEqual(result.fired, [{ slot: 'A', command: 'photo.flag', first: true }]);
  state = result.state;
  for (const t of [100, 500, 1000, 3000]) {
    result = stepGamepad(state, pad([0]), t, DEFAULT_GAMEPAD);
    assert.deepEqual(result.fired, [], `no repeat at ${t} ms`);
    state = result.state;
  }
  // Let go and press again: runs again.
  state = stepGamepad(state, pad(), 3100, DEFAULT_GAMEPAD).state;
  assert.equal(stepGamepad(state, pad([0]), 3200, DEFAULT_GAMEPAD).fired.length, 1);
});

test('a held D-pad right repeats next photo after a pause, like a held key', () => {
  let state = stepGamepad(EMPTY_GAMEPAD_STATE, pad([15]), 0, DEFAULT_GAMEPAD).state;
  let result = stepGamepad(state, pad([15]), BUTTON_REPEAT_DELAY_MS - 1, DEFAULT_GAMEPAD);
  assert.deepEqual(result.fired, []);
  state = result.state;
  result = stepGamepad(state, pad([15]), BUTTON_REPEAT_DELAY_MS, DEFAULT_GAMEPAD);
  assert.deepEqual(result.fired, [{ slot: 'RIGHT', command: 'photo.next', first: false }]);
  state = result.state;
  assert.deepEqual(stepGamepad(state, pad([15]), BUTTON_REPEAT_DELAY_MS + BUTTON_REPEAT_MS - 1, DEFAULT_GAMEPAD).fired, []);
  assert.equal(stepGamepad(state, pad([15]), BUTTON_REPEAT_DELAY_MS + BUTTON_REPEAT_MS, DEFAULT_GAMEPAD).fired.length, 1);
});

test('a stick inside the deadzone does nothing, so a worn stick never edits', () => {
  assert.equal(slotStrengths(pad([], [0.25, -0.29, 0.1, 0])).size, 0);
  assert.deepEqual(stepGamepad(EMPTY_GAMEPAD_STATE, pad([], [0.29, 0, 0, 0]), 0, DEFAULT_GAMEPAD).fired, []);
});

test('pushing the left stick right nudges the slider up, and harder pushes repeat faster', () => {
  const first = stepGamepad(EMPTY_GAMEPAD_STATE, pad([], [0.5, 0, 0, 0]), 0, DEFAULT_GAMEPAD);
  assert.deepEqual(first.fired, [{ slot: 'LX+', command: 'adjust.sliderUp', first: true }]);
  const gentle = stickRepeatMs(0.5);
  assert.deepEqual(stepGamepad(first.state, pad([], [0.5, 0, 0, 0]), gentle - 1, DEFAULT_GAMEPAD).fired, []);
  assert.equal(stepGamepad(first.state, pad([], [0.5, 0, 0, 0]), gentle, DEFAULT_GAMEPAD).fired.length, 1);
  assert.equal(stickRepeatMs(1), STICK_FASTEST_MS);
  assert.equal(stickRepeatMs(0.3), STICK_SLOWEST_MS);
  assert.ok(stickRepeatMs(0.9) < stickRepeatMs(0.5));
});

test('the right stick left turns the slider down ten steps', () => {
  assert.deepEqual(stepGamepad(EMPTY_GAMEPAD_STATE, pad([], [0, 0, -1, 0]), 0, DEFAULT_GAMEPAD).fired, [{ slot: 'RX-', command: 'adjust.sliderDownMore', first: true }]);
});

test('a stick held near the edge of the deadzone does not flicker on and off', () => {
  const on = stepGamepad(EMPTY_GAMEPAD_STATE, pad([], [0.35, 0, 0, 0]), 0, DEFAULT_GAMEPAD);
  assert.equal(on.fired.length, 1);
  // Drifts to 0.25: under the deadzone but over the release point, so it is still the same push, not a new one.
  const still = stepGamepad(on.state, pad([], [0.25, 0, 0, 0]), 10, DEFAULT_GAMEPAD);
  assert.deepEqual(still.fired, []);
  assert.ok(still.state.held.has('LX+'));
  const off = stepGamepad(still.state, pad([], [0.1, 0, 0, 0]), 20, DEFAULT_GAMEPAD);
  assert.equal(off.state.held.size, 0);
});

test('triggers count past half way, whatever the pressed flag says', () => {
  assert.equal(slotStrengths(pad([], undefined, { 7: 0.4 })).has('RT'), false);
  assert.equal(slotStrengths(pad([], undefined, { 7: 0.6 })).has('RT'), true);
});

test('a remapped slot runs the new command, and an empty slot still reports the press for Settings', () => {
  const profile = withGamepadCommand(withGamepadCommand(DEFAULT_GAMEPAD, 'A', 'photo.rate5'), 'B', null);
  assert.deepEqual(stepGamepad(EMPTY_GAMEPAD_STATE, pad([0, 1]), 0, profile).fired, [
    { slot: 'A', command: 'photo.rate5', first: true },
    { slot: 'B', command: null, first: true },
  ]);
  assert.equal(DEFAULT_GAMEPAD.A, 'photo.flag', 'the starting set-up is not changed');
});

test('no controller clears what was held', () => {
  const held = stepGamepad(EMPTY_GAMEPAD_STATE, pad([0]), 0, DEFAULT_GAMEPAD).state;
  const gone = stepGamepad(held, null, 10, DEFAULT_GAMEPAD);
  assert.equal(gone.state.held.size, 0);
  assert.deepEqual(gone.fired, []);
});

test('a saved set-up keeps known commands, clears on null and ignores anything else', () => {
  const parsed = parseGamepadProfile(JSON.stringify({ A: 'photo.rate3', B: null, X: 'format.harddrive', Y: 42, nonsense: 'photo.flag' }));
  assert.equal(parsed.A, 'photo.rate3');
  assert.equal(parsed.B, null);
  assert.equal(parsed.X, DEFAULT_GAMEPAD.X);
  assert.equal(parsed.Y, DEFAULT_GAMEPAD.Y);
  assert.equal(parseGamepadProfile('not json'), DEFAULT_GAMEPAD);
  assert.equal(parseGamepadProfile(null), DEFAULT_GAMEPAD);
  assert.equal(parseGamepadProfile('[1,2]').A, DEFAULT_GAMEPAD.A);
});

test('the first connected controller is used', () => {
  const a = { connected: false } as Gamepad;
  const b = { connected: true, id: 'two' } as Gamepad;
  assert.equal(firstGamepad([null, a, b]), b);
  assert.equal(firstGamepad([]), null);
  assert.equal(firstGamepad(undefined), null);
});
