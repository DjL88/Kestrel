import { useEffect, useRef, useState } from 'react';
import { vehicleText as t } from '../../../i18n/areas/vehicles';
import { MARKING_PACK_BYTES, downloadMarkingReader, markingReaderReady, removeMarkingReader } from '../../../providers/markingReader';

/**
 * Settings → Assistance: the opt-in aircraft markings reader. Nothing is downloaded until the person presses Download;
 * the files are checked against their pinned checksums and kept on the device, so reading then works offline.
 */
export default function MarkingsReaderSetting() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { void markingReaderReady().then(setReady); return () => abort.current?.abort(); }, []);
  const megabytes = (MARKING_PACK_BYTES / 1_000_000).toFixed(1);

  async function download() {
    setFailed(false);
    setProgress(0);
    abort.current = new AbortController();
    try {
      await downloadMarkingReader((fraction) => setProgress(fraction), abort.current.signal);
      setReady(true);
    } catch {
      setFailed(true);
    } finally {
      setProgress(null);
    }
  }

  return (
    <section aria-labelledby="markings-reader-title" className="flex items-start justify-between gap-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4">
      <div>
        <h4 id="markings-reader-title" className="text-xs font-semibold text-[var(--text-primary)]">{t.reader.title}</h4>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{t.reader.description(megabytes)}</p>
        <p role="status" className="mt-1 text-xs text-[var(--text-secondary)]">
          {progress !== null ? t.reader.downloading(Math.round(progress * 100)) : failed ? t.reader.failed : ready ? t.reader.ready : ''}
        </p>
      </div>
      {ready ? (
        <button type="button" onClick={() => { void removeMarkingReader().then(() => setReady(false)); }}
          className="shrink-0 rounded border border-[var(--border-default)] px-3 py-1 text-xs">{t.reader.remove}</button>
      ) : (
        <button type="button" disabled={ready === null || progress !== null} onClick={() => { void download(); }}
          className="shrink-0 rounded border border-[var(--border-default)] px-3 py-1 text-xs disabled:opacity-40">{t.reader.download}</button>
      )}
    </section>
  );
}
