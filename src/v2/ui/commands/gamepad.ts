import { COMMANDS, type CommandId } from './registry';

/**
 * Game controllers (Xbox, PlayStation, Switch Pro and others the browser reads through the Gamepad API).
 * A controller is not a keyboard, so it gets its own map: each button, and each direction of each stick, runs one
 * registry command. The sticks drive the slider in use through the same nudge commands as a dial (adjust.slider*),
 * so a stick edit is the same reversible edit as a drag. Off by default (Settings > Keyboard > Game controller).
 *
 * Slots follow the browser's "standard" layout, so the same physical button is the same slot on every platform.
 * Names are by position, because Xbox and PlayStation print different letters on the same buttons.
 * NOT VERIFIED on a real controller in Kestrel yet; the browser test drives a mocked one.
 */
export const GAMEPAD_BUTTON_SLOTS = [
  'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'BACK', 'START', 'LS', 'RS', 'UP', 'DOWN', 'LEFT', 'RIGHT',
] as const;
export const GAMEPAD_AXIS_SLOTS = ['LX-', 'LX+', 'LY-', 'LY+', 'RX-', 'RX+', 'RY-', 'RY+'] as const;
export const GAMEPAD_SLOTS = [...GAMEPAD_BUTTON_SLOTS, ...GAMEPAD_AXIS_SLOTS] as const;
export type GamepadButtonSlot = (typeof GAMEPAD_BUTTON_SLOTS)[number];
export type GamepadAxisSlot = (typeof GAMEPAD_AXIS_SLOTS)[number];
export type GamepadSlot = (typeof GAMEPAD_SLOTS)[number];

/** Button index in the standard layout (https://w3c.github.io/gamepad/#remapping). 16 (Home) is left to the system. */
const BUTTON_INDEX: Record<GamepadButtonSlot, number> = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};
/** Axis index and sign. Stick up is negative in the standard layout. */
const AXIS_INDEX: Record<GamepadAxisSlot, { axis: number; sign: -1 | 1 }> = {
  'LX-': { axis: 0, sign: -1 }, 'LX+': { axis: 0, sign: 1 }, 'LY-': { axis: 1, sign: -1 }, 'LY+': { axis: 1, sign: 1 },
  'RX-': { axis: 2, sign: -1 }, 'RX+': { axis: 2, sign: 1 }, 'RY-': { axis: 3, sign: -1 }, 'RY+': { axis: 3, sign: 1 },
};

export const GAMEPAD_SLOT_LABELS: Record<GamepadSlot, string> = {
  A: 'Bottom button (A, Cross)', B: 'Right button (B, Circle)', X: 'Left button (X, Square)', Y: 'Top button (Y, Triangle)',
  LB: 'Left shoulder button', RB: 'Right shoulder button', LT: 'Left trigger', RT: 'Right trigger',
  BACK: 'View or Share button', START: 'Menu or Options button', LS: 'Left stick pressed in', RS: 'Right stick pressed in',
  UP: 'D-pad up', DOWN: 'D-pad down', LEFT: 'D-pad left', RIGHT: 'D-pad right',
  'LX-': 'Left stick left', 'LX+': 'Left stick right', 'LY-': 'Left stick up', 'LY+': 'Left stick down',
  'RX-': 'Right stick left', 'RX+': 'Right stick right', 'RY-': 'Right stick up', 'RY+': 'Right stick down',
};

export type GamepadProfile = Record<GamepadSlot, CommandId | null>;

/**
 * Starting set-up: the D-pad culls (left and right move between photos, up and down change the star rating), the face
 * buttons decide, the shoulders undo and redo, the triggers zoom, and the sticks turn the slider in use
 * (left stick one step at a time, right stick ten). Up and down on the sticks start empty.
 */
export const DEFAULT_GAMEPAD: GamepadProfile = {
  A: 'photo.flag', B: 'photo.reject', X: 'photo.unflag', Y: 'view.compare',
  LB: 'edit.undo', RB: 'edit.redo', LT: 'view.zoomOut', RT: 'view.zoomIn',
  BACK: 'help.toggle', START: 'view.grid', LS: null, RS: 'view.zoom100',
  UP: 'photo.rateUp', DOWN: 'photo.rateDown', LEFT: 'photo.prev', RIGHT: 'photo.next',
  'LX-': 'adjust.sliderDown', 'LX+': 'adjust.sliderUp', 'LY-': null, 'LY+': null,
  'RX-': 'adjust.sliderDownMore', 'RX+': 'adjust.sliderUpMore', 'RY-': null, 'RY+': null,
};

export function withGamepadCommand(profile: GamepadProfile, slot: GamepadSlot, command: CommandId | null): GamepadProfile {
  return { ...profile, [slot]: command };
}

/** What the browser gives for one controller, cut down to what the mapping reads (so tests need no real Gamepad). */
export interface GamepadSnapshot {
  buttons: ReadonlyArray<{ pressed: boolean; value: number }>;
  axes: ReadonlyArray<number>;
}

/** A stick has to move this far before it counts, so a worn stick resting off-centre never edits anything. */
export const STICK_DEADZONE = 0.3;
/** Once moving, a stick counts until it is back under this, so a stick held at the edge does not flicker on and off. */
export const STICK_RELEASE = 0.2;
/** A trigger counts as pressed past half way. */
const TRIGGER_THRESHOLD = 0.5;
/** A held button that repeats (next photo, zoom, undo) waits this long, then repeats at the interval below, like a held key. */
export const BUTTON_REPEAT_DELAY_MS = 400;
export const BUTTON_REPEAT_MS = 120;
/** A stick repeats faster the further it is pushed: slowest just past the deadzone, fastest at the edge. */
export const STICK_SLOWEST_MS = 300;
export const STICK_FASTEST_MS = 50;

