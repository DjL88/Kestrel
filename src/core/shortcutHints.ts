import { formatChordLabel, type KeyBindingsMap } from './keyboardCommands';
import type { PhotoAction } from './photoMenu';

const isMac = () => typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '');

/** Shortcuts shown in the photo menu. Bound actions follow the person's own keys; the familiar aliases are fixed. */
export function photoMenuHints(bindings: KeyBindingsMap, mac = isMac()): Partial<Record<PhotoAction, string>> {
  const mod = mac ? '⌘' : 'Ctrl+';
  const hints: Partial<Record<PhotoAction, string>> = {
    edit: 'D',
    keep: formatChordLabel(bindings['cull.keep']),
    trash: formatChordLabel(bindings['cull.reject']),
    unreview: formatChordLabel(bindings['cull.unreviewed']),
    rate0: '0',
    copy: formatChordLabel(bindings['edit.copy']).replace('Shift+', '⇧'),
    paste: formatChordLabel(bindings['edit.paste']).replace('Shift+', '⇧'),
    reset: formatChordLabel(bindings['edit.reset']),
    export: `${mod}E`,
  };
  // An action the person has unbound shows no hint rather than the word "Unbound".
  for (const key of Object.keys(hints) as PhotoAction[]) if (hints[key] === 'Unbound') delete hints[key];
  return hints;
}
