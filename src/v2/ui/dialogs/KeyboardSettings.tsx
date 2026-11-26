import React, { useEffect, useState } from 'react';
import { STRINGS } from '../strings';
import { COMMANDS, COMMAND_GROUP_LABELS, availableCommands, type CommandGroup, type CommandId } from '../commands/registry';
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
  /** Preview features that are on: their commands are listed only then. */
  previews?: Partial<Record<'nextToReview', boolean>>;
}

const GROUPS: CommandGroup[] = ['photos', 'view', 'adjust', 'edit', 'app'];
const buttonClass = 'min-h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 text-xs text-[var(--text-primary)] disabled:opacity-40';

/** Settings > Keyboard: pick a keymap, change or clear any command's key, reset. A clash is shown in words and never resolved by guessing. */
export default function KeyboardSettings({ saved, isMac, onChange, pad, onPadChange, previews = {} }: KeyboardSettingsProps) {
  const commands = availableCommands(previews);
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
        ? STRINGS.keyboardKeys.imported(PRESETS[result.keymap.preset].label)
        : STRINGS.keyboardKeys.importedSkipped(PRESETS[result.keymap.preset].label, result.dropped.join(', '))
    );
  };
  const keymap = effectiveKeymap(saved.preset, saved.overrides, previews);
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
        <label htmlFor="v2-keymap-preset" className="text-xs font-medium text-[var(--text-secondary)]">{STRINGS.keyboardKeys.keySet}</label>
        <select
          id="v2-keymap-preset"
          value={saved.preset}
          onChange={(e) => isPresetId(e.target.value) && onChange({ ...saved, preset: e.target.value as PresetId })}
          className="h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-xs text-[var(--text-primary)]"
        >
          {(Object.keys(PRESETS) as PresetId[]).map((id) => <option key={id} value={id}>{PRESETS[id].label}</option>)}
        </select>
        <button type="button" className={buttonClass} disabled={Object.keys(saved.overrides).length === 0} onClick={() => onChange({ ...saved, overrides: {} })}>
          {STRINGS.keyboardKeys.resetAll}
        </button>
        <button type="button" className={buttonClass} onClick={handleExport}>{STRINGS.keyboardKeys.exportKeymap}</button>
        <button type="button" className={buttonClass} onClick={() => { setImportMessage(null); importInputRef.current?.click(); }}>{STRINGS.keyboardKeys.importKeymap}</button>
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
        {STRINGS.keyboardKeys.help}
      </p>
      {GROUPS.map((group) => (
        <section key={group} aria-labelledby={`v2-keys-${group}`} className="space-y-1">
          <h3 id={`v2-keys-${group}`} className="text-xs font-semibold text-[var(--text-primary)]">{COMMAND_GROUP_LABELS[group]}</h3>
          <div className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)]">
            {commands.filter((command) => command.group === group).map((command) => {
              const chord = keymap[command.id];
              const clash = chord ? commandsUsing(keymap, chord, command.id) : [];
              const changed = command.id in saved.overrides;
              return (
                <div key={command.id} className="space-y-1 px-3.5 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-[var(--text-primary)]">{command.label}{changed ? STRINGS.keyboardKeys.changedSuffix : ''}</span>
                    <span className="flex items-center gap-1.5">
                      <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[0.6875rem] text-[var(--text-secondary)]">
                        {capturing === command.id ? STRINGS.keyboardKeys.pressAKey : chordLabel(chord, isMac)}
                      </kbd>
                      <button type="button" className={buttonClass} aria-label={STRINGS.keyboardKeys.changeLabel(command.label)} onClick={() => setCapturing(capturing === command.id ? null : command.id)}>
                        {capturing === command.id ? STRINGS.keyboardKeys.cancel : STRINGS.keyboardKeys.change}
                      </button>
                      <button type="button" className={buttonClass} aria-label={STRINGS.keyboardKeys.clearLabel(command.label)} disabled={!chord} onClick={() => onChange(withChord(saved, command.id, ''))}>{STRINGS.keyboardKeys.clear}</button>
                      {changed && <button type="button" className={buttonClass} aria-label={STRINGS.keyboardKeys.resetLabel(command.label)} onClick={() => onChange(withoutOverride(saved, command.id))}>{STRINGS.keyboardKeys.reset}</button>}
                    </span>
                  </div>
                  {clash.length > 0 && (
                    <p role="alert" className="text-xs text-[var(--status-danger,#e5484d)]">
                      {STRINGS.keyboardKeys.clash(clash.map(labelOf).join(', '))}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {Object.keys(conflicts).length === 0 && <p className="text-xs text-[var(--text-secondary)]">{STRINGS.keyboardKeys.noClashes}</p>}
      <section aria-labelledby="v2-pad-title" className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
        <h3 id="v2-pad-title" className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.keyboardKeys.padHeading}</h3>
        <p className="text-xs text-[var(--text-secondary)]">
          {STRINGS.keyboardKeys.padHelp}
        </p>
        <p aria-live="polite" data-testid="pad-last-key" className="text-xs text-[var(--text-secondary)]">
          {lastKey
            ? (lastKey.slot ? STRINGS.keyboardKeys.lastKey(chordLabel(lastKey.chord, isMac), PAD_SLOT_LABELS[lastKey.slot]) : STRINGS.keyboardKeys.lastKeyNoSlot(chordLabel(lastKey.chord, isMac)))
            : STRINGS.keyboardKeys.pressPadKey}
        </p>
        {padProblems.map((problem) => (
          <p key={problem.slot} role="alert" className="text-xs text-[var(--status-danger,#e5484d)]">
            {problem.other.length
              ? STRINGS.keyboardKeys.padClashKeyboard(PAD_SLOT_LABELS[problem.slot], chordLabel(problem.chord, isMac), problem.other.map(labelOf).join(', '))
              : STRINGS.keyboardKeys.padClashSlot(PAD_SLOT_LABELS[problem.slot], chordLabel(problem.chord, isMac))}
          </p>
        ))}
        <div className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)]">
          {PAD_SLOTS.map((slot) => (
            <div key={slot} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 text-xs">
              <span className="text-[var(--text-primary)]">{PAD_SLOT_LABELS[slot]}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                <select
                  aria-label={STRINGS.keyboardKeys.actionLabel(PAD_SLOT_LABELS[slot])}
                  value={pad[slot].command ?? ''}
                  onChange={(e) => onPadChange(withPadCommand(pad, slot, (e.target.value || null) as CommandId | null))}
                  className="h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)]"
                >
                  <option value="">{STRINGS.keyboardKeys.nothing}</option>
                  {commands.map((command) => <option key={command.id} value={command.id}>{command.label}</option>)}
                </select>
                <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[0.6875rem] text-[var(--text-secondary)]">
                  {learning === slot ? STRINGS.keyboardKeys.pressAKey : chordLabel(pad[slot].chord, isMac)}
                </kbd>
                <button type="button" className={buttonClass} aria-label={STRINGS.keyboardKeys.learnLabel(PAD_SLOT_LABELS[slot])} onClick={() => setLearning(learning === slot ? null : slot)}>
                  {learning === slot ? STRINGS.keyboardKeys.cancel : STRINGS.keyboardKeys.learn}
                </button>
              </span>
            </div>
          ))}
        </div>
        <button type="button" className={buttonClass} onClick={() => onPadChange(DEFAULT_PAD)}>{STRINGS.keyboardKeys.resetPad}</button>
      </section>
    </div>
  );
}
