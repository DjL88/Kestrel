export type PadMode = 'cull' | 'edit';

export type KnobFunction = 'navigate' | 'zoom';

export type CullCommandId =
  | 'cull.keep'
  | 'cull.reject'
  | 'cull.compare'
  | 'cull.undo'
  | 'cull.redo'
  | 'cull.toggleZoom'
  | 'cull.knobCcw'
  | 'cull.knobCw'
  | 'cull.unreviewed'
  | 'cull.toggleGrid'
  | 'cull.toggleShortcuts';

export type EditCommandId =
  | 'edit.copy'
  | 'edit.paste'
  | 'edit.reset'
  | 'edit.beforeAfter'
  | 'edit.wbNeutral'
  | 'edit.prevControl'
  | 'edit.knobCcw'
  | 'edit.knobCw';

export type CommandId = CullCommandId | EditCommandId;

export interface CommandDefinition {
  id: CommandId;
  mode: PadMode;
  label: string;
  shortLabel: string;
  description: string;
  /** Physical SinLoon hardware slot if applicable */
  padSlot?: 'K1' | 'K2' | 'K3' | 'K4' | 'K5' | 'K6' | 'KNOB_CCW' | 'KNOB_CW';
  allowRepeat: boolean;
}

export type KeyBindingsMap = Record<CommandId, string>;

export const CULL_COMMANDS: CommandDefinition[] = [
  {
    id: 'cull.keep',
    mode: 'cull',
    label: 'Keep',
    shortLabel: 'Keep',
    description: 'Mark active frame as Keep',
    padSlot: 'K1',
    allowRepeat: false,
  },
  {
    id: 'cull.reject',
    mode: 'cull',
    label: 'Reject',
    shortLabel: 'Reject',
    description: 'Mark active frame as Reject (reversible)',
    padSlot: 'K2',
    allowRepeat: false,
  },
  {
    id: 'cull.compare',
    mode: 'cull',
    label: 'Compare',
    shortLabel: 'Compare',
    description: 'Toggle photo comparison wipe',
    padSlot: 'K3',
    allowRepeat: false,
  },
  {
    id: 'cull.undo',
    mode: 'cull',
    label: 'Undo',
    shortLabel: 'Undo',
    description: 'Undo last culling decision',
    padSlot: 'K4',
    allowRepeat: false,
  },
  {
    id: 'cull.redo',
    mode: 'cull',
    label: 'Redo',
    shortLabel: 'Redo',
    description: 'Redo previously undone decision',
    padSlot: 'K5',
    allowRepeat: false,
  },
  {
    id: 'cull.toggleZoom',
    mode: 'cull',
    label: 'Toggle Zoom',
    shortLabel: 'Zoom',
    description: 'Toggle between Fit and 2× zoom',
    padSlot: 'K6',
    allowRepeat: false,
  },
  {
    id: 'cull.knobCcw',
    mode: 'cull',
    label: 'Knob Counter-Clockwise',
    shortLabel: 'Prev / Out',
    description: 'Previous frame or Zoom out depending on knob mode',
    padSlot: 'KNOB_CCW',
    allowRepeat: true,
  },
  {
    id: 'cull.knobCw',
    mode: 'cull',
    label: 'Knob Clockwise',
    shortLabel: 'Next / In',
    description: 'Next frame or Zoom in depending on knob mode',
    padSlot: 'KNOB_CW',
    allowRepeat: true,
  },
  {
    id: 'cull.unreviewed',
    mode: 'cull',
    label: 'Clear Decision',
    shortLabel: 'Clear',
    description: 'Reset active frame to Unreviewed',
    allowRepeat: false,
  },
  {
    id: 'cull.toggleGrid',
    mode: 'cull',
    label: 'Contact Sheet',
    shortLabel: 'Grid',
    description: 'Switch between Contact Sheet Grid and Loupe Preview',
    allowRepeat: false,
  },
  {
    id: 'cull.toggleShortcuts',
    mode: 'cull',
    label: 'Shortcut Overlay',
    shortLabel: 'Keys',
    description: 'Show or hide quiet shortcut overlay',
    allowRepeat: false,
  },
];

/**
 * Edit mode bindings shared by the keyboard and the SinLoon profile.
 */
export const EDIT_COMMANDS: CommandDefinition[] = [
  {
    id: 'edit.copy',
    mode: 'edit',
    label: 'Copy Edit',
    shortLabel: 'Copy',
    description: 'Copy reversible edit recipe from active frame',
    padSlot: 'K1',
    allowRepeat: false,
  },
  {
    id: 'edit.paste',
    mode: 'edit',
    label: 'Paste Edit',
    shortLabel: 'Paste',
    description: 'Paste copied adjustments onto the active photo',
    padSlot: 'K2',
    allowRepeat: false,
  },
  {
    id: 'edit.beforeAfter',
    mode: 'edit',
    label: 'Before / After',
    shortLabel: 'Compare',
    description: 'Toggle the original and edited wipe',
    padSlot: 'K3',
    allowRepeat: false,
  },
  {
    id: 'edit.wbNeutral',
    mode: 'edit',
    label: 'Reset Warmth',
    shortLabel: 'Warmth 0',
    description: 'Reset the Warmth adjustment to neutral',
    padSlot: 'K4',
    allowRepeat: false,
  },
  {
    id: 'edit.reset',
    mode: 'edit',
    label: 'Reset Recipe',
    shortLabel: 'Reset',
    description: 'Clear non-destructive adjustments on active frame',
    padSlot: 'K5',
    allowRepeat: false,
  },
  {
    id: 'edit.prevControl',
    mode: 'edit',
    label: 'Cycle Adjustment',
    shortLabel: 'Cycle',
    description: 'Cycle the dial between Light, Warmth and Colour',
    padSlot: 'K6',
    allowRepeat: false,
  },
  {
    id: 'edit.knobCcw',
    mode: 'edit',
    label: 'Decrease Value',
    shortLabel: 'Dial -',
    description: 'Step selected adjustment down',
    padSlot: 'KNOB_CCW',
    allowRepeat: true,
  },
  {
    id: 'edit.knobCw',
    mode: 'edit',
    label: 'Increase Value',
    shortLabel: 'Dial +',
    description: 'Step selected adjustment up',
    padSlot: 'KNOB_CW',
    allowRepeat: true,
  },
];

