import React, { useEffect, useState } from 'react';
import { COMMANDS, COMMAND_GROUP_LABELS, type CommandGroup, type CommandId } from '../commands/registry';
import {
  PRESETS, chordLabel, commandsUsing, effectiveKeymap, eventChord, exportKeymap, findConflicts, importKeymap, isPresetId, withChord, withoutOverride,
  type PresetId, type SavedKeymap,
} from '../commands/keymap';
import { DEFAULT_PAD, PAD_SLOTS, PAD_SLOT_LABELS, padClashes, padSlotFor, withPadChord, withPadCommand, type PadProfile, type PadSlot } from '../commands/pad';

interface KeyboardSettingsProps {
  saved: SavedKeymap;
  isMac: boolean;
  onChange: (next: SavedKeymap) => void;
  pad: PadProfile;
  onPadChange: (next: PadProfile) => void;
}

const GROUPS: CommandGroup[] = ['photos', 'view', 'edit', 'app'];
const buttonClass = 'min-h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 text-xs text-[var(--text-primary)] disabled:opacity-40';

/** Settings > Keyboard: pick a keymap, change or clear any command's key, reset. A clash is shown in words and never resolved by guessing. */
export default function KeyboardSettings({ saved, isMac, onChange, pad, onPadChange }: KeyboardSettingsProps) {
  const [capturing, setCapturing] = useState<CommandId | null>(null);
  const [learning, setLearning] = useState<PadSlot | null>(null);
  const [lastKey, setLastKey] = useState<{ chord: string; slot: PadSlot | null } | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const importInputRef = React.useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const blob = new Blob([exportKeymap(saved)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kestrel-keymap-${PRESETS[saved.preset].label.toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    const result = importKeymap(await file.text());
    if (!result.ok) {
      setImportMessage(result.error);
      return;
    }
    onChange(result.keymap);
    setImportMessage(
      result.dropped.length === 0
        ? `Imported. Key set: ${PRESETS[result.keymap.preset].label}.`
        : `Imported. Key set: ${PRESETS[result.keymap.preset].label}. Not recognised and skipped: ${result.dropped.join(', ')}.`
    );
  };
  const keymap = effectiveKeymap(saved.preset, saved.overrides);
  const conflicts = findConflicts(keymap);
  const labelOf = (id: CommandId) => COMMANDS.find((command) => command.id === id)?.label ?? id;

  useEffect(() => {
    if (!capturing) return;
    const onKey = (event: KeyboardEvent) => {
      // Everything typed now belongs to this capture, so no shortcut underneath fires.
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') { setCapturing(null); return; }
      const chord = eventChord(event, isMac);
      if (!chord) return; // a modifier on its own: keep waiting for the key
      onChange(withChord(saved, capturing, chord));
      setCapturing(null);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [capturing, isMac, onChange, saved]);

  // Learn the key a pad sends for one slot: the next key pressed is that slot's key. Esc cancels.
  useEffect(() => {
    if (!learning) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') { setLearning(null); return; }
      const chord = eventChord(event, isMac);
      if (!chord) return;
      onPadChange(withPadChord(pad, learning, chord));
      setLearning(null);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [learning, isMac, onPadChange, pad]);

  // Shows the last key InFlight received while this tab is open, so a pad's real behaviour can be checked.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const chord = eventChord(event, isMac);
      if (chord) setLastKey({ chord, slot: padSlotFor(event, pad, isMac) });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMac, pad]);

  const padProblems = padClashes(pad, keymap);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="v2-keymap-preset" className="text-xs font-medium text-[var(--text-secondary)]">Key set</label>
        <select
          id="v2-keymap-preset"
          value={saved.preset}
          onChange={(e) => isPresetId(e.target.value) && onChange({ ...saved, preset: e.target.value as PresetId })}
          className="h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-xs text-[var(--text-primary)]"
        >
          {(Object.keys(PRESETS) as PresetId[]).map((id) => <option key={id} value={id}>{PRESETS[id].label}</option>)}
        </select>
        <button type="button" className={buttonClass} disabled={Object.keys(saved.overrides).length === 0} onClick={() => onChange({ ...saved, overrides: {} })}>
          Reset all my changes
        </button>
        <button type="button" className={buttonClass} onClick={handleExport}>Export keymap</button>
        <button type="button" className={buttonClass} onClick={() => { setImportMessage(null); importInputRef.current?.click(); }}>Import keymap</button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          hidden
          data-testid="v2-keymap-import-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void handleImportFile(file);
          }}
        />
      </div>
      {importMessage && <p role="status" className="text-xs text-[var(--text-secondary)]">{importMessage}</p>}
      <p className="text-xs text-[var(--text-secondary)]">
        Change a key, then press the new one. Esc cancels. If two commands share a key, neither runs until you fix it.
        Capture One and Photo Mechanic key sets are not here yet: they must be checked against each vendor's own documentation first.
        Export keymap saves your key set and changes as a file you can keep or share; Import keymap reads one back.
      </p>
      {GROUPS.map((group) => (
        <section key={group} aria-labelledby={`v2-keys-${group}`} className="space-y-1">
          <h3 id={`v2-keys-${group}`} className="text-xs font-semibold text-[var(--text-primary)]">{COMMAND_GROUP_LABELS[group]}</h3>
          <div className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)]">
            {COMMANDS.filter((command) => command.group === group).map((command) => {
              const chord = keymap[command.id];
              const clash = chord ? commandsUsing(keymap, chord, command.id) : [];
              const changed = command.id in saved.overrides;
              return (
                <div key={command.id} className="space-y-1 px-3.5 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-[var(--text-primary)]">{command.label}{changed ? ' (changed)' : ''}</span>
                    <span className="flex items-center gap-1.5">
                      <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]">
                        {capturing === command.id ? 'Press a key…' : chordLabel(chord, isMac)}
                      </kbd>
                      <button type="button" className={buttonClass} aria-label={`Change key for ${command.label}`} onClick={() => setCapturing(capturing === command.id ? null : command.id)}>
                        {capturing === command.id ? 'Cancel' : 'Change'}
                      </button>
                      <button type="button" className={buttonClass} aria-label={`Clear key for ${command.label}`} disabled={!chord} onClick={() => onChange(withChord(saved, command.id, ''))}>Clear</button>
                      {changed && <button type="button" className={buttonClass} aria-label={`Reset key for ${command.label}`} onClick={() => onChange(withoutOverride(saved, command.id))}>Reset</button>}
                    </span>
                  </div>
                  {clash.length > 0 && (
                    <p role="alert" className="text-xs text-[var(--status-danger,#e5484d)]">
                      Clash: this key is also used for {clash.map(labelOf).join(', ')}. Neither runs until you change one.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {Object.keys(conflicts).length === 0 && <p className="text-xs text-[var(--text-secondary)]">No clashes.</p>}
      <section aria-labelledby="v2-pad-title" className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
        <h3 id="v2-pad-title" className="text-xs font-semibold text-[var(--text-primary)]">Macro pad and dials</h3>
        <p className="text-xs text-[var(--text-secondary)]">
          A pad or dial sends keys, like a keyboard. For each slot, say which key it sends (Learn, then press it on the pad) and what it should do.
          The starting keys match the SinLoon pad set-up from InFlight Version 1. TourBox and other pads that send keys work the same way; TourBox has not been tested on a real device.
        </p>
        <p aria-live="polite" data-testid="pad-last-key" className="text-xs text-[var(--text-secondary)]">
          {lastKey
            ? `Last key received: ${chordLabel(lastKey.chord, isMac)}${lastKey.slot ? ` (${PAD_SLOT_LABELS[lastKey.slot]})` : ' (not a pad slot)'}`
            : 'Press a key on your pad to check it arrives.'}
        </p>
        {padProblems.map((problem) => (
          <p key={problem.slot} role="alert" className="text-xs text-[var(--status-danger,#e5484d)]">
            Clash: {PAD_SLOT_LABELS[problem.slot]} sends {chordLabel(problem.chord, isMac)}, which is also {problem.other.length ? `the keyboard key for ${problem.other.map(labelOf).join(', ')}` : 'sent by another slot'}. Neither runs until you change one.
          </p>
        ))}
        <div className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)]">
          {PAD_SLOTS.map((slot) => (
            <div key={slot} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 text-xs">
              <span className="text-[var(--text-primary)]">{PAD_SLOT_LABELS[slot]}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                <select
                  aria-label={`Action for ${PAD_SLOT_LABELS[slot]}`}
                  value={pad[slot].command ?? ''}
                  onChange={(e) => onPadChange(withPadCommand(pad, slot, (e.target.value || null) as CommandId | null))}
                  className="h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)]"
                >
                  <option value="">Nothing</option>
                  {COMMANDS.map((command) => <option key={command.id} value={command.id}>{command.label}</option>)}
                </select>
                <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]">
                  {learning === slot ? 'Press a key…' : chordLabel(pad[slot].chord, isMac)}
                </kbd>
                <button type="button" className={buttonClass} aria-label={`Learn the key for ${PAD_SLOT_LABELS[slot]}`} onClick={() => setLearning(learning === slot ? null : slot)}>
                  {learning === slot ? 'Cancel' : 'Learn'}
                </button>
              </span>
            </div>
          ))}
        </div>
        <button type="button" className={buttonClass} onClick={() => onPadChange(DEFAULT_PAD)}>Reset pad to the starting set-up</button>
      </section>
    </div>
  );
}
