import { useState } from 'react';
import { Download } from 'lucide-react';
import { megabytes } from '../core/speciesModel';
import type { useSpeciesScan } from '../useSpeciesScan';
import { ONLINE_HELPER_VISIBLE, openHelperDialog } from '../providers/helperSettings';
import { viewerText as t } from '../i18n/areas/viewer';

/**
 * On the project page: offers to turn on species recognition, and shows how far the background look has got.
 * Hidden when the feature is not set up, when there is nothing to look at, and once everything has been looked at.
 */
export function SpeciesScanBanner({ scan }: { scan: ReturnType<typeof useSpeciesScan> }) {
  const [hidden, setHidden] = useState(false);
  if (scan.status === 'checking') return null;
  if (scan.error) return <p role="alert" className="mx-2 mb-2 rounded-lg border border-orange-300/30 bg-orange-300/10 px-3 py-2 text-sm text-orange-100">{scan.error}</p>;
  const offlineAvailable = scan.status === 'not-downloaded';
  if (!scan.helperOn && (offlineAvailable || (scan.status === 'unavailable' && ONLINE_HELPER_VISIBLE))) {
    if (hidden || scan.pending === 0) return null;
    return (
      <section aria-label={t.scanBanner.region} className="mx-2 mb-2 rounded-lg border border-white/12 bg-white/5 px-3">
        <details>
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-zinc-200">{t.scanBanner.summary}</summary>
          <div className="flex flex-wrap items-center gap-2 pb-2">
            <p className="min-w-0 flex-1 basis-56 text-sm text-zinc-300">{offlineAvailable
              ? t.scanBanner.offlineOffer(megabytes(scan.size))
              : t.scanBanner.onlineOffer}</p>
            {scan.downloading === null ? (
              <>
                {offlineAvailable && <button type="button" onClick={() => void scan.download()} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-white/20 px-3 text-sm font-medium hover:bg-white/10">
                  <Download className="h-4 w-4" aria-hidden="true" />{t.scanBanner.download(megabytes(scan.size))}
                </button>}
                {ONLINE_HELPER_VISIBLE && <button type="button" onClick={() => openHelperDialog()} className="min-h-11 px-2 text-sm text-zinc-300 underline underline-offset-4 hover:text-white">{t.scanBanner.helperSettings}</button>}
                <button type="button" onClick={() => setHidden(true)} className="min-h-11 px-2 text-sm text-zinc-300 underline underline-offset-4 hover:text-white">{t.scanBanner.notNow}</button>
              </>
            ) : <progress aria-label={t.scanBanner.downloading} className="block w-48" value={scan.downloading} max={1} />}
          </div>
        </details>
      </section>
    );
  }
  return null;
}
