import { COMMANDS, formatChordLabel, type CommandDefinition, type CommandId, type KeyEventLike } from './registry';

export type PresetId = 'inflight' | 'lightroom';

export type Keymap = Partial<Record<CommandId, string>>;

const RATINGS: Keymap = {
  'photo.rate0': 'Digit0', 'photo.rate1': 'Digit1', 'photo.rate2': 'Digit2',
  'photo.rate3': 'Digit3', 'photo.rate4': 'Digit4', 'photo.rate5': 'Digit5',
};

/**
 * Built-in keymaps. "Mod" is Cmd on macOS and Ctrl elsewhere. A command with no chord is simply unbound.
 * "inflight" keeps the keys V2 has always had. "lightroom" follows the common Lightroom defaults (P flags, F is full screen).
 * Capture One and Photo Mechanic presets are not here: they must be checked against each vendor's current documentation first.
 */
export const PRESETS: Record<PresetId, { label: string; keymap: Keymap }> = {
  inflight: {
    label: 'InFlight',
    keymap: {
      ...RATINGS,
      'help.toggle': '?',
      'photo.flag': 'KeyF',
      'view.grid': 'KeyG',
      'view.compare': 'Backslash',
      'view.fullscreen': 'Mod+Shift+KeyF',
      'edit.undo': 'Mod+KeyZ',
      'edit.redo': 'Mod+Shift+KeyZ',
      'edit.copy': 'Mod+Shift+KeyC',
      'edit.paste': 'Mod+Shift+KeyV',
      'edit.selectAll': 'Mod+KeyA',
      'file.export': 'Mod+KeyE',
      'app.settings': 'Mod+Comma',
      'app.commandSearch': 'Mod+KeyK',
    },
  },
  lightroom: {
    label: 'Lightroom',
    keymap: {
      ...RATINGS,
      'help.toggle': '?',
      'photo.flag': 'KeyP',
      'view.grid': 'KeyG',
      'view.compare': 'Backslash',
      'view.fullscreen': 'KeyF',
      'edit.undo': 'Mod+KeyZ',
      'edit.redo': 'Mod+Shift+KeyZ',
      'edit.copy': 'Mod+Shift+KeyC',
      'edit.paste': 'Mod+Shift+KeyV',
      'edit.selectAll': 'Mod+KeyA',
      'file.export': 'Mod+Shift+KeyE',
      'app.settings': 'Mod+Comma',
      'app.commandSearch': 'Mod+KeyK',
    },
  },
};

export const DEFAULT_PRESET: PresetId = 'inflight';

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PRESETS, value);
}

/** A person's own changes on top of a preset. An empty string means "deliberately unbound". */
export type Overrides = Partial<Record<CommandId, string>>;

/** The chords in force: the preset, then the person's overrides. */
export function effectiveKeymap(preset: PresetId, overrides: Overrides = {}): Keymap {
  const merged: Keymap = { ...PRESETS[preset].keymap };
  for (const [id, chord] of Object.entries(overrides) as [CommandId, string][]) {
    if (chord === '') delete merged[id];
    else merged[id] = chord;
  }
  return merged;
}

/**
 * The chord for a keyboard event, in registry spelling. "Mod" is Cmd on a Mac and Ctrl elsewhere
 * (on a Mac Ctrl alone also counts as Mod). "?" is matched by the character so it works on any keyboard layout.
 */
export function eventChord(event: KeyEventLike, isMac: boolean): string | null {
  if (event.key === '?' && !event.ctrlKey && !event.altKey && !event.metaKey) return '?';
  const code = event.code || '';
  if (/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(code)) return null;
  const base = code || (event.key.length === 1 ? (/[a-z]/i.test(event.key) ? `Key${event.key.toUpperCase()}` : /[0-9]/.test(event.key) ? `Digit${event.key}` : event.key === ',' ? 'Comma' : event.key === '\\' ? 'Backslash' : event.key) : event.key);
  if (!base) return null;
  // On a Mac Ctrl also counts as the main modifier (it did in V2 before this registry), unless Cmd is held too.
  const mod = isMac ? Boolean(event.metaKey || event.ctrlKey) : event.ctrlKey;
  const ctrl = isMac ? Boolean(event.metaKey && event.ctrlKey) : false;
  const meta = isMac ? false : event.metaKey;
  const parts: string[] = [];
  if (mod) parts.push('Mod');
  if (ctrl) parts.push('Ctrl');
  if (meta) parts.push('Meta');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(base);
  return parts.join('+');
}

/** A chord as the person reads it: "Cmd+Shift+Z" on a Mac, "Ctrl+Shift+Z" elsewhere. */
export function chordLabel(chord: string | undefined, isMac: boolean): string {
  if (!chord) return 'Not set';
  if (chord === '?') return '?';
  return formatChordLabel(chord.replace(/^Mod\+/, isMac ? 'Cmd+' : 'Ctrl+').replace(/\+Mod\+/, isMac ? '+Cmd+' : '+Ctrl+'));
}

/** Commands that share a chord. Ambiguous chords run nothing, so the clash is shown, never resolved by guessing. */
export function findConflicts(keymap: Keymap): Record<string, CommandId[]> {
  const byChord: Record<string, CommandId[]> = {};
  for (const command of COMMANDS) {
    const chord = keymap[command.id];
    if (chord) (byChord[chord] ??= []).push(command.id);
  }
  return Object.fromEntries(Object.entries(byChord).filter(([, ids]) => ids.length > 1));
}

export interface ResolveInput {
  event: KeyEventLike;
  keymap: Keymap;
  isMac: boolean;
  /** Focus is in a text field, or a dialog is capturing keys. */
  inField: boolean;
}

/** The one command this key press means, or null. Held keys, IME composition and clashing chords never run a decision. */
export function resolveCommand({ event, keymap, isMac, inField }: ResolveInput): CommandDefinition | null {
  if (event.isComposing || event.key === 'Process' || event.key === 'Dead' || event.keyCode === 229) return null;
  const chord = eventChord(event, isMac);
  if (!chord) return null;
  const matches = COMMANDS.filter((command) => keymap[command.id] === chord);
  if (matches.length !== 1) return null;
  const [command] = matches;
  if (inField && !command.worksInFields) return null;
  if (event.repeat && !command.allowRepeat) return null;
  return command;
}

const STORAGE_KEY = 'inflight-v2-keymap';

export interface SavedKeymap { preset: PresetId; overrides: Overrides }

export function loadKeymap(): SavedKeymap {
  const fallback: SavedKeymap = { preset: DEFAULT_PRESET, overrides: {} };
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { preset?: unknown; overrides?: unknown };
    const known = new Set<string>(COMMANDS.map((command) => command.id));
    const overrides: Overrides = {};
    if (parsed.overrides && typeof parsed.overrides === 'object') {
      for (const [id, chord] of Object.entries(parsed.overrides as Record<string, unknown>)) {
        if (known.has(id) && typeof chord === 'string' && chord.length < 40) overrides[id as CommandId] = chord;
      }
    }
    return { preset: isPresetId(parsed.preset) ? parsed.preset : DEFAULT_PRESET, overrides };
  } catch {
    return fallback;
  }
}

export function saveKeymap(saved: SavedKeymap): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* Not remembered on this device. */ }
}
