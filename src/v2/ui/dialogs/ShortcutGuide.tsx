import { STRINGS } from '../strings';
import React, { useEffect, useRef } from 'react';
import { COMMAND_GROUP_LABELS, availableCommands, commandById, type CommandGroup } from '../commands/registry';
import { chordLabel, type Keymap } from '../commands/keymap';
import { PAD_SLOT_LABELS, padGuideRows, type PadProfile } from '../commands/pad';

interface ShortcutGuideProps {
  keymap: Keymap;
  /** The macro pad's keys. They are real keys, so they are listed too: no key acts without being shown here. */
  pad?: PadProfile;
  isMac: boolean;
  onClose: () => void;
  /** Preview features that are on: their commands are listed only then. */
  previews?: Partial<Record<'nextToReview', boolean>>;
}

/** V2 keyboard guide; mounted only when requested and never intercepts typing in a field. */
export default function ShortcutGuide({ keymap, pad, isMac, onClose, previews = {} }: ShortcutGuideProps) {
  const commands = availableCommands(previews);
  const closeButton = useRef<HTMLButtonElement>(null);
  const padRows = pad ? padGuideRows(pad, keymap) : [];

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="v2-shortcut-title"
        className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 text-[var(--text-primary)] shadow-[var(--shadow-panel)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="v2-shortcut-title" className="text-base font-semibold">{STRINGS.shortcutHelp.keyboardShortcuts}</h2>
          <button ref={closeButton} type="button" onClick={onClose} aria-label={STRINGS.shortcutHelp.closeKeyboardShortcuts}
            className="min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm">{STRINGS.shortcutHelp.close}</button>
        </div>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto text-sm">
          {(['photos', 'view', 'adjust', 'edit', 'app'] as CommandGroup[]).map((group) => (
            <section key={group} aria-labelledby={`v2-shortcut-${group}`}>
              <h3 id={`v2-shortcut-${group}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{COMMAND_GROUP_LABELS[group]}</h3>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
                {commands.filter((command) => command.group === group).map((command) => (
                  <React.Fragment key={command.id}>
                    <dt className="text-[var(--text-secondary)]">{command.label}</dt>
                    <dd className="text-right font-medium">{chordLabel(keymap[command.id], isMac)}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </section>
          ))}
          {padRows.length > 0 && (
            <section aria-labelledby="v2-shortcut-pad" data-testid="shortcut-guide-pad">
              <h3 id="v2-shortcut-pad" className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{STRINGS.keyboardKeys.padHeading}</h3>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
                {padRows.map((row) => (
                  <React.Fragment key={row.slot}>
                    <dt className="text-[var(--text-secondary)]">{commandById(row.command).label} ({PAD_SLOT_LABELS[row.slot]})</dt>
                    <dd className="text-right font-medium">{chordLabel(row.chord, isMac)}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </section>
          )}
          <p className="text-[var(--text-secondary)]">{STRINGS.shortcutHelp.closeThisGuideEsc}</p>
        </div>
      </section>
    </div>
  );
}
