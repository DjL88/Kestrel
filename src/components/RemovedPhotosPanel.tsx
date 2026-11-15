import { X } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import type { PhotoFrame } from '../core/types';

interface Props {
  frames: PhotoFrame[];
  onRestore: (ids: string[]) => void;
  onClose: () => void;
}

/** Lists photos taken out of the library. Their original files were never deleted. */
export function RemovedPhotosPanel({ frames, onRestore, onClose }: Props) {
  return (
    <ConfirmDialog title={`Removed photos (${frames.length})`} confirmLabel={frames.length ? 'Restore all' : 'Close'}
      cancelLabel="Close" onCancel={onClose} onConfirm={() => { if (frames.length) onRestore(frames.map((frame) => frame.id)); onClose(); }}>
      <p>These photos are out of your library, counts and exports. Your original files were not deleted. Restored photos return to Trash.</p>
      {frames.length === 0 ? <p>Nothing has been removed.</p> : (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {frames.map((frame) => (
            <li key={frame.id} className="flex items-center justify-between gap-2 rounded bg-black/20 px-2 py-1">
              <span className="min-w-0 truncate">{frame.filename}</span>
              <button type="button" onClick={() => onRestore([frame.id])} aria-label={`Restore ${frame.filename}`} title={`Restore ${frame.filename}`}
                className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded px-2 text-xs hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
                <X className="hidden" aria-hidden="true" />Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </ConfirmDialog>
  );
}
