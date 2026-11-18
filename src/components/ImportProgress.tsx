import { Loader2 } from 'lucide-react';

/**
 * Shown while photos are being added: a real progress bar, how many are done, Stop, and the fact that work can go on.
 * Photos appear in the library as they are read, so they can be looked at, culled and edited before the import ends.
 */
export function ImportProgress({ loaded, total, finding = false, onStop }: {
  loaded: number;
  total: number;
  /** Still looking through the chosen folder; the number of photos may not be known yet. */
  finding?: boolean;
  onStop?: () => void;
}) {
  const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  return (
    <div role="status" aria-live="polite" className="mx-2 mb-2 rounded-lg border border-sky-300/30 bg-sky-300/10 px-3 py-2 text-sm text-sky-50">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 font-medium"><Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />{finding ? 'Finding photos in the folder' : 'Adding photos'}</span>
        <span className="flex items-center gap-2">
          <span className="tabular-nums">{finding && !total ? 'Looking…' : `${loaded} of ${total}`}</span>
          {onStop && <button type="button" onClick={onStop}
            className="min-h-9 rounded-md border border-sky-200/30 px-2 text-xs font-medium hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">Stop</button>}
        </span>
      </div>
      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-black/30" aria-hidden="true">
        <div className="h-full rounded-full bg-sky-300 transition-[width] duration-300" style={{ width: `${percent}%` }} />
        {/* A moving highlight so it is plain the app is working, even when a big photo takes a while. Still when motion is reduced. */}
        <div className="absolute inset-y-0 left-0 w-1/4 bg-white/25 motion-safe:animate-[import-sheen_1.4s_linear_infinite]" style={{ display: percent >= 100 ? 'none' : undefined }} />
      </div>
      <p className="mt-1.5 text-xs text-sky-100/80">
        {finding
          ? 'Looking through the folder for photos. Your originals are not changed.'
          : 'Photos appear as they are added: you can look, choose and edit them now. Stop keeps the ones already added. Your originals are not changed.'}
      </p>
    </div>
  );
}
