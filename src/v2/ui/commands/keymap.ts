import { COMMANDS, formatChordLabel, type CommandDefinition, type CommandId, type KeyEventLike } from './registry';

export type PresetId = 'inflight' | 'lightroom';

export type Keymap = Partial<Record<CommandId, string>>;

// Culling keys every preset shares: arrows move between photos, numbers rate, X sets aside and U clears the decision.
// Zoom: plain + and - (either key of the pair, and the number pad), as in Capture One's loupe and Photo Mechanic.
// Cmd/Ctrl with + and - is deliberately left to the browser and system zoom (owner decision 24 Nov: page zoom stays
// available for reading). Fit and 100% have no default key yet: Lightroom's Z waits on the macro pad decision, because
// the default pad sends Z for Undo. They can be set in Settings > Keyboard, on a pad slot, or run from command search.
const RATINGS: Keymap = {
  'view.zoomIn': 'Equal', 'view.zoomOut': 'Minus',
  'photo.next': 'ArrowRight', 'photo.prev': 'ArrowLeft', 'photo.reject': 'KeyX', 'photo.unflag': 'KeyU',
  // Preview (off by default): N jumps to the next photo with no decision yet, Shift+N back. They only act while it is on.
  'photo.nextToReview': 'KeyN', 'photo.prevToReview': 'Shift+KeyN',
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
      'view.loupe': 'KeyE',
      'view.filmstrip': 'F6',
      'view.compare': 'Backslash',
      'view.maskOverlay': 'KeyO',
      // Canvas only, like Lightroom's Lights out (L). Tab and Shift+Tab stay for moving between controls.
      'view.canvasOnly': 'KeyL',
      'view.fullscreen': 'Mod+Shift+KeyF',
      'edit.undo': 'Mod+KeyZ',
      'edit.redo': 'Mod+Shift+KeyZ',
      'edit.copy': 'Mod+Shift+KeyC',
      'edit.paste': 'Mod+Shift+KeyV',
      'edit.selectAll': 'Mod+KeyA',
      'edit.selectNone': 'Mod+Shift+KeyA',
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
      'view.loupe': 'KeyE',
      'view.filmstrip': 'F6',
      'view.compare': 'Backslash',
      'view.maskOverlay': 'KeyO',
      // Canvas only, like Lightroom's Lights out (L). Tab and Shift+Tab stay for moving between controls.
      'view.canvasOnly': 'KeyL',
      'view.fullscreen': 'KeyF',
      'edit.undo': 'Mod+KeyZ',
      'edit.redo': 'Mod+Shift+KeyZ',
      'edit.copy': 'Mod+Shift+KeyC',
      'edit.paste': 'Mod+Shift+KeyV',
      'edit.selectAll': 'Mod+KeyA',
      'edit.selectNone': 'Mod+KeyD',
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

/**
 * The chords in force: the preset, then the person's overrides. A preview feature's commands keep their chords only
 * while that preview is on, so a preview that is off never takes a key or makes another command's key ambiguous.
 */
export function effectiveKeymap(preset: PresetId, overrides: Overrides = {}, previews: Partial<Record<NonNullable<CommandDefinition['preview']>, boolean>> = {}): Keymap {
  const merged: Keymap = { ...PRESETS[preset].keymap };
  for (const [id, chord] of Object.entries(overrides) as [CommandId, string][]) {
    if (chord === '') delete merged[id];
    else merged[id] = chord;
  }
  for (const command of COMMANDS) if (command.preview && previews[command.preview] !== true) delete merged[command.id];
  return merged;
}

/**
 * The chord for a keyboard event, in registry spelling. "Mod" is Cmd on a Mac and Ctrl elsewhere
 * (on a Mac Ctrl alone also counts as Mod). "?" is matched by the character so it works on any keyboard layout.
 */
export function eventChord(event: KeyEventLike, isMac: boolean): string | null {
  if (event.key === '?' && !event.ctrlKey && !event.altKey && !event.metaKey) return '?';
  // + and - by the character too, so Shift+= (the + key), the number pad and other layouts all zoom.
  if (!event.ctrlKey && !event.altKey && !event.metaKey && (event.key === '+' || event.key === '-')) return event.key === '+' ? 'Equal' : 'Minus';
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
  const matches = keyboardMatches(chord, keymap, isMac);
  if (matches.length !== 1) return null;
  const [command] = matches;
  if (inField && !command.worksInFields) return null;
  if (event.repeat && !command.allowRepeat) return null;
  return command;
}

/** Sets one command's chord. A chord equal to the preset's own is stored as no override, so switching presets stays clean. */
export function withChord(saved: SavedKeymap, id: CommandId, chord: string): SavedKeymap {
  const overrides: Overrides = { ...saved.overrides };
  if (chord !== '' && PRESETS[saved.preset].keymap[id] === chord) delete overrides[id];
  else overrides[id] = chord;
  return { ...saved, overrides };
}

/** Puts one command back to its preset chord. */
export function withoutOverride(saved: SavedKeymap, id: CommandId): SavedKeymap {
  const overrides: Overrides = { ...saved.overrides };
  delete overrides[id];
  return { ...saved, overrides };
}

/** Other commands that already use this chord in the keymap in force. */
export function commandsUsing(keymap: Keymap, chord: string, except: CommandId): CommandId[] {
  return COMMANDS.filter((command) => command.id !== except && keymap[command.id] === chord).map((command) => command.id);
}

const STORAGE_KEY = 'inflight-v2-keymap';

export interface SavedKeymap { preset: PresetId; overrides: Overrides }

/**
 * Keeps only overrides that are safe to apply: a known command id, with either the empty string
 * (deliberately unbound) or a chord string short enough to be real. Anything else is dropped and
 * named, rather than failing the whole keymap over one stale or corrupted entry.
 */
function sanitizeOverrides(raw: unknown): { overrides: Overrides; dropped: string[] } {
  const known = new Set<string>(COMMANDS.map((command) => command.id));
  const overrides: Overrides = {};
  const dropped: string[] = [];
  if (raw && typeof raw === 'object') {
    for (const [id, chord] of Object.entries(raw as Record<string, unknown>)) {
      if (known.has(id) && typeof chord === 'string' && chord.length < 40) overrides[id as CommandId] = chord;
      else dropped.push(id);
    }
  }
  return { overrides, dropped };
}

export function loadKeymap(): SavedKeymap {
  const fallback: SavedKeymap = { preset: DEFAULT_PRESET, overrides: {} };
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { preset?: unknown; overrides?: unknown };
    return { preset: isPresetId(parsed.preset) ? parsed.preset : DEFAULT_PRESET, overrides: sanitizeOverrides(parsed.overrides).overrides };
  } catch {
    return fallback;
  }
}

