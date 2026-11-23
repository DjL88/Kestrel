import React, { useEffect, useMemo, useRef, useState } from 'react';
import { COMMANDS, type CommandDefinition } from '../commands/registry';
import { chordLabel, type Keymap } from '../commands/keymap';

interface CommandPaletteProps {
  keymap: Keymap;
  isMac: boolean;
  /** Runs the same dispatch the keyboard handler uses; this dialog never duplicates that switch. */
  onRunCommand: (command: CommandDefinition) => void;
  onClose: () => void;
}

/**
 * Cmd/Ctrl+K: find any command by name and run it, from the one list the keyboard guide also reads
 * (`COMMANDS`). Narrows as you type; Up/Down to move, Enter to run, Escape or an outside click to close.
 */
export default function CommandPalette({ keymap, isMac, onRunCommand, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const matches = useMemo(() => {
    const runnable = COMMANDS.filter((command) => command.id !== 'app.commandSearch');
    const needle = query.trim().toLowerCase();
    if (!needle) return runnable;
    return runnable.filter((command) => command.label.toLowerCase().includes(needle));
  }, [query]);

  useEffect(() => {
    setHighlighted((index) => (matches.length === 0 ? 0 : Math.min(index, matches.length - 1)));
  }, [matches]);

  const runAt = (index: number) => {
    const command = matches[index];
    if (!command) return;
    onClose();
    onRunCommand(command);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((index) => Math.min(index + 1, Math.max(matches.length - 1, 0)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      runAt(highlighted);
    }
  };

  const activeId = matches[highlighted] ? `v2-command-option-${matches[highlighted].id}` : undefined;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-[var(--bg-scrim)] p-4 pt-[14vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Command search"
        className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 text-[var(--text-primary)] shadow-[var(--shadow-popover)]"
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Find a command or shortcut"
          aria-label="Find a command or shortcut"
          role="combobox"
          aria-expanded="true"
          aria-controls="v2-command-palette-list"
          aria-activedescendant={activeId}
          autoComplete="off"
          className="mb-2 min-h-10 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] outline-none"
        />
        <ul
          id="v2-command-palette-list"
          role="listbox"
          aria-label="Matching commands"
          className="max-h-[50vh] space-y-0.5 overflow-y-auto text-sm"
        >
          {matches.length === 0 && (
            <li className="px-2 py-3 text-[var(--text-secondary)]">No matching command.</li>
          )}
          {matches.map((command, index) => (
            <li key={command.id} id={`v2-command-option-${command.id}`} role="option" aria-selected={index === highlighted}>
              <button
                type="button"
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => runAt(index)}
                className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] px-2 text-left ${
                  index === highlighted ? 'bg-[var(--bg-surface-hover)]' : ''
                }`}
              >
                <span>{command.label}</span>
                <span className="text-[var(--text-secondary)]">{chordLabel(keymap[command.id], isMac)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
