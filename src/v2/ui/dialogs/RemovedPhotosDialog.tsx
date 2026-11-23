import { useEffect, useRef } from 'react';
import type { Photo } from '../contract';
import { STRINGS } from '../strings';

interface RemovedPhotosDialogProps {
  open: boolean;
  photos: Photo[];
  onRestore: (photoIds: string[]) => void;
  onClose: () => void;
}

/**
 * Browse photos moved to Trash and bring any of them straight back, without walking back through per-photo
 * Undo (the only way to reverse a removal before this). Their original files were never written, moved or
 * deleted; this only reverses InFlight's own "remove from library" bookkeeping (src/core/cullingEngine.ts).
 */
export default function RemovedPhotosDialog({ open, photos, onRestore, onClose }: RemovedPhotosDialogProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const t = STRINGS.removedDialog;

  useEffect(() => {
    if (!open) return;
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
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="v2-removed-title"
        className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 text-[var(--text-primary)] shadow-[var(--shadow-panel)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="v2-removed-title" className="text-base font-semibold">{t.heading(photos.length)}</h2>
          <button ref={closeButton} type="button" onClick={onClose} aria-label={t.close}
            className="min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm">{t.close}</button>
        </div>
        <p className="mb-3 text-sm text-[var(--text-secondary)]">{t.intro}</p>
        {photos.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">{t.nothing}</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {photos.map((photo) => (
              <li key={photo.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-[var(--bg-surface-hover)] px-2.5 py-1.5">
                <span className="min-w-0 truncate">{photo.filename}</span>
                <button type="button" onClick={() => onRestore([photo.id])} aria-label={t.restorePhoto(photo.filename)}
                  className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-2.5 text-xs font-medium hover:bg-[var(--bg-surface-active)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]">
                  {t.restore}
                </button>
              </li>
            ))}
          </ul>
        )}
        {photos.length > 0 && (
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={() => onRestore(photos.map((photo) => photo.id))}
              className="min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm font-medium">
              {t.restoreAll}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
