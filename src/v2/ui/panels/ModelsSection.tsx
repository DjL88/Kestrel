import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { STRINGS } from '../strings';
import { medianRunMs, modelStat, modelStatsVersion, subscribeModelStats } from '../../../core/modelStats';
import { MODEL_CATALOGUE, measureModels, type ModelPlace } from '../../../providers/modelCatalogue';

/**
 * Settings → Models (P0 #703): each model's version, checksum and size, whether it is on this device, and what it
 * cost here: load time and time per run, measured live, and peak memory as measured at conversion. Values that were
 * not measured say so; nothing is estimated. Measure now runs each installed model once on a made-up test picture.
 */
const T = STRINGS.models;

const placeText = (place: ModelPlace | undefined) => place === 'built-in' ? T.place.builtIn : place === 'downloaded' ? T.place.downloaded
  : place === 'not-downloaded' ? T.place.notDownloaded : place === 'not-offered' ? T.place.notOffered : '…';

const number = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
const ms = (value: number | null) => (value === null ? T.notMeasured : `${number(value)} ms`);
const mb = (bytes: number) => `${number(bytes / 1e6, 1)} MB`;

export function ModelsSection() {
  useSyncExternalStore(subscribeModelStats, modelStatsVersion, modelStatsVersion);
  const [places, setPlaces] = useState<Record<string, ModelPlace>>({});
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState(false);
  const stopper = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all(MODEL_CATALOGUE.map(async (entry) => [entry.id, await entry.place().catch(() => 'not-offered' as const)] as const))
      .then((pairs) => { if (live) setPlaces(Object.fromEntries(pairs)); });
    return () => { live = false; stopper.current?.abort(); };
  }, []);

  const measure = async () => {
    const controller = new AbortController();
    stopper.current = controller;
    setRunning(true);
    try {
      const { failed } = await measureModels((entry) => setStatus(T.measuring(entry.name)), controller.signal);
      const names = MODEL_CATALOGUE.filter((entry) => failed.includes(entry.id)).map((entry) => entry.name);
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
          : <button type="button" data-testid="v2-models-measure" onClick={() => void measure()} className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]">{T.measure}</button>}
        <span className="text-xs text-[var(--text-secondary)]">{T.measureHint}</span>
      </div>
      <p role="status" aria-live="polite" className="text-xs text-[var(--text-primary)]">{status}</p>
      <ul className="space-y-3">
        {MODEL_CATALOGUE.map((entry) => (
          <li key={entry.id} data-testid={`v2-model-${entry.id}`} className="space-y-1 border-t border-[var(--border-subtle)] pt-2">
            <p className="text-xs text-[var(--text-primary)]">
              <span className="font-semibold">{entry.name}</span> · {T.role[entry.role]} · <span data-testid="v2-model-place">{placeText(places[entry.id])}</span>
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-[var(--text-secondary)]">
              <dt>{T.version}</dt><dd className="select-text font-mono text-[var(--text-primary)]">{entry.version ?? '—'}</dd>
              <dt>{T.licence}</dt><dd className="text-[var(--text-primary)]">{entry.licence}</dd>
              <dt>{T.memory}</dt>
              <dd className="text-[var(--text-primary)]">{entry.peakMemory ? `${number(entry.peakMemory.megabytes)} MB *` : T.notMeasured}</dd>
            </dl>
            {entry.files.map((file) => {
              const stat = modelStat(file.statId);
              return (
                <dl key={file.statId} data-testid={`v2-model-file-${file.statId}`} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pl-3 text-xs text-[var(--text-secondary)]">
                  <dt className="col-span-2 font-mono text-[var(--text-primary)]">{file.file}</dt>
                  <dt>{T.checksum}</dt>
                  <dd title={file.sha256} className="select-text break-all font-mono text-[var(--text-primary)]">{file.sha256.slice(0, 16)}…</dd>
                  <dt>{T.size}</dt><dd className="text-[var(--text-primary)]">{mb(file.bytes)}</dd>
                  <dt>{T.loadTime}</dt><dd data-testid="v2-model-load" className="text-[var(--text-primary)]">{ms(stat?.loadMs ?? null)}</dd>
                  <dt>{T.runTime}</dt><dd data-testid="v2-model-run" className="text-[var(--text-primary)]">{ms(medianRunMs(stat))}</dd>
                </dl>
              );
            })}
            {!entry.measure && <p className="text-xs text-[var(--text-secondary)]">{T.timedInUse}</p>}
          </li>
        ))}
      </ul>
      <p className="text-xs text-[var(--text-secondary)]">* {T.memoryNote}</p>
    </section>
  );
}
