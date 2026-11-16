import { Loader2 } from 'lucide-react';

/** Shown while photos are being added: a real progress bar, how many are done, and a reassurance that work can go on. */
export function ImportProgress({ loaded, total }: { loaded: number; total: number }) {
  const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  return (
    <div role="status" aria-live="polite" className="mx-2 mb-2 rounded-lg border border-sky-300/30 bg-sky-300/10 px-3 py-2 text-sm text-sky-50">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 font-medium"><Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />Adding photos</span>
        <span className="tabular-nums">{loaded} of {total}</span>
      </div>
      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-black/30" aria-hidden="true">
        <div className="h-full rounded-full bg-sky-300 transition-[width] duration-300" style={{ width: `${percent}%` }} />
        {/* A moving highlight so it is plain the app is working, even when a big photo takes a while. Still when motion is reduced. */}
        <div className="absolute inset-y-0 left-0 w-1/4 bg-white/25 motion-safe:animate-[import-sheen_1.4s_linear_infinite]" style={{ display: percent >= 100 ? 'none' : undefined }} />
      </div>
      <p className="mt-1.5 text-xs text-sky-100/80">Large photos take longer. Your originals are not changed, and you can keep looking while this finishes.</p>
    </div>
  );
}
