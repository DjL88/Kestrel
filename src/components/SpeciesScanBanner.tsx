import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { megabytes } from '../core/speciesModel';
import type { useSpeciesScan } from '../useSpeciesScan';
import { openHelperDialog } from '../providers/helperSettings';

/**
 * On the project page: offers to turn on species recognition, and shows how far the background look has got.
 * Hidden when the feature is not set up, when there is nothing to look at, and once everything has been looked at.
 */
export function SpeciesScanBanner({ scan }: { scan: ReturnType<typeof useSpeciesScan> }) {
  const [hidden, setHidden] = useState(false);
  if (scan.status === 'checking') return null;
  if (scan.error) return <p role="alert" className="mx-2 mb-2 rounded-lg border border-orange-300/30 bg-orange-300/10 px-3 py-2 text-sm text-orange-100">{scan.error}</p>;
  if (scan.status === 'unavailable' && !scan.helperOn) {
    if (hidden || scan.pending === 0) return null;
    return (
      <section aria-label="Species recognition" className="mx-2 mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-white/12 bg-white/5 px-3 py-2">
        <p className="min-w-0 flex-1 basis-56 text-sm text-zinc-200">An optional online helper can name the birds and animals.</p>
        <button type="button" onClick={() => openHelperDialog()} className="inline-flex min-h-11 items-center rounded-md border border-white/20 px-3 text-sm font-medium hover:bg-white/10">Set up the online helper</button>
        <button type="button" onClick={() => setHidden(true)} className="min-h-11 px-2 text-sm text-zinc-300 underline underline-offset-4 hover:text-white">Not now</button>
      </section>
    );
  }
  if (scan.status === 'not-downloaded' && !scan.helperOn) {
    if (hidden || scan.pending === 0) return null;
    return (
      <section aria-label="Species recognition" className="mx-2 mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-white/12 bg-white/5 px-3 py-2">
        <p className="min-w-0 flex-1 basis-56 text-sm text-zinc-200">Name the birds and animals for you. {megabytes(scan.size)} once, then offline.</p>
        {scan.downloading === null ? (
          <>
            <button type="button" onClick={() => void scan.download()} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-white/20 px-3 text-sm font-medium hover:bg-white/10">
              <Download className="h-4 w-4" aria-hidden="true" />Download ({megabytes(scan.size)})
            </button>
            <button type="button" onClick={() => openHelperDialog()} className="min-h-11 px-2 text-sm text-zinc-300 underline underline-offset-4 hover:text-white">Or use the online helper</button>
            <button type="button" onClick={() => setHidden(true)} className="min-h-11 px-2 text-sm text-zinc-300 underline underline-offset-4 hover:text-white">Not now</button>
          </>
        ) : <progress aria-label="Downloading species recognition" className="block w-48" value={scan.downloading} max={1} />}
      </section>
    );
  }
  if (!scan.progress.running || scan.progress.total === 0) return null;
  return (
    <section aria-label="Species recognition" className="mx-2 mb-2 rounded-lg border border-white/12 bg-white/5 px-3 py-2">
      <p role="status" className="flex items-center gap-2 text-sm text-zinc-200">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {scan.helperOn ? 'Asking the online helper about your photos…' : 'Looking at your photos…'} {scan.progress.done} of {scan.progress.total}
      </p>
      <progress aria-label="Looking at your photos" className="mt-1 block w-full" value={scan.progress.done} max={scan.progress.total} />
    </section>
  );
}
