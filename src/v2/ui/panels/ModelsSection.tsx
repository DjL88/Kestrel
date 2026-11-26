import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { STRINGS } from '../strings';
import { medianRunMs, modelStat, modelStatsVersion, subscribeModelStats } from '../../../core/modelStats';

import { LOCAL_VISION_ID } from '../../../core/localVisionMetrics';
import { MODEL_CATALOGUE, measureModels, type CatalogueEntry, type ModelPlace } from '../../../providers/modelCatalogue';
import { optionalModelBytes } from '../../../core/optionalModels';

/**
 * Settings → Models (P0 #703): each model's version, checksum and size, whether it is on this device, and what it
 * cost here: load time and time per run, measured live, and peak memory as measured at conversion. Values that were
 * not measured say so; nothing is estimated. Measure now runs each installed model once on a made-up test picture.
 * Opt-in packs offered by this build can be downloaded (once, checked against the pinned checksum) and removed here.
 */
const T = STRINGS.models;

const placeText = (place: ModelPlace | undefined) => place === 'built-in' ? T.place.builtIn : place === 'downloaded' ? T.place.downloaded
  : place === 'not-downloaded' ? T.place.notDownloaded : place === 'not-offered' ? T.place.notOffered : '…';

const number = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
const ms = (value: number | null) => (value === null ? T.notMeasured : `${number(value)} ms`);
const mb = (bytes: number) => `${number(bytes / 1e6, 1)} MB`;
/** What people see a model called: what it does, never the model's own name (that is under Technical details). */
const plainName = (entry: CatalogueEntry) => T.role[entry.role];
const why = (entry: CatalogueEntry) => (T.why as Partial<Record<string, string>>)[entry.role];

const BUTTON = 'rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] disabled:opacity-50';

