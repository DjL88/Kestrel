import React from 'react';
import {
  CULL_COMMANDS,
  formatChordLabel,
  type KeyBindingsMap,
  type KnobFunction,
} from '../core/keyboardCommands';
import { libraryText as t } from '../i18n/areas/library';

interface ShortcutOverlayProps {
  bindings: KeyBindingsMap;
  knobMode: KnobFunction;
  visible: boolean;
}

export const ShortcutOverlay: React.FC<ShortcutOverlayProps> = ({
  bindings,
  knobMode,
  visible,
}) => {
  if (!visible) return null;

  const sixKeys = CULL_COMMANDS.filter((c) => c.padSlot?.startsWith('K') && c.padSlot.length === 2);
  const knobCcw = formatChordLabel(bindings['cull.knobCcw']);
  const knobCw = formatChordLabel(bindings['cull.knobCw']);
  const knobLabel = knobMode === 'navigate' ? t.shortcuts.prevNext : t.shortcuts.zoomOutIn;

  return (
    <div
      aria-label={t.shortcuts.label}
      className="pointer-events-none select-none bg-kestrel-canvas/85 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-2 text-[11px] text-zinc-300 shadow-lg max-w-xs"
    >
      <div className="flex items-center justify-between gap-4 text-zinc-400 mb-1.5">
        <span className="font-medium text-zinc-200">{t.shortcuts.cullModeKeys}</span>
        <span className="font-mono text-[10px]">SinLoon 6+1</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {sixKeys.map((cmd) => (
          <div key={cmd.id} className="flex items-center justify-between gap-2">
            <span className="text-zinc-400 truncate">{cmd.shortLabel}</span>
            <kbd className="font-mono text-[10px] text-zinc-100 bg-white/8 px-1.5 py-0.5 rounded border border-white/10">
              {formatChordLabel(bindings[cmd.id])}
            </kbd>
          </div>
        ))}
      </div>
      <div className="mt-1.5 pt-1.5 border-t border-white/10 flex items-center justify-between gap-2">
        <span className="text-zinc-400">{t.shortcuts.knob(knobLabel)}</span>
        <span className="font-mono text-[10px] text-zinc-200">
          {knobCcw} / {knobCw}
        </span>
      </div>
    </div>
  );
};