export function saveKeymap(saved: SavedKeymap): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* Not remembered on this device. */ }
}

const KEYMAP_EXPORT_KIND = 'kestrel-keymap';
const KEYMAP_EXPORT_VERSION = 1;

interface KeymapExportFile { kind: typeof KEYMAP_EXPORT_KIND; version: typeof KEYMAP_EXPORT_VERSION; preset: PresetId; overrides: Overrides }

/** A shareable, human-readable keymap file: the saved keymap wrapped with a kind and version, so a file from
 * somewhere else, or a future format, is caught explicitly on import instead of silently read as empty. */
export function exportKeymap(saved: SavedKeymap): string {
  const file: KeymapExportFile = { kind: KEYMAP_EXPORT_KIND, version: KEYMAP_EXPORT_VERSION, preset: saved.preset, overrides: saved.overrides };
  return JSON.stringify(file, null, 2);
}

export type ImportKeymapResult =
  | { ok: true; keymap: SavedKeymap; dropped: string[] }
  | { ok: false; error: string };

/**
 * Reads a keymap file written by exportKeymap. Unlike loadKeymap's own on-device cache, an import is a decision
 * the person just made by choosing a file, so a wrong-kind, wrong-version or malformed file is refused with a
 * plain reason - never silently treated as "no changes" (CLAUDE.md: never silently discard a decision). An
 * individual unknown command id or corrupted chord is dropped and named in `dropped` rather than failing the
 * whole import.
 */
