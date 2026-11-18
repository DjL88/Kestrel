import { Loader2 } from 'lucide-react';
import { WorkProgressBar } from './WorkProgressBar';

/** Shown while photos are being added: a real progress bar, how many are done, and a reassurance that work can go on. */
export function ImportProgress({ loaded, total }: { loaded: number; total: number }) {
  return (
    <div role="status" aria-live="polite" className="mx-2 mb-2 rounded-lg border border-sky-300/30 bg-sky-300/10 px-3 py-2 text-sm text-sky-50">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 font-medium"><Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />Adding photos</span>
        <span className="tabular-nums">{loaded} of {total}</span>
      </div>
      <div className="mt-2"><WorkProgressBar done={loaded} total={total} label="Adding photos" /></div>
      <p className="mt-1.5 text-xs text-sky-100/80">Large photos take longer. Your originals are not changed, and you can keep looking while this finishes.</p>
    </div>
  );
}
