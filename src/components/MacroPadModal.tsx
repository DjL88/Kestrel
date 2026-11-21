import React, { useEffect, useState } from 'react';
import { focusBeforeOpening, returnFocus } from './focusReturn';
import { AlertTriangle, RotateCcw, X } from './icons/KestrelUIIcons';
import {
  CULL_COMMANDS,
  DEFAULT_KEY_BINDINGS,
  EDIT_COMMANDS,
  detectKeymapConflicts,
  formatChordLabel,
  normalizeKeyChord,
  type CommandDefinition,
  type CommandId,
  type KeyBindingsMap,
  type KnobFunction,
  type PadMode,
} from '../core/keyboardCommands';
import { projectsText as t } from '../i18n/areas/projects';

interface MacroPadModalProps {
  open: boolean;
  onClose: () => void;
  bindings: KeyBindingsMap;
  onUpdateBinding: (commandId: CommandId, chord: string) => void;
  onResetBindings: () => void;
  knobMode: KnobFunction;
  onKnobModeChange: (mode: KnobFunction) => void;
  /** Which tab to show when it opens, for example Edit mode when opened from the editor. */
  openTo?: PadMode;
}

export const MacroPadModal: React.FC<MacroPadModalProps> = ({
  open,
  onClose,
  bindings,
  onUpdateBinding,
  onResetBindings,
  knobMode,
  onKnobModeChange,
  openTo,
}) => {
  const [padTab, setPadTab] = useState<PadMode>('cull');
  const [capturingId, setCapturingId] = useState<CommandId | null>(null);
  // The last key Kestrel received while the dialog was open, so a pad's real behaviour can be checked.
  const [received, setReceived] = useState<{ chord: string; label: string } | null>(null);

  useEffect(() => {
    if (open) {
      setPadTab(openTo ?? 'cull');
      setReceived(null);
    }
  }, [open, openTo]);

  // Focus goes back where it came from, or to the menu button when it came from a menu item.
  useEffect(() => {
    if (!open) return;
    const previous = focusBeforeOpening();
    return () => returnFocus(previous);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setCapturingId(null);
      return;
    }

    const handleKey = (e: KeyboardEvent) => {
      if (capturingId) {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === 'Escape') {
          setCapturingId(null);
          return;
        }
        const chord = normalizeKeyChord(e);
        if (chord) {
          onUpdateBinding(capturingId, chord);
          setCapturingId(null);
        }
        return;
      }

      if (e.code === 'Escape') {
        // Closing the dialog must not also close the editor behind it.
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      const chord = normalizeKeyChord(e);
      if (chord) {
        const list = padTab === 'cull' ? CULL_COMMANDS : EDIT_COMMANDS;
        const match = list.find((command) => (bindings[command.id] ?? DEFAULT_KEY_BINDINGS[command.id]) === chord);
        setReceived({ chord, label: match ? t.macroPad.commandInMode(match.label, padTab !== 'cull') : t.macroPad.notAssigned(padTab !== 'cull') });
      }
      // Testing the pad must not also move sliders or photos behind the dialog. Its own fields keep their keys.
      if (!(e.target as Element | null)?.closest?.('select, input, textarea, [contenteditable]')) e.stopPropagation();
    };

    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [open, capturingId, onUpdateBinding, onClose, padTab, bindings]);

  if (!open) return null;

  const commands = padTab === 'cull' ? CULL_COMMANDS : EDIT_COMMANDS;
  const conflicts = detectKeymapConflicts(bindings, padTab);
  const conflictCommandIds = new Set(Object.values(conflicts).flat());
  const conflictEntries = Object.entries(conflicts);

  const sixPadKeys = (['K1', 'K2', 'K3', 'K4', 'K5', 'K6'] as const).map((slot) =>
    commands.find((c) => c.padSlot === slot)
  );
  const knobCcwCmd = commands.find((c) => c.padSlot === 'KNOB_CCW');
  const knobCwCmd = commands.find((c) => c.padSlot === 'KNOB_CW');
  const secondaryCommands = commands.filter((c) => !c.padSlot);

  const renderCommandChip = (cmd: CommandDefinition | undefined) => {
    if (!cmd) return null;
    const isCapturing = capturingId === cmd.id;
    const hasConflict = conflictCommandIds.has(cmd.id);
    const chord = bindings[cmd.id] ?? DEFAULT_KEY_BINDINGS[cmd.id];

    return (
      <button
        key={cmd.id}
        type="button"
        onClick={() => setCapturingId(isCapturing ? null : cmd.id)}
        aria-label={t.macroPad.remap(cmd.label, formatChordLabel(chord))} title={t.macroPad.remap(cmd.label, formatChordLabel(chord))}
        className={`flex flex-col justify-between p-3 rounded-lg border text-left transition-colors min-h-[76px] focus-visible:outline-2 focus-visible:outline-sky-400 ${
          isCapturing
            ? 'bg-sky-500/20 border-sky-400 text-sky-100'
            : hasConflict
            ? 'bg-orange-500/15 border-orange-400 text-orange-100'
            : 'bg-[#1D2026] border-white/12 hover:border-white/30 text-zinc-100'
        }`}
      >
        <div className="flex items-center justify-between gap-2 w-full">
          <span className="text-[10px] font-mono text-zinc-400">{cmd.padSlot}</span>
          <kbd className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded bg-kestrel-stage border border-white/15 text-zinc-100">
            {isCapturing ? t.macroPad.pressKey : formatChordLabel(chord)}
          </kbd>
        </div>
        <span className="text-xs font-medium mt-2 truncate">{cmd.label}</span>
      </button>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="macropad-modal-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-2xl bg-kestrel-panel border border-white/12 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-4">
          <div>
            <h2 id="macropad-modal-title" className="text-base font-semibold text-zinc-100">
              {t.macroPad.title}
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              {t.macroPad.intro}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.macroPad.close} title={t.macroPad.close}
            className="grid min-h-11 min-w-11 place-items-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/8"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5">
          {/* Mode Tabs & Knob Function */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="tablist"
              aria-label={t.macroPad.modeLabel}
              className="flex items-center bg-kestrel-stage p-0.5 rounded-lg border border-white/10"
            >
              <button
                type="button"
                role="tab"
                aria-selected={padTab === 'cull'}
                onClick={() => {
                  setPadTab('cull');
                  setCapturingId(null);
                }}
                className={`min-h-11 px-3 text-xs font-medium rounded-md transition-colors ${
                  padTab === 'cull'
                    ? 'bg-[#23272F] text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t.macroPad.cullMode}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={padTab === 'edit'}
                onClick={() => {
                  setPadTab('edit');
                  setCapturingId(null);
                }}
                className={`min-h-11 px-3 text-xs font-medium rounded-md transition-colors ${
                  padTab === 'edit'
                    ? 'bg-[#23272F] text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t.macroPad.editMode}
              </button>
            </div>

            {padTab === 'cull' && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-zinc-400">{t.macroPad.knobAction}</span>
                <select
                  aria-label={t.macroPad.knobLabel}
                  value={knobMode}
                  onChange={(e) => onKnobModeChange(e.target.value as KnobFunction)}
                  className="bg-kestrel-stage border border-white/12 rounded-md min-h-11 px-2.5 text-xs text-zinc-200 focus:border-sky-400 focus:outline-none"
                >
                  <option value="navigate">{t.macroPad.knobNavigate}</option>
                  <option value="zoom">{t.macroPad.knobZoom}</option>
                </select>
              </div>
            )}
          </div>

          {padTab === 'edit' && (
            <div className="px-3 py-2 rounded-lg bg-[#1A1D24] border border-white/10 text-xs text-zinc-300">
              {t.macroPad.editNote}
            </div>
          )}

          {/* Conflict Warning */}
          {conflictEntries.length > 0 && (
            <div
              role="alert"
              data-testid="keymap-conflict-warning"
              className="px-3 py-2.5 rounded-lg bg-orange-500/15 border border-orange-400/50 text-xs text-orange-100 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-orange-300 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <span className="font-semibold">{t.macroPad.conflict}</span>{' '}
                {conflictEntries
                  .map(([chord, ids]) => {
                    const names = ids
                      .map((id) => commands.find((c) => c.id === id)?.label ?? id)
                      .join(' & ');
                    return `${formatChordLabel(chord)} (${names})`;
                  })
                  .join('; ')}
              </div>
            </div>
          )}

          <details className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-300">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-zinc-100">{t.macroPad.howTo}</summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              <li>{t.macroPad.step1}</li>
              <li>{t.macroPad.step2}</li>
              <li><strong>{t.macroPad.step3Lead}</strong> {t.macroPad.step3}</li>
              <li>{t.macroPad.step4Start} <kbd className="rounded bg-white/10 px-1">Alt</kbd> {t.macroPad.step4End}</li>
            </ol>
            <div role="status" aria-live="polite" className="mt-3 rounded-md border border-white/10 p-2">
              <div className="text-xs font-semibold text-zinc-100">{t.macroPad.testTitle}</div>
              <p className="text-xs">{received
                ? <>{t.macroPad.received} <kbd className="rounded bg-white/10 px-1">{formatChordLabel(received.chord)}</kbd>{t.macroPad.receivedCommand(received.label)}</>
                : t.macroPad.testHint}</p>
            </div>
          </details>

          {/* Hardware Layout: 2x3 Keys + 1 Rotary Knob */}
          <div className="p-4 rounded-xl bg-kestrel-stage border border-white/10 grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-4 items-center">
            <div className="grid grid-cols-3 gap-2.5">
              {sixPadKeys.map((cmd) => renderCommandChip(cmd))}
            </div>

            {/* Rotary Knob */}
            <div className="flex flex-col items-center justify-center p-3 rounded-lg bg-[#15181E] border border-white/10 space-y-2.5">
              <div className="w-16 h-16 rounded-full bg-gradient-to-b from-[#2A2E37] to-[#17191E] border-2 border-white/15 flex items-center justify-center shadow-inner">
                <div className="w-2 h-2 rounded-full bg-sky-400/80 -translate-y-4" />
              </div>
              <div className="text-[11px] font-medium text-zinc-300">{t.macroPad.rotaryKnob}</div>
              <div className="grid grid-cols-2 gap-1.5 w-full">
                {[knobCcwCmd, knobCwCmd].map((cmd) => {
                  if (!cmd) return null;
                  const isCapturing = capturingId === cmd.id;
                  const hasConflict = conflictCommandIds.has(cmd.id);
                  const chord = bindings[cmd.id] ?? DEFAULT_KEY_BINDINGS[cmd.id];
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      onClick={() => setCapturingId(isCapturing ? null : cmd.id)}
                      aria-label={t.macroPad.remapKnob(cmd.label, cmd.padSlot === 'KNOB_CCW', formatChordLabel(chord))}
                      aria-pressed={isCapturing}
                      className={`min-h-11 px-2 py-1.5 rounded border text-center transition-colors ${
                        isCapturing
                          ? 'bg-sky-500/20 border-sky-400 text-sky-100'
                          : hasConflict
                          ? 'bg-orange-500/15 border-orange-400 text-orange-100'
                          : 'bg-[#1D2026] border-white/10 text-zinc-200 hover:border-white/30'
                      }`}
                    >
                      <div className="text-[9px] text-zinc-400">
                        {cmd.padSlot === 'KNOB_CCW' ? t.macroPad.anticlockwiseShort : t.macroPad.clockwiseShort}
                      </div>
                      <div className="font-mono text-[11px] font-semibold">
                        {isCapturing ? '…' : formatChordLabel(chord)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Secondary Commands */}
          {secondaryCommands.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-zinc-300">{t.macroPad.additional}</h3>
              <div className="divide-y divide-white/8 border border-white/10 rounded-lg bg-kestrel-stage">
                {secondaryCommands.map((cmd) => {
                  const isCapturing = capturingId === cmd.id;
                  const hasConflict = conflictCommandIds.has(cmd.id);
                  const chord = bindings[cmd.id] ?? DEFAULT_KEY_BINDINGS[cmd.id];
                  return (
                    <div
                      key={cmd.id}
                      className="px-3 py-2 flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <span className="font-medium text-zinc-200">{cmd.label}</span>
                        <span className="text-zinc-500 ml-2">{cmd.description}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCapturingId(isCapturing ? null : cmd.id)}
                        aria-label={t.macroPad.remap(cmd.label, formatChordLabel(chord))}
                        aria-pressed={isCapturing}
                        className={`min-h-11 min-w-11 px-2.5 py-1 rounded border font-mono text-xs shrink-0 ${
                          isCapturing
                            ? 'bg-sky-500/20 border-sky-400 text-sky-100'
                            : hasConflict
                            ? 'bg-orange-500/15 border-orange-400 text-orange-100'
                            : 'bg-[#1D2026] border-white/10 text-zinc-200 hover:border-white/30'
                        }`}
                      >
                        {isCapturing ? t.macroPad.pressKey : formatChordLabel(chord)}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/10 bg-[#14161b] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onResetBindings}
            className="min-h-11 px-3 text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-[#1D2026] hover:bg-[#262A32] border border-white/10 rounded-lg flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t.macroPad.reset}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 px-4 text-xs font-semibold text-zinc-950 bg-zinc-100 hover:bg-white rounded-lg"
          >
            {t.common.done}
          </button>
        </div>
      </div>
    </div>
  );
};