export function importKeymap(raw: string): ImportKeymapResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, error: 'That file is not a keymap export.' };
  const candidate = parsed as Partial<KeymapExportFile>;
  if (candidate.kind !== KEYMAP_EXPORT_KIND) return { ok: false, error: 'That file is not an InFlight keymap export.' };
  if (candidate.version !== KEYMAP_EXPORT_VERSION) {
    return { ok: false, error: `This keymap was saved in a format (${JSON.stringify(candidate.version)}) this version of InFlight does not read.` };
  }
  if (!isPresetId(candidate.preset)) return { ok: false, error: 'That file does not name a key set InFlight knows.' };
  const { overrides, dropped } = sanitizeOverrides(candidate.overrides);
  return { ok: true, keymap: { preset: candidate.preset, overrides }, dropped };
}

/** The parts of a focused element the shortcut handler reads. Kept DOM-free so it can be unit tested. */
export interface FocusTargetLike {
  tagName?: string;
  type?: string;
  getAttribute?: (name: string) => string | null;
}

// Controls that a person presses with Space or Enter (WAI-ARIA: button, link, tab, menu item, option, checkbox, radio, switch).
const PRESS_TAGS = new Set(['BUTTON', 'A', 'SUMMARY']);
const PRESS_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'color', 'image']);
const PRESS_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'checkbox', 'radio', 'switch', 'treeitem']);

/**
 * True when the key press is already spoken for, so a shortcut must not run as well:
 * - a control's own key handler handled it (it called preventDefault), as the Adjust tabs, panel menus and compare
 *   handle the arrow keys; before this, an arrow on the Adjust tabs switched the tab and also moved to another photo;
 * - Space or Enter on a focused button, link, tab, menu item or option, which presses that control; before this,
 *   Space on a focused button toggled the grid (the default pad sends Space) instead of pressing the button.
 * Arrow keys on a filmstrip thumbnail or a plain button still step through photos, as before.
 * Modified keys (Cmd/Ctrl/Alt) are never claimed by focus: the field rules in `resolveCommand` decide those.
 */
export function keyAlreadyHandled(
  target: FocusTargetLike | null | undefined,
  event: Pick<KeyEventLike, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'> & { defaultPrevented?: boolean },
): boolean {
  if (event.defaultPrevented) return true;
  if (!target || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key !== ' ' && event.key !== 'Spacebar' && event.key !== 'Enter') return false;
  const tag = (target.tagName || '').toUpperCase();
  const role = (target.getAttribute?.('role') || '').toLowerCase();
  const inputType = tag === 'INPUT' ? (target.type || target.getAttribute?.('type') || 'text').toLowerCase() : '';
  return PRESS_TAGS.has(tag) || PRESS_INPUT_TYPES.has(inputType) || PRESS_ROLES.has(role);
}

/**
 * Each platform's own second key for a few commands, so habits from other apps work without any set-up:
 * Ctrl+Y redoes and F11 is full screen on Windows and Linux. A second key acts only while its command still has a key
 * (clearing the command clears both) and only while no command uses that key itself (a person's own choice always wins).
 */
const PLATFORM_ALTERNATES: ReadonlyArray<{ id: CommandId; chord: string; mac: boolean }> = [
  { id: 'edit.redo', chord: 'Mod+KeyY', mac: false },
  { id: 'view.fullscreen', chord: 'F11', mac: false },
];

/** The second keys in force for one command on this platform. */
export function alternateChords(id: CommandId, keymap: Keymap, isMac: boolean): string[] {
  if (!keymap[id]) return [];
  const used = new Set(Object.values(keymap));
  return PLATFORM_ALTERNATES.filter((alt) => alt.id === id && alt.mac === isMac && !used.has(alt.chord)).map((alt) => alt.chord);
}

/** The commands a key press means from the keyboard: the keymap's own keys first, then each platform's second keys. */
export function keyboardMatches(chord: string, keymap: Keymap, isMac: boolean): CommandDefinition[] {
  const direct = COMMANDS.filter((command) => keymap[command.id] === chord);
  if (direct.length > 0) return direct;
  return COMMANDS.filter((command) => alternateChords(command.id, keymap, isMac).includes(chord));
}

/** A command's keys as the person reads them, the second key after a slash: "Ctrl+Shift+Z / Ctrl+Y". */
export function chordsLabel(id: CommandId, keymap: Keymap, isMac: boolean): string {
  return [chordLabel(keymap[id], isMac), ...alternateChords(id, keymap, isMac).map((chord) => chordLabel(chord, isMac))].join(' / ');
}
