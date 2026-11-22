import React, { useEffect, useRef } from 'react';
import { COMMANDS, COMMAND_GROUP_LABELS, type CommandGroup } from '../commands/registry';
import { chordLabel, type Keymap } from '../commands/keymap';

interface ShortcutGuideProps {
  keymap: Keymap;
  isMac: boolean;
  onClose: () => void;
}

/** V2 keyboard guide; mounted only when requested and never intercepts typing in a field. */
export default function ShortcutGuide({ keymap, isMac, onClose }: ShortcutGuideProps) {
  const closeButton = useRef<HTMLButtonElement>(null);

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
          <h2 id="v2-shortcut-title" className="text-base font-semibold">Keyboard shortcuts</h2>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Close keyboard shortcuts"
            className="min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm">Close</button>
        </div>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto text-sm">
          {(['photos', 'view', 'edit', 'app'] as CommandGroup[]).map((group) => (
            <section key={group} aria-labelledby={`v2-shortcut-${group}`}>
              <h3 id={`v2-shortcut-${group}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{COMMAND_GROUP_LABELS[group]}</h3>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
                {COMMANDS.filter((command) => command.group === group).map((command) => (
                  <React.Fragment key={command.id}>
                    <dt className="text-[var(--text-secondary)]">{command.label}</dt>
                    <dd className="text-right font-medium">{chordLabel(keymap[command.id], isMac)}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </section>
          ))}
          <p className="text-[var(--text-secondary)]">Close this guide: Esc</p>
        </div>
      </section>
    </div>
  );
}