/** How strongly each slot is pressed now, 0 to 1, with the release threshold applied to slots that were already on. */
export function slotStrengths(snapshot: GamepadSnapshot, wasOn: ReadonlySet<GamepadSlot> = new Set()): Map<GamepadSlot, number> {
  const out = new Map<GamepadSlot, number>();
  for (const slot of GAMEPAD_BUTTON_SLOTS) {
    const button = snapshot.buttons[BUTTON_INDEX[slot]];
    if (!button) continue;
    const isTrigger = slot === 'LT' || slot === 'RT';
    const on = isTrigger ? Number(button.value) >= TRIGGER_THRESHOLD : Boolean(button.pressed);
    if (on) out.set(slot, 1);
  }
  for (const slot of GAMEPAD_AXIS_SLOTS) {
    const { axis, sign } = AXIS_INDEX[slot];
    const raw = Number(snapshot.axes[axis]);
    if (!Number.isFinite(raw)) continue;
    const along = raw * sign;
    const threshold = wasOn.has(slot) ? STICK_RELEASE : STICK_DEADZONE;
    if (along > threshold) out.set(slot, Math.min(1, along));
  }
  return out;
}

/** Time between repeats for a stick pushed this far (0 to 1). */
export function stickRepeatMs(strength: number): number {
  const span = 1 - STICK_DEADZONE;
  const t = Math.min(1, Math.max(0, (strength - STICK_DEADZONE) / span));
  return Math.round(STICK_SLOWEST_MS - (STICK_SLOWEST_MS - STICK_FASTEST_MS) * t);
}

export interface GamepadState {
  /** Slots held at the last poll: when they went down and when their command last ran. */
  held: ReadonlyMap<GamepadSlot, { since: number; lastFired: number }>;
}
export const EMPTY_GAMEPAD_STATE: GamepadState = { held: new Map() };

export interface GamepadFire {
  slot: GamepadSlot;
  command: CommandId | null;
  /** True for the first press, false for a repeat while held. */
  first: boolean;
}

const isAxis = (slot: GamepadSlot): slot is GamepadAxisSlot => (GAMEPAD_AXIS_SLOTS as readonly string[]).includes(slot);
const repeats = (id: CommandId | null) => Boolean(id && COMMANDS.find((c) => c.id === id)?.allowRepeat);

/**
 * One poll. Returns the new state and what to run. A slot runs its command once when pressed; a held slot repeats
 * only when its command allows repeats (decisions and ratings never repeat). A slot with no command still reports
 * its first press, so Settings can show which button arrived.
 */
export function stepGamepad(prev: GamepadState, snapshot: GamepadSnapshot | null, now: number, profile: GamepadProfile): { state: GamepadState; fired: GamepadFire[] } {
  if (!snapshot) return { state: EMPTY_GAMEPAD_STATE, fired: [] };
  const strengths = slotStrengths(snapshot, new Set(prev.held.keys()));
  const held = new Map<GamepadSlot, { since: number; lastFired: number }>();
  const fired: GamepadFire[] = [];
  for (const slot of GAMEPAD_SLOTS) {
    const strength = strengths.get(slot);
    if (strength === undefined) continue;
    const command = profile[slot] ?? null;
    const before = prev.held.get(slot);
    if (!before) {
      held.set(slot, { since: now, lastFired: now });
      fired.push({ slot, command, first: true });
      continue;
    }
    let { lastFired } = before;
    if (repeats(command)) {
      const interval = isAxis(slot) ? stickRepeatMs(strength) : BUTTON_REPEAT_MS;
      const ready = isAxis(slot) ? now - lastFired >= interval : now - before.since >= BUTTON_REPEAT_DELAY_MS && now - lastFired >= interval;
      if (ready) {
        lastFired = now;
        fired.push({ slot, command, first: false });
      }
    }
    held.set(slot, { since: before.since, lastFired });
  }
  return { state: { held }, fired };
}

/** The first controller the browser lists, or null. Controllers only appear after a button is pressed on them. */
export function firstGamepad(list: ArrayLike<Gamepad | null> | null | undefined): Gamepad | null {
  if (!list) return null;
  for (let i = 0; i < list.length; i += 1) {
    const pad = list[i];
    if (pad && pad.connected !== false) return pad;
  }
  return null;
}

const STORAGE_KEY = 'inflight-v2-gamepad';

export function parseGamepadProfile(raw: string | null): GamepadProfile {
  if (!raw) return DEFAULT_GAMEPAD;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_GAMEPAD;
    const known = new Set<string>(COMMANDS.map((c) => c.id));
    const out: GamepadProfile = { ...DEFAULT_GAMEPAD };
    for (const slot of GAMEPAD_SLOTS) {
      if (!(slot in parsed)) continue;
      const value = parsed[slot];
      if (value === null) out[slot] = null;
      else if (typeof value === 'string' && known.has(value)) out[slot] = value as CommandId;
    }
    return out;
  } catch {
    return DEFAULT_GAMEPAD;
  }
}

export function loadGamepadProfile(): GamepadProfile {
  try {
    return parseGamepadProfile(typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_GAMEPAD;
  }
}

export function saveGamepadProfile(profile: GamepadProfile): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch { /* Not remembered on this device. */ }
}
