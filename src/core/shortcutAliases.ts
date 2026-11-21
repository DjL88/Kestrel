import { normalizeKeyChord, type CommandId, type KeyBindingsMap, type KeyEventLike } from './keyboardCommands';

/**
 * Familiar Lightroom / DxO keys that work in addition to Kestrel's own bindings.
 * Nothing here replaces a binding: a chord the person has bound to a command always wins, and an alias is never
 * offered when it would shadow one. "Mod" is Command on a Mac and Control elsewhere (either is accepted).
 */
export type AliasAction =
  | { kind: 'command'; id: CommandId }
  | { kind: 'rate'; rating: 0 | 1 | 2 | 3 | 4 | 5 }
  | { kind: 'edit' }
  | { kind: 'export' };

const ALIASES: Record<string, AliasAction> = {
  KeyP: { kind: 'command', id: 'cull.keep' },
  'Mod+KeyZ': { kind: 'command', id: 'cull.undo' },
  'Mod+Shift+KeyZ': { kind: 'command', id: 'cull.redo' },
  'Mod+KeyY': { kind: 'command', id: 'cull.redo' },
  'Mod+Slash': { kind: 'command', id: 'cull.toggleShortcuts' },
  KeyD: { kind: 'edit' },
  'Mod+KeyE': { kind: 'export' },
  Digit0: { kind: 'rate', rating: 0 },
  Digit1: { kind: 'rate', rating: 1 },
  Digit2: { kind: 'rate', rating: 2 },
  Digit3: { kind: 'rate', rating: 3 },
  Digit4: { kind: 'rate', rating: 4 },
  Digit5: { kind: 'rate', rating: 5 },
};

/** The chord with Command or Control folded into "Mod" (Mod, then Shift, then the key), or null when Alt is involved. */
export function modChord(event: KeyEventLike): string | null {
  const raw = normalizeKeyChord(event);
  if (!raw || event.altKey) return null;
  const key = raw.split('+').pop() as string;
  return [event.ctrlKey || event.metaKey ? 'Mod' : '', event.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+');
}

export function resolveShortcutAlias({ event, bindings, isSuppressed }: {
  event: KeyEventLike; bindings: KeyBindingsMap; isSuppressed: boolean;
}): AliasAction | null {
  if (isSuppressed || event.isComposing || event.key === 'Process' || event.key === 'Dead' || event.keyCode === 229) return null;
  // Held keys must not repeat a decision, a rating or an export.
  if (event.repeat) return null;
  const raw = normalizeKeyChord(event);
  const chord = modChord(event);
  if (!raw || !chord) return null;
  // Both Command+Control at once is not a familiar chord.
  if (event.ctrlKey && event.metaKey) return null;
  if (Object.values(bindings).includes(raw)) return null;
  return ALIASES[chord] ?? null;
}
