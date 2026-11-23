import { COMMANDS, type CommandDefinition, type CommandId, type KeyEventLike } from './registry';
import { eventChord, resolveCommand, type Keymap } from './keymap';

/**
 * Macro pad and dial support. A pad (SinLoon K1 to K6 plus a knob) is a keyboard to the computer: each slot sends a key
 * that the pad's own software was set to send. Here each slot is given the key it sends (its "chord") and the command it runs.
 * TourBox and other devices that send keys work the same way; TourBox itself is NOT VERIFIED on a real device.
 */
export const PAD_SLOTS = ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'KNOB_CCW', 'KNOB_CW'] as const;
export type PadSlot = (typeof PAD_SLOTS)[number];

export const PAD_SLOT_LABELS: Record<PadSlot, string> = {
  K1: 'Key 1', K2: 'Key 2', K3: 'Key 3', K4: 'Key 4', K5: 'Key 5', K6: 'Key 6',
  KNOB_CCW: 'Dial turned left', KNOB_CW: 'Dial turned right',
};

export interface PadAssignment {
  /** The key the pad sends for this slot, in registry spelling. Empty means "not learnt yet". */
  chord: string;
  command: CommandId | null;
}
export type PadProfile = Record<PadSlot, PadAssignment>;

/** The keys V1 pads were already set to send (K, X, C, Z, Shift+Z, Space, arrows), so an existing pad works unchanged. */
export const DEFAULT_PAD: PadProfile = {
  K1: { chord: 'KeyK', command: 'photo.flag' },
  K2: { chord: 'KeyX', command: 'photo.rate0' },
  K3: { chord: 'KeyC', command: 'view.compare' },
  K4: { chord: 'KeyZ', command: 'edit.undo' },
  K5: { chord: 'Shift+KeyZ', command: 'edit.redo' },
  K6: { chord: 'Space', command: 'view.grid' },
  KNOB_CCW: { chord: 'ArrowLeft', command: 'photo.prev' },
  KNOB_CW: { chord: 'ArrowRight', command: 'photo.next' },
};

export function withPadCommand(pad: PadProfile, slot: PadSlot, command: CommandId | null): PadProfile {
  return { ...pad, [slot]: { ...pad[slot], command } };
}

export function withPadChord(pad: PadProfile, slot: PadSlot, chord: string): PadProfile {
  return { ...pad, [slot]: { ...pad[slot], chord } };
}

/** Slots whose pad key is also a keyboard shortcut for a different command. */
export function padClashes(pad: PadProfile, keymap: Keymap): Array<{ slot: PadSlot; chord: string; other: CommandId[] }> {
  const clashes: Array<{ slot: PadSlot; chord: string; other: CommandId[] }> = [];
  for (const slot of PAD_SLOTS) {
    const { chord, command } = pad[slot];
    if (!chord) continue;
    const other = COMMANDS.filter((c) => keymap[c.id] === chord && c.id !== command).map((c) => c.id);
    if (other.length > 0) clashes.push({ slot, chord, other });
  }
  // Two slots that send the same key are also a clash.
  for (const slot of PAD_SLOTS) {
    const { chord, command } = pad[slot];
    if (chord && PAD_SLOTS.some((s) => s !== slot && pad[s].chord === chord && pad[s].command !== command) && !clashes.some((c) => c.slot === slot)) {
      clashes.push({ slot, chord, other: [] });
    }
  }
  return clashes;
}

function padCommands(event: KeyEventLike, pad: PadProfile, isMac: boolean): CommandId[] {
  const chord = eventChord(event, isMac);
  if (!chord) return [];
  return PAD_SLOTS.filter((slot) => pad[slot].chord === chord && pad[slot].command).map((slot) => pad[slot].command as CommandId);
}

/** The slot a key press came from, for the "last key received" check. */
export function padSlotFor(event: KeyEventLike, pad: PadProfile, isMac: boolean): PadSlot | null {
  const chord = eventChord(event, isMac);
  return chord ? PAD_SLOTS.find((slot) => pad[slot].chord === chord) ?? null : null;
}

/**
 * The one command a key press means, from the keyboard keymap and the pad together. If the keyboard and the pad
 * (or two pad slots) would run different commands for the same key, nothing runs: the clash is shown, never guessed.
 */
export function resolveWithPad(input: { event: KeyEventLike; keymap: Keymap; pad: PadProfile; isMac: boolean; inField: boolean }): CommandDefinition | null {
  const { event, keymap, pad, isMac, inField } = input;
  if (event.isComposing || event.key === 'Process' || event.key === 'Dead' || event.keyCode === 229) return null;
  const fromKeys = resolveCommand({ event, keymap, isMac, inField });
  const keyMatches = COMMANDS.filter((c) => keymap[c.id] === eventChord(event, isMac)).length;
  const fromPad = padCommands(event, pad, isMac);
  const ids = new Set<CommandId>(fromPad);
  if (keyMatches > 0) {
    if (!fromKeys) return null; // the keyboard side was itself ambiguous, or blocked while typing
    ids.add(fromKeys.id);
  }
  if (ids.size !== 1) return null;
  const [id] = [...ids];
  const command = COMMANDS.find((c) => c.id === id);
  if (!command) return null;
  if (inField && !command.worksInFields) return null;
  if (event.repeat && !command.allowRepeat) return null;
  return command;
}

const STORAGE_KEY = 'inflight-v2-pad';

export function loadPad(): PadProfile {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PAD;
    const parsed = JSON.parse(raw) as Record<string, { chord?: unknown; command?: unknown }>;
    const known = new Set<string>(COMMANDS.map((c) => c.id));
    const out = { ...DEFAULT_PAD };
    for (const slot of PAD_SLOTS) {
      const item = parsed?.[slot];
      if (!item || typeof item.chord !== 'string' || item.chord.length > 40) continue;
      const command = typeof item.command === 'string' && known.has(item.command) ? (item.command as CommandId) : null;
      out[slot] = { chord: item.chord, command };
    }
    return out;
  } catch {
    return DEFAULT_PAD;
  }
}

export function savePad(pad: PadProfile): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pad)); } catch { /* Not remembered on this device. */ }
}
