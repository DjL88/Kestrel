import { formatChordLabel, type KeyBindingsMap } from './keyboardCommands';
import type { PhotoAction } from './photoMenu';

const isMac = () => typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '');

/** Shortcuts shown in the photo menu. Bound actions follow the person's own keys; the familiar aliases are fixed. */
export function photoMenuHints(bindings: KeyBindingsMap, mac = isMac()): Partial<Record<PhotoAction, string>> {
  const mod = mac ? '⌘' : 'Ctrl+';
  const inUse = new Set(Object.values(bindings));
  // A person's custom binding always wins, even if it uses an alias key.
  // Never display a hint for an alias that will not actually fire.
  const aliasFree = (chord: string) => !inUse.has(chord);
  const hints: Partial<Record<PhotoAction, string>> = {
    edit: aliasFree('KeyD') ? 'D' : undefined,
    keep: formatChordLabel(bindings['cull.keep']),
    trash: formatChordLabel(bindings['cull.reject']),
    unreview: formatChordLabel(bindings['cull.unreviewed']),
    rate0: aliasFree('Digit0') ? '0' : undefined,
    rate1: aliasFree('Digit1') ? '1' : undefined,
    rate2: aliasFree('Digit2') ? '2' : undefined,
    rate3: aliasFree('Digit3') ? '3' : undefined,
    rate4: aliasFree('Digit4') ? '4' : undefined,
    rate5: aliasFree('Digit5') ? '5' : undefined,
    copy: formatChordLabel(bindings['edit.copy']).replace('Shift+', '⇧'),
    paste: formatChordLabel(bindings['edit.paste']).replace('Shift+', '⇧'),
    reset: formatChordLabel(bindings['edit.reset']),
    export: aliasFree(mac ? 'Meta+KeyE' : 'Ctrl+KeyE') ? `${mod}E` : undefined,
  };
  // An action the person has unbound shows no hint rather than the word "Unbound".
  for (const key of Object.keys(hints) as PhotoAction[]) if (hints[key] === 'Unbound') delete hints[key];
  return hints;
}

/** Convert a visible kbd hint to the WAI-ARIA key name, not Unicode glyphs. */
export function ariaShortcutFromHint(hint: string | undefined): string | undefined {
  if (!hint) return undefined;
  const normalized = hint
    .replaceAll('⌘', 'Meta+').replaceAll('⇧', 'Shift+')
    .replaceAll('Ctrl+', 'Control+').replaceAll('⌫', 'Backspace')
    .replaceAll('←', 'ArrowLeft').replaceAll('→', 'ArrowRight')
    .replaceAll('↑', 'ArrowUp').replaceAll('↓', 'ArrowDown');
  // A valid key combination only; skip fancy labels that aren't legal aria-keyshortcuts.
  return /^(?:(?:Control|Meta|Shift|Alt)\+)*(?:[A-Za-z0-9]|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Backspace|Enter|Space|Tab)$/.test(normalized)
    ? normalized : undefined;
}
