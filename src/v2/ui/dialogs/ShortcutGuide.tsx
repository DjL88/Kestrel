import React, { useEffect, useRef } from 'react';

interface ShortcutGuideProps {
  onClose: () => void;
}

/** V2 keyboard guide; mounted only when requested and never intercepts typing in a field. */
export default function ShortcutGuide({ onClose }: ShortcutGuideProps) {
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
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 text-sm">
          {([
            ['Show or hide this guide', '?'],
            ['Flag or unflag selected photos', 'F'],
            ['Rate selected photos', '1–5'],
            ['All photos / grid view', 'G'],
            ['Compare original and edit', '\\'],
            ['Select all photos', 'Ctrl/Cmd + A'],
            ['Undo / redo', 'Ctrl/Cmd + Z / Shift + Z'],
            ['Export', 'Ctrl/Cmd + E'],
            ['Settings', 'Ctrl/Cmd + ,'],
            ['Close this guide', 'Esc'],
          ] as const).map(([label, key]) => (
            <React.Fragment key={label}>
              <dt className="text-[var(--text-secondary)]">{label}</dt>
              <dd className="text-right font-medium">{key}</dd>
            </React.Fragment>
          ))}
        </dl>
      </section>
    </div>
  );
}