export function ModelsSection() {
  useSyncExternalStore(subscribeModelStats, modelStatsVersion, modelStatsVersion);
  const [places, setPlaces] = useState<Record<string, ModelPlace>>({});
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState(false);
  const stopper = useRef<AbortController | null>(null);
  const [fetching, setFetching] = useState<{ id: string; percent: number } | null>(null);
  const fetcher = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all(MODEL_CATALOGUE.map(async (entry) => [entry.id, await entry.place().catch(() => 'not-offered' as const)] as const))
      .then((pairs) => { if (live) setPlaces(Object.fromEntries(pairs)); });
    return () => { live = false; stopper.current?.abort(); fetcher.current?.abort(); };
  }, []);

  const refreshPlace = async (entry: CatalogueEntry) => {
    const place = await entry.place().catch(() => 'not-offered' as const);
    setPlaces((current) => ({ ...current, [entry.id]: place }));
  };

  const download = async (entry: CatalogueEntry) => {
    if (!entry.pack) return;
    const controller = new AbortController();
    fetcher.current = controller;
    setFetching({ id: entry.id, percent: 0 });
    setStatus(T.downloading(plainName(entry), 0));
    try {
      await entry.pack.download((fraction) => {
        const percent = Math.floor(fraction * 100);
        setFetching({ id: entry.id, percent });
        setStatus(T.downloading(plainName(entry), percent));
      }, controller.signal);
      setStatus(T.packReady(plainName(entry)));
    } catch (error) {
      setStatus((error as Error).name === 'AbortError' ? '' : (error as Error).message);
    } finally {
      fetcher.current = null;
      setFetching(null);
      await refreshPlace(entry);
    }
  };

  const remove = async (entry: CatalogueEntry) => {
    if (!entry.pack) return;
    try {
      await entry.pack.remove();
      setStatus(T.packRemoved(plainName(entry)));
    } catch (error) {
      setStatus((error as Error).message);
    }
    await refreshPlace(entry);
  };

  const measure = async () => {
    const controller = new AbortController();
    stopper.current = controller;
    setRunning(true);
    try {
      const { failed } = await measureModels((entry) => setStatus(T.measuring(plainName(entry))), controller.signal);
      const names = MODEL_CATALOGUE.filter((entry) => failed.includes(entry.id)).map(plainName);
      setStatus(names.length ? T.failed(names.join(', ')) : T.done);
    } catch (error) {
      setStatus((error as Error).name === 'AbortError' ? '' : T.failed('—'));
    } finally {
      setRunning(false);
      stopper.current = null;
    }
  };

  return (
    <section aria-labelledby="models-title" data-testid="v2-models" className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-4">
      <h3 id="models-title" className="text-xs font-semibold text-[var(--text-primary)]">{T.title}</h3>
      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{T.hint}</p>
      <div className="flex flex-wrap items-center gap-2">
        {running
          ? <button type="button" onClick={() => stopper.current?.abort()} className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]">{T.stop}</button>
          : <button type="button" data-testid="v2-models-measure" disabled={!!fetching} onClick={() => void measure()} className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]">{T.measure}</button>}
        <span className="text-xs text-[var(--text-secondary)]">{T.measureHint}</span>
      </div>
      <p role="status" aria-live="polite" className="text-xs text-[var(--text-primary)]">{status}</p>
      <ul className="space-y-3">
        {MODEL_CATALOGUE.map((entry) => (
          <li key={entry.id} data-testid={`v2-model-${entry.id}`} className="space-y-1 border-t border-[var(--border-subtle)] pt-2">
            <p className="text-xs text-[var(--text-primary)]">
              <span className="font-semibold">{plainName(entry)}</span> · <span data-testid="v2-model-place">{placeText(places[entry.id])}</span>
            </p>
            {why(entry) && <p className="text-xs text-[var(--text-secondary)]">{why(entry)}</p>}
            <details className="text-xs text-[var(--text-secondary)]">
            <summary className="cursor-pointer text-[var(--text-primary)]">{T.technical}</summary>
            <p className="pt-1 text-[var(--text-primary)]">{entry.name}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-[var(--text-secondary)]">
              <dt>{T.version}</dt><dd className="select-text font-mono text-[var(--text-primary)]">{entry.version ?? '—'}</dd>
              <dt>{T.licence}</dt><dd className="text-[var(--text-primary)]">{entry.licence}</dd>
              {modelStat(entry.id)?.loadRamBytes != null
                ? <><dt>{T.memoryLoaded}</dt><dd data-testid="v2-model-ram" className="text-[var(--text-primary)]">{mb(modelStat(entry.id)!.loadRamBytes!)}</dd></>
                : <><dt>{T.memory}</dt><dd className="text-[var(--text-primary)]">{entry.peakMemory ? `${number(entry.peakMemory.megabytes)} MB *` : T.notMeasured}</dd></>}
            </dl>
            {entry.id === LOCAL_VISION_ID && (
              <dl data-testid={`v2-model-whole-${entry.id}`} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pl-3 text-xs text-[var(--text-secondary)]">
                <dt className="col-span-2 text-[var(--text-primary)]">{T.wholeModel}</dt>
                <dt>{T.loadTime}</dt><dd data-testid="v2-model-load" className="text-[var(--text-primary)]">{ms(modelStat(entry.id)?.loadMs ?? null)}</dd>
                <dt>{T.runTime}</dt><dd data-testid="v2-model-run" className="text-[var(--text-primary)]">{ms(medianRunMs(modelStat(entry.id)))}</dd>
              </dl>
            )}
            {entry.files.map((file) => {
              const stat = modelStat(file.statId);
              return (
                <dl key={file.statId} data-testid={`v2-model-file-${file.statId}`} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pl-3 text-xs text-[var(--text-secondary)]">
                  <dt className="col-span-2 font-mono text-[var(--text-primary)]">{file.file}</dt>
                  <dt>{T.checksum}</dt>
                  <dd title={file.sha256} className="select-text break-all font-mono text-[var(--text-primary)]">{file.sha256.slice(0, 16)}…</dd>
                  <dt>{T.size}</dt><dd className="text-[var(--text-primary)]">{mb(file.bytes)}</dd>
                  {entry.id !== LOCAL_VISION_ID && <>
                    <dt>{T.loadTime}</dt><dd data-testid="v2-model-load" className="text-[var(--text-primary)]">{ms(stat?.loadMs ?? null)}</dd>
                    <dt>{T.runTime}</dt><dd data-testid="v2-model-run" className="text-[var(--text-primary)]">{ms(medianRunMs(stat))}</dd>
                  </>}
                </dl>
              );
            })}
            </details>
            {!entry.measure && <p className="text-xs text-[var(--text-secondary)]">{T.timedInUse}</p>}
            {entry.pack && (places[entry.id] === 'not-downloaded' || places[entry.id] === 'downloaded') && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {fetching?.id === entry.id ? (
                  <>
                    <progress value={fetching.percent} max={100} aria-label={T.downloading(plainName(entry), fetching.percent)} className="h-1.5 w-32" />
                    <button type="button" data-testid="v2-model-cancel" onClick={() => fetcher.current?.abort()} className={BUTTON}>{T.cancel}</button>
                  </>
                ) : places[entry.id] === 'downloaded' ? (
                  <button type="button" data-testid="v2-model-remove" disabled={running || !!fetching} onClick={() => void remove(entry)} className={BUTTON}>{T.removePack}</button>
                ) : (
                  <button type="button" data-testid="v2-model-download" disabled={running || !!fetching} onClick={() => void download(entry)} className={BUTTON}>
                    {T.downloadPack(mb(optionalModelBytes(entry.pack.model)))}
                  </button>
                )}
                <span className="text-xs text-[var(--text-secondary)]">{T.packNote}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-[var(--text-secondary)]">* {T.memoryNote}</p>
    </section>
  );
}
