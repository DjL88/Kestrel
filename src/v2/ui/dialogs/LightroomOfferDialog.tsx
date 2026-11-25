import { useEffect, useRef } from 'react';
import { STRINGS } from '../strings';

interface LightroomOfferDialogProps {
  offer: { missing: number; folder: string } | null | undefined;
  onChooseFolder: () => void;
  onClose: () => void;
}

/**
 * After a Lightroom catalogue is read: offer to add the catalogue's photos that are not in this project yet. The person
 * chooses the folder (a browser can only read a folder the person picks); only files that are surely the catalogue's
 * photos are added, and originals are never changed.
 */
export default function LightroomOfferDialog({ offer, onChooseFolder, onClose }: LightroomOfferDialogProps) {
  const chooseButton = useRef<HTMLButtonElement>(null);
  const t = STRINGS.lightroom;
  const open = Boolean(offer);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    chooseButton.current?.focus();
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

  if (!offer) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="v2-lightroom-title" aria-describedby="v2-lightroom-body"
        className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 text-[var(--text-primary)] shadow-[var(--shadow-panel)]">
        <h2 id="v2-lightroom-title" className="mb-3 text-base font-semibold">{t.offerTitle}</h2>
        <p id="v2-lightroom-body" className="mb-4 text-sm text-[var(--text-secondary)] [overflow-wrap:anywhere]">{t.offerBody(offer.missing, offer.folder)}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose}
            className="min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm">{t.notNow}</button>
          <button ref={chooseButton} type="button" onClick={onChooseFolder}
            className="min-h-10 rounded-[var(--radius-sm)] bg-[var(--brand-accent)] px-3 text-sm font-medium text-[var(--text-on-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-accent)]">{t.chooseFolder}</button>
        </div>
      </section>
    </div>
  );
}