export const ALL_COMMANDS: CommandDefinition[] = [...CULL_COMMANDS, ...EDIT_COMMANDS];

export const DEFAULT_KEY_BINDINGS: KeyBindingsMap = {
  'cull.keep': 'KeyK',
  'cull.reject': 'KeyX',
  'cull.compare': 'KeyC',
  'cull.undo': 'KeyZ',
  'cull.redo': 'Shift+KeyZ',
  'cull.toggleZoom': 'Space',
  'cull.knobCcw': 'ArrowLeft',
  'cull.knobCw': 'ArrowRight',
  'cull.unreviewed': 'KeyU',
  'cull.toggleGrid': 'KeyG',
  'cull.toggleShortcuts': 'Slash',
  'edit.copy': 'Shift+KeyC',
  'edit.paste': 'Shift+KeyV',
  'edit.beforeAfter': 'Backslash',
  'edit.wbNeutral': 'KeyW',
  'edit.reset': 'KeyR',
  'edit.prevControl': 'KeyQ',
  'edit.knobCcw': 'Minus',
  'edit.knobCw': 'Equal',
};

export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
}

const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

/**
 * Normalizes a DOM KeyboardEvent (or test stub) into a canonical chord string like "Shift+KeyZ" or "ArrowRight".
 * Returns null for standalone modifier key presses.
 */
export function normalizeKeyChord(event: KeyEventLike): string | null {
  const code = event.code || '';
  if (MODIFIER_CODES.has(code)) return null;

  const base = code || normalizeKeyFallback(event.key);
  if (!base) return null;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(base);

  return parts.join('+');
}

function normalizeKeyFallback(key: string): string {
  if (!key) return '';
  if (key === ' ') return 'Space';
  if (key.length === 1 && /[a-z]/i.test(key)) {
    return `Key${key.toUpperCase()}`;
  }
  if (key.length === 1 && /[0-9]/.test(key)) {
    return `Digit${key}`;
  }
  return key;
}

export function formatChordLabel(chord: string): string {
  if (!chord) return 'Unbound';
  const parts = chord.split('+');
  const keyPart = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  const keyLabelMap: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Space: 'Space',
    Slash: '/',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Comma: ',',
    Period: '.',
    Backspace: '⌫',
    Enter: 'Enter',
    Tab: 'Tab',
  };

  let readableKey = keyLabelMap[keyPart] ?? keyPart;
  if (readableKey.startsWith('Key') && readableKey.length === 4) {
    readableKey = readableKey.slice(3);
  } else if (readableKey.startsWith('Digit') && readableKey.length === 6) {
    readableKey = readableKey.slice(5);
  }

  if (modifiers.length === 0) return readableKey;
  return `${modifiers.join('+')}+${readableKey}`;
}

/**
 * Detects duplicate shortcut chords within the same mode so the remapper warns immediately.
 */
export function detectKeymapConflicts(
  bindings: KeyBindingsMap,
  mode: PadMode
): Record<string, CommandId[]> {
  const byChord: Record<string, CommandId[]> = {};
  const commands = mode === 'cull' ? CULL_COMMANDS : EDIT_COMMANDS;

  for (const cmd of commands) {
    const chord = bindings[cmd.id];
    if (!chord) continue;
    if (!byChord[chord]) byChord[chord] = [];
    byChord[chord].push(cmd.id);
  }

  const conflicts: Record<string, CommandId[]> = {};
  for (const [chord, ids] of Object.entries(byChord)) {
    if (ids.length > 1) {
      conflicts[chord] = ids;
    }
  }
  return conflicts;
}

export interface ResolveCommandInput {
  event: KeyEventLike;
  bindings: KeyBindingsMap;
  activeMode: PadMode;
  isSuppressed: boolean;
}

/**
 * Resolves a single keyboard event into at most one CommandDefinition.
 * - Suppresses all shortcuts while typing, remapping, or inside modals.
 * - Prevents held keys (repeat: true) from committing decisions like Keep/Reject/Undo/Redo.
 * - Allows held keys for navigation and zoom knob commands.
 */
export function resolveKeyboardCommand({
  event,
  bindings,
  activeMode,
  isSuppressed,
}: ResolveCommandInput): CommandDefinition | null {
  if (isSuppressed) return null;

  const chord = normalizeKeyChord(event);
  if (!chord) return null;

  const commands = activeMode === 'cull' ? CULL_COMMANDS : EDIT_COMMANDS;
  // A remapped chord shared by two commands is ambiguous: do not silently
  // execute whichever command happens to appear first in the list.
  const matches = commands.filter((cmd) => bindings[cmd.id] === chord);
  if (matches.length !== 1) return null;
  const matched = matches[0];

  if (event.repeat && !matched.allowRepeat) {
    return null;
  }

  return matched;
}
