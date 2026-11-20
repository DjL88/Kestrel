import { useEffect } from 'react';
import { libraryText as t } from '../i18n/areas/library';

/** A calm full-window cue while photos are dragged over Kestrel, and a short note if a drop held no photos. */
export function DropOverlay({ dragging, message, onDismiss }: { dragging: boolean; message: string | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);
  if (dragging) {
    return (
      <div aria-hidden="true" className="pointer-events-none fixed inset-3 z-[60] flex items-center justify-center rounded-2xl border-2 border-dashed border-sky-300/70 bg-kestrel-canvas/80 text-lg font-medium text-sky-100">
        {t.drop.dropPhotos}
      </div>
    );
  }
  return message ? <p role="status" className="fixed bottom-3 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-white/15 bg-kestrel-raised px-4 py-2 text-sm text-zinc-100 shadow-lg">{message}</p> : null;
}
