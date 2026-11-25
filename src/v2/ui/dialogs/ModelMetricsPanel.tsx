import { useEffect, useState } from 'react';
import { projectsText } from '../../../i18n/areas/projects';
import { formatBytes, formatDuration, inferenceMs, shortDigest, type LocalModelMetrics } from '../../../core/modelMetrics';
import { OPTIONAL_MODELS } from '../../../core/optionalModels';
import { hasLocalVision, localVisionMetrics, measureLocalVision } from '../../../providers/localVision';
import { optionalModelStatus, type OptionalModelStatus } from '../../../providers/optionalModels';

/**
 * Settings > AI > Models on this device (#703). Shows each on-device model's version, pinned SHA-256, and the load time,
 * memory and inference latency this device actually measured. Nothing is typed in: values come from the desktop runtime
 * (Rust, ONNX Runtime) and stay "Not measured" until a real load or run has happened in this session.
 */
const text = projectsText.modelMetrics;
const row = 'grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]';
const value = 'select-text break-all font-mono text-[var(--text-primary)]';

function Measured({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return <><dt>{label}</dt><dd className={value} data-testid={testId}>{children}</dd></>;
}

export default function ModelMetricsPanel() {
  const desktop = hasLocalVision();
  const [metrics, setMetrics] = useState<LocalModelMetrics | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [packs, setPacks] = useState<Record<string, OptionalModelStatus>>({});

  useEffect(() => {
    let live = true;
    if (desktop) void localVisionMetrics().then((next) => { if (live) setMetrics(next); });
    void Promise.all(OPTIONAL_MODELS.map(async (model) => [model.id, await optionalModelStatus(model)] as const))
      .then((entries) => { if (live) setPacks(Object.fromEntries(entries)); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [desktop]);

  async function measure() {
    setMeasuring(true);
    setError(null);
    try { setMetrics(await measureLocalVision()); } catch (reason) {
      setError(text.measureFailed(reason instanceof Error ? reason.message : String(reason)));
    } finally { setMeasuring(false); }
  }

  const notMeasured = text.notMeasured;
  const total = metrics ? inferenceMs(metrics) : null;

  return (
    <section aria-labelledby="model-metrics-title" data-testid="v2-model-metrics" className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-4">
      <div>
        <h3 id="model-metrics-title" className="text-xs font-semibold text-[var(--text-primary)]">{text.heading}</h3>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{text.intro}</p>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-[var(--text-primary)]">{text.vlmName}</h4>
        {!desktop && <p data-testid="v2-model-metrics-desktop-only" className="text-xs text-[var(--text-secondary)]">{text.desktopOnly}</p>}
        {desktop && metrics && !metrics.installed && <p className="text-xs text-[var(--text-secondary)]">{text.notInstalled}</p>}
        {desktop && metrics && (
          <>
            <dl className={row}>
              <Measured label={text.version}>{metrics.revision}</Measured>
              <Measured label={text.runtime}>ONNX Runtime (CPU)</Measured>
              <Measured label={text.digests}>{metrics.digestsVerified ? `✓ ${text.digestsVerified}` : text.digestsPending}</Measured>
              <Measured label={text.loadTime} testId="v2-model-load-ms">{metrics.loadMs !== null ? formatDuration(metrics.loadMs) : notMeasured}</Measured>
              <Measured label={text.loadRam}>{metrics.loadRamBytes !== null ? formatBytes(metrics.loadRamBytes) : notMeasured}</Measured>
              <Measured label={text.processRam}>{metrics.processRamBytes !== null ? formatBytes(metrics.processRamBytes) : notMeasured}</Measured>
              <Measured label={text.latency} testId="v2-model-latency">
                {total !== null
                  ? `${formatDuration(total)} (${text.latencySplit(formatDuration(metrics.visionMs!), formatDuration(metrics.generateMs!), metrics.newTokens ?? 0)})`
                  : notMeasured}
              </Measured>
              <Measured label={text.runs}>{metrics.runs}</Measured>
            </dl>
            <details className="text-xs text-[var(--text-secondary)]">
              <summary className="cursor-pointer">{text.files}</summary>
              <ul className="mt-1 space-y-0.5">
                {metrics.files.map((file) => (
                  <li key={file.name} className="font-mono">
                    {file.name} · {formatBytes(file.bytes)} · <span title={file.sha256} className="select-text">{shortDigest(file.sha256)}</span>
                  </li>
                ))}
              </ul>
            </details>
            {metrics.installed && (
              <div className="space-y-1">
                <button type="button" onClick={() => void measure()} disabled={measuring} data-testid="v2-model-measure"
                  className="h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-xs font-semibold text-[var(--text-primary)] disabled:opacity-60">
                  {measuring ? text.measuring : text.measure}
                </button>
                <p className="text-[0.6875rem] text-[var(--text-muted)]">{text.measureHint}</p>
              </div>
            )}
            {error && <p role="alert" className="text-xs font-medium text-[var(--text-primary)]">⚠ {error}</p>}
          </>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-[var(--text-primary)]">{text.packs}</h4>
        <ul className="space-y-2">
          {OPTIONAL_MODELS.map((model) => {
            const status = packs[model.id];
            return (
              <li key={model.id} data-testid={`v2-model-pack-${model.id}`} className="text-xs text-[var(--text-secondary)]">
                <p className="font-semibold text-[var(--text-primary)]">{model.name}</p>
                <p>{status === 'ready' ? `✓ ${text.packReady}` : status === 'not-downloaded' ? text.packMissing : status === 'unavailable' ? text.packUnavailable : '…'} · {model.licence}</p>
                <p className="font-mono">{model.id}</p>
                <ul className="font-mono">
                  {Object.entries(model.files).map(([name, file]) => (
                    <li key={name}>{name} · {formatBytes(file.bytes)} · <span title={file.sha256} className="select-text">{shortDigest(file.sha256)}</span></li>
                  ))}
                </ul>
                <p className="text-[0.6875rem] text-[var(--text-muted)]">{text.packTimingsNotMeasured}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
