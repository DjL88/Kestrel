import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import {
  EXPORT_FORMATS, LEGACY_FORMAT_IDS, PLATFORMS, customFormat, formatById, framingFor, shapeLabel, sizeLabel, toProfile, turnFormat,
  type BarStyle, type CustomSize, type ExportFormat, type Fit,
} from '../core/exportFormats';
import type { FocusPoint } from '../core/exportFraming';
import type { PhotoFrame } from '../core/types';
import { archiveExports, downloadExport, loadExportSource, renderExport } from '../providers/browserExport';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';
import { ExportPreviewTile } from './ExportPreviewTile';
import { ExportWizard } from './ExportWizard';
import { SocialIcon } from './SocialIcon';

interface Props {
  frames: PhotoFrame[];
  provider: BrowserPreviewProvider;
  source?: HTMLImageElement | null;
  onClose: () => void;
}

const button = 'min-h-11 rounded-md px-3 text-sm font-medium hover:bg-white/10 disabled:opacity-45';
const field = 'min-h-10 w-full rounded-md border border-white/15 bg-[#15171C] px-2 text-base sm:text-sm';
const STORAGE_KEY = 'kestrel.lastExport.v2';
/** Photos drawn in the preview, and the most tiles shown at once, so a big selection stays quick. */
const PREVIEW_PHOTOS = 4;
const MAX_TILES = 12;

const FIT_LABELS: Record<Fit, string> = { fill: 'Crop to fill the shape', bars: 'Whole photo, with borders', keep: 'Keep the photo’s shape' };
const DEFAULT_CUSTOM: CustomSize = { width: 1600, height: 1200, fit: 'keep', format: 'jpeg', quality: 90, prefix: 'custom_' };

function readView(): 'wizard' | 'list' {
  try { return localStorage.getItem('kestrel.exportView') === 'list' ? 'list' : 'wizard'; } catch { return 'wizard'; }
}

function loadChosen(freshStart = false): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(saved)) {
      const ids = saved.filter((id) => typeof id === 'string' && formatById(id));
      if (ids.length) return ids;
    }
    // Choices saved before there were formats map to the nearest format with the same size.
    const older = JSON.parse(localStorage.getItem('kestrel.lastExport.v1') ?? 'null');
    if (Array.isArray(older)) {
      const ids = older.map((id) => LEGACY_FORMAT_IDS[id]).filter((id): id is string => Boolean(id));
      if (ids.length) return [...new Set(ids)];
    }
  } catch { /* Use the default when storage is unavailable. */ }
  return freshStart ? [] : ['master'];
}

export function PhotoExportPanel({ frames, provider, source, onClose }: Props) {
  const [chosen, setChosen] = useState<string[]>(() => loadChosen(readView() === 'wizard'));
  const [fits, setFits] = useState<Record<string, Fit>>({});
  const [overrides, setOverrides] = useState<Record<string, { prefix?: string; quality?: number }>>({});
  const [turned, setTurned] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<'wizard' | 'list'>(readView);
  const [openPlatforms, setOpenPlatforms] = useState<Record<string, boolean>>({});
  const [bars, setBars] = useState<BarStyle>('white');
  const [customOn, setCustomOn] = useState(false);
  const [custom, setCustom] = useState<CustomSize>(DEFAULT_CUSTOM);
  const [anchors, setAnchors] = useState<Record<string, FocusPoint>>({});
  const [zooms, setZooms] = useState<Record<string, number>>({});
  const [sources, setSources] = useState<Record<string, HTMLImageElement>>({});
  const [timestamp, setTimestamp] = useState<'now' | 'capture' | 'custom'>('now');
  const [customDate, setCustomDate] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState('');
  const cancelled = useRef(false);
  const activeExport = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);

  const customResult = customOn ? customFormat(custom) : null;
  const selected: ExportFormat[] = useMemo(() => {
    const base = chosen.flatMap((id) => {
      const format = formatById(id);
      if (!format) return [];
      const edit = overrides[id];
      const made = { ...format, fit: format.id === 'master' ? format.fit : fits[id] ?? format.fit, prefix: edit?.prefix ?? format.prefix, quality: edit?.quality ?? format.quality };
      return [turned[id] ? turnFormat(made) : made];
    });
    return customResult && 'format' in customResult ? [...base, customResult.format] : base;
  }, [chosen, fits, overrides, turned, customResult]);
  const total = selected.length * frames.length;
  const resultsReady = files.length > 0;
  const zoomFor = (frame: PhotoFrame, format: ExportFormat) => zooms[`${frame.id}|${format.id}`] ?? 1;
  const anchorFor = (frame: PhotoFrame, format: ExportFormat): FocusPoint => anchors[`${frame.id}|${format.id}`] ?? frame.focusPoint ?? { x: 0.5, y: 0.5 };

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      activeExport.current?.abort();
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    title.current?.focus();
  }, [resultsReady]);

  // Load the pictures the previews need, a few at a time.
  const previewFrames = frames.slice(0, PREVIEW_PHOTOS);
  useEffect(() => {
    let active = true;
    (async () => {
      for (const frame of previewFrames) {
        if (!active) return;
        try {
          const image = source && frames.length === 1 ? source : await loadExportSource(frame, provider);
          if (active) setSources((prior) => (prior[frame.id] ? prior : { ...prior, [frame.id]: image }));
        } catch { /* That photo simply has no preview. Exporting reports the problem. */ }
      }
    })();
    return () => { active = false; };
    // The first few photos only change when the selection does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, provider, source]);

  useEffect(() => {
    function close(event: KeyboardEvent) {
      if (event.key === 'Tab') {
        const stops = [...(dialog.current?.querySelectorAll<HTMLElement>('button, input, select, summary, [tabindex="0"]') ?? [])]
          .filter((item) => !item.matches(':disabled') && item.getClientRects().length > 0);
        const boundary = event.shiftKey ? stops[0] : stops.at(-1);
        if (stops.length && (!stops.some((stop) => stop === document.activeElement) || document.activeElement === boundary)) {
          event.preventDefault();
          (event.shiftKey ? stops.at(-1) : stops[0])?.focus();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    document.addEventListener('keydown', close, true);
    return () => document.removeEventListener('keydown', close, true);
  }, [onClose]);

  async function prepare() {
    if (customOn && customResult && 'error' in customResult) {
      setError(customResult.error);
      return;
    }
    setProgress(0);
    setError('');
    const controller = new AbortController();
    activeExport.current = controller;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(chosen)); } catch { /* Optional preference. */ }
    const started = new Date();
    const pickedDate = timestamp === 'custom' ? new Date(customDate) : null;
    const output: File[] = [];
    try {
      for (const frame of frames) {
        if (cancelled.current) return;
        const image = source && frames.length === 1 ? source : await loadExportSource(frame, provider);
        const recorded = frame.exif.capturedAtMs ?? (provider.getOriginal(frame.stableKey) as File | undefined)?.lastModified;
        const date = pickedDate ?? (timestamp === 'capture' && Number.isFinite(recorded) ? new Date(recorded!) : started);
        for (const format of selected) {
          if (cancelled.current) return;
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          if (cancelled.current) return;
          output.push(await renderExport(image, frame, toProfile(format), date, controller.signal, framingFor(format.fit), undefined, {
            focus: anchorFor(frame, format), bars, zoom: zoomFor(frame, format),
          }));
          setProgress(output.length);
        }
      }
      setFiles(output);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not prepare the exports.');
    } finally {
      activeExport.current = null;
      if (!cancelled.current) setProgress(null);
    }
  }

  async function downloadZip() {
    setArchiving(true);
    setError('');
    try {
      const zip = await archiveExports(files);
      if (!cancelled.current) downloadExport(zip, 'kestrel-exports.zip');
    } catch {
      setError('Could not create the ZIP. Try a smaller export selection.');
    } finally {
      setArchiving(false);
    }
  }

  const toggle = (id: string, on: boolean) => setChosen((previous) => on ? [...previous, id] : previous.filter((item) => item !== id));
  const tiles = previewFrames.flatMap((frame) => selected.map((format) => ({ frame, format }))).slice(0, MAX_TILES);
  const hiddenTiles = frames.length * selected.length - tiles.length;
  const anyBars = selected.some((format) => format.fit === 'bars' && format.width > 0);

  const formatRow = (format: ExportFormat) => {
    const on = chosen.includes(format.id);
    const current = fits[format.id] ?? format.fit;
    const shownFormat = turned[format.id] ? turnFormat(format) : format;
    return (
      <div key={format.id} className="rounded-md bg-white/5">
        <label className="flex min-h-11 items-center gap-2 px-2 text-sm">
          <input type="checkbox" checked={on} onChange={(event) => toggle(format.id, event.target.checked)} />
          <span className="min-w-0 flex-1">
            <span className="block">{shownFormat.label}</span>
            <span className="block text-xs text-zinc-400">{sizeLabel(shownFormat)}</span>
          </span>
        </label>
        {on && format.id !== 'master' && (
          <label className="block px-2 pb-2 text-xs text-zinc-300">
            <span className="sr-only">How {format.label} fits the photo</span>
            <select className={field} value={current} aria-label={`How ${format.label} fits the photo`}
              onChange={(event) => setFits((prior) => ({ ...prior, [format.id]: event.target.value as Fit }))}>
              {(Object.keys(FIT_LABELS) as Fit[]).map((fit) => <option key={fit} value={fit}>{FIT_LABELS[fit]}</option>)}
            </select>
          </label>
        )}
      </div>
    );
  };

  const customBlock = (
              <fieldset className="space-y-2 rounded-md bg-white/5 p-2">
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-zinc-100">
        <input type="checkbox" checked={customOn} onChange={(event) => setCustomOn(event.target.checked)} />Custom size
      </label>
      {customOn && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {(['width', 'height'] as const).map((axis) => (
            <label key={axis}>{axis === 'width' ? 'Width (px)' : 'Height (px)'}
              <input className={field} type="number" min={1} max={12000} value={Number.isFinite(custom[axis]) ? custom[axis] : ''}
                onChange={(event) => setCustom((prior) => ({ ...prior, [axis]: event.target.valueAsNumber }))} />
            </label>
          ))}
          <label className="col-span-2">Fit
            <select className={field} value={custom.fit} onChange={(event) => setCustom((prior) => ({ ...prior, fit: event.target.value as Fit }))}>
              {(Object.keys(FIT_LABELS) as Fit[]).map((fit) => <option key={fit} value={fit}>{FIT_LABELS[fit]}</option>)}
            </select>
          </label>
          <label>File type
            <select className={field} value={custom.format} onChange={(event) => setCustom((prior) => ({ ...prior, format: event.target.value as 'jpeg' | 'png' }))}>
              <option value="jpeg">JPEG</option>
              <option value="png">PNG (lossless)</option>
            </select>
          </label>
          <label>JPEG quality
            <input className={field} type="number" min={50} max={100} disabled={custom.format === 'png'} value={Number.isFinite(custom.quality) ? custom.quality : ''}
              onChange={(event) => setCustom((prior) => ({ ...prior, quality: event.target.valueAsNumber }))} />
          </label>
          <label className="col-span-2">Filename prefix
            <input className={field} maxLength={24} value={custom.prefix} onChange={(event) => setCustom((prior) => ({ ...prior, prefix: event.target.value }))} />
          </label>
          {customResult && 'error' in customResult
            ? <p role="alert" className="col-span-2 text-xs font-semibold text-orange-200">{customResult.error}</p>
            : <p className="col-span-2 text-zinc-400">Shape {shapeLabel(custom.width, custom.height)}. Photos are never enlarged beyond their own size.</p>}
        </div>
      )}
    </fieldset>
  );
  const optionsBlock = (
    <>
              <fieldset disabled={progress !== null} className="space-y-2">
                {anyBars && (
                  <label className="block text-sm">Borders
                    <select className={`${field} mt-1`} value={bars} onChange={(event) => setBars(event.target.value as BarStyle)}>
                      <option value="white">White</option>
                      <option value="black">Black</option>
                      <option value="blur">A blurred copy of the photo</option>
                    </select>
                  </label>
                )}
                <label className="block text-sm">Photo date
                  <select className={`${field} mt-1`} value={timestamp} onChange={(event) => setTimestamp(event.target.value as typeof timestamp)}>
                    <option value="now">Time of export</option>
                    <option value="capture">Recorded date, when available</option>
                    <option value="custom">Choose date and time…</option>
                  </select>
                </label>
                {timestamp === 'custom' && <input required type="datetime-local" aria-label="Custom photo date and time" className={field} value={customDate} onChange={(event) => setCustomDate(event.target.value)} />}
              </fieldset>
              {frames.some((frame) => !frame.isDemo && /\.(nef|nrw)$/i.test(frame.filename)) && (
                <p className="text-xs text-zinc-400">Nikon exports use the embedded JPEG as their source.</p>
              )}
              {selected.some((format) => format.format === 'jpeg') && (
                <details>
                  <summary className="min-h-11 cursor-pointer py-2 text-sm">Filename prefixes and JPEG quality</summary>
                  <fieldset disabled={progress !== null} className="space-y-3">
                    {selected.filter((format) => format.id !== 'custom').map((format) => (
                      <div key={format.id} className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 p-2">
                        <h4 className="col-span-full text-sm font-medium">{format.label}</h4>
                        <label className="text-xs">Filename prefix
                          <input value={format.prefix} maxLength={24} className={field} onChange={(event) => setOverrides((prior) => ({ ...prior, [format.id]: { ...prior[format.id], prefix: event.target.value } }))} />
                        </label>
                        {format.format === 'jpeg' && (
                          <label className="text-xs">JPEG quality
                            <input type="number" min={50} max={100} required className={field} value={format.quality ? Math.round(format.quality * 100) : ''}
                              onChange={(event) => setOverrides((prior) => ({ ...prior, [format.id]: { ...prior[format.id], quality: (event.target.valueAsNumber || 0) / 100 } }))} />
                          </label>
                        )}
                      </div>
                    ))}
                  </fieldset>
                </details>
              )}
    </>
  );

  const wizard = view === 'wizard' && !resultsReady;
  const changeView = (next: 'wizard' | 'list') => { setView(next); try { localStorage.setItem('kestrel.exportView', next); } catch { /* Optional preference. */ } };
  const blocked = Boolean(customOn && customResult && 'error' in customResult);
  const canShare = files.length > 0 && navigator.canShare?.({ files });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-3 max-md:p-0" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <section ref={dialog} className="workspace-popover flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-y-auto rounded-xl border border-white/15 bg-kestrel-raised p-4 shadow-xl max-md:h-dvh max-md:max-h-none max-md:rounded-none max-md:border-0">
        <header className="sticky top-0 z-10 -mx-4 -mt-4 mb-1 flex items-center justify-between gap-2 border-b border-white/10 bg-kestrel-raised px-2 py-1">
          <button type="button" onClick={onClose} aria-label="Close export" title="Close export" className={button}><X className="h-5 w-5" aria-hidden="true" /></button>
          <h2 id="export-title" ref={title} tabIndex={-1} className="min-w-0 flex-1 truncate text-center text-base font-semibold">Export {frames.length === 1 ? 'photo' : `${frames.length} photos`}</h2>
          {resultsReady || wizard ? <span className="w-11" /> : (
            <button type="submit" form="export-form" aria-label={progress !== null ? `Preparing ${progress} of ${total}` : `Prepare ${total} ${total === 1 ? 'file' : 'files'}`} disabled={!total || progress !== null || Boolean(customOn && customResult && 'error' in customResult)}
              className={`${button} bg-kestrel-copper font-semibold text-zinc-950 hover:bg-kestrel-copper-hover!`}>
              {progress !== null ? `${progress}/${total}…` : total > 1 ? `Prepare ${total}` : 'Prepare'}
            </button>
          )}
        </header>
        {!resultsReady && (
          <p className="mt-1 text-center">
            <button type="button" onClick={() => changeView(wizard ? 'list' : 'wizard')} className="min-h-10 px-3 text-xs text-zinc-300 underline underline-offset-4 hover:text-white">
              {wizard ? 'Show all formats at once' : 'Guide me step by step'}
            </button>
          </p>
        )}
        {resultsReady ? (
          <div className="space-y-3">
            <p role="status" className="text-sm text-zinc-300">{files.length} {files.length === 1 ? 'file ready' : 'files ready'}</p>
            <div className="flex flex-wrap gap-2">
              {files.length === 1 && <button type="button" className={`${button} bg-kestrel-copper text-zinc-950 hover:bg-kestrel-copper-hover!`}
                onClick={() => downloadExport(files[0], files[0].name)}>Download</button>}
              {files.length > 1 && <button type="button" disabled={archiving} className={`${button} bg-kestrel-copper text-zinc-950 hover:bg-kestrel-copper-hover!`}
                onClick={() => void downloadZip()}>{archiving ? 'Packing ZIP…' : 'Download ZIP'}</button>}
              {canShare && <button type="button" className={button} onClick={() => {
                void navigator.share({ files }).catch((reason) => {
                  if ((reason as Error).name !== 'AbortError') setError('Could not share these files. Try downloading them.');
                });
              }}>Share / save to device</button>}
              <button type="button" className={button} onClick={() => setFiles([])}>Change settings</button>
            </div>
            {files.length > 1 && files.length <= 12 && <details>
              <summary className="min-h-11 cursor-pointer py-2 text-sm">Download individual files</summary>
              {files.map((file, index) => <button type="button" className={`${button} block max-w-full truncate`}
                key={index} onClick={() => downloadExport(file, file.name)}>{file.name}</button>)}
            </details>}
          </div>
        ) : wizard ? (
          <>
            <ExportWizard frames={frames} sources={sources} chosen={chosen} onToggle={toggle} customOn={customOn} onCustomOn={setCustomOn} customSlot={customBlock}
              selected={selected} fits={fits} onFit={(id, fit) => setFits((prior) => ({ ...prior, [id]: fit }))} bars={bars} onBars={setBars}
              anchorFor={anchorFor} onAnchor={(frame, format, anchor) => setAnchors((prior) => ({ ...prior, [`${frame.id}|${format.id}`]: anchor }))}
              zoomFor={zoomFor} onZoom={(frame, format, zoom) => setZooms((prior) => ({ ...prior, [`${frame.id}|${format.id}`]: zoom }))}
              onTurn={(id) => setTurned((prior) => ({ ...prior, [id]: !prior[id] }))} reviewSlot={optionsBlock}
              busy={progress !== null} total={total} progress={progress} blocked={blocked} onPrepare={() => void prepare()} />
            {progress !== null && <progress aria-label="Export progress" className="mt-2 block w-full" value={progress} max={total} />}
          </>
        ) : (
          <form id="export-form" className="mt-2 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]" onSubmit={(event) => { event.preventDefault(); void prepare(); }}>
            <fieldset disabled={progress !== null} className="min-w-0 space-y-3">
              <legend className="mb-1 text-sm font-medium text-zinc-100">Choose formats</legend>
              {formatRow(formatById('master')!)}
              {PLATFORMS.map((platform) => {
                const formats = EXPORT_FORMATS.filter((format) => format.platform === platform.id);
                const count = formats.filter((format) => chosen.includes(format.id)).length;
                const open = openPlatforms[platform.id] ?? count > 0;
                return (
                  <details key={platform.id} open={open} className="rounded-md border border-white/10"
                    onToggle={(event) => { const now = event.currentTarget.open; if (now !== open) setOpenPlatforms((prior) => ({ ...prior, [platform.id]: now })); }}>
                    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-2 text-sm font-medium text-zinc-100 [&::-webkit-details-marker]:hidden">
                      <SocialIcon id={platform.id} className="h-4 w-4 text-zinc-200" />
                      <span className="flex-1">{platform.label}</span>
                      {count > 0 && <span className="rounded-full bg-sky-300/20 px-2 text-xs text-sky-100">{count} chosen</span>}
                      <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </summary>
                    <div className="space-y-1 p-1">{formats.map(formatRow)}</div>
                  </details>
                );
              })}
              {customBlock}
              <p className="text-xs text-zinc-400">Sizes are common starting points. Platforms change what they accept, so check a platform’s current advice before posting.</p>
            </fieldset>

            <div className="min-w-0 space-y-3">
              <section aria-label="Previews">
                <h3 className="mb-1 text-sm font-medium text-zinc-100">Preview</h3>
                {tiles.length === 0 ? <p className="text-sm text-zinc-400">Choose a format to see how your photo will look.</p> : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {tiles.map(({ frame, format }) => (
                      <ExportPreviewTile key={`${frame.id}|${format.id}`} frame={frame} source={sources[frame.id]} format={format} bars={bars}
                        anchor={anchorFor(frame, format)} onAnchor={(anchor) => setAnchors((prior) => ({ ...prior, [`${frame.id}|${format.id}`]: anchor }))}
                        zoom={zoomFor(frame, format)} onZoom={(zoom) => setZooms((prior) => ({ ...prior, [`${frame.id}|${format.id}`]: zoom }))}
                        platform={format.platform} onTurn={() => setTurned((prior) => ({ ...prior, [format.id]: !prior[format.id] }))} />
                    ))}
                  </div>
                )}
                {hiddenTiles > 0 && <p className="mt-1 text-xs text-zinc-400">Showing {tiles.length} previews. The other {hiddenTiles} {hiddenTiles === 1 ? 'file is' : 'files are'} made the same way.</p>}
              </section>
              {optionsBlock}
            </div>
            <div className="space-y-2 md:col-span-2">
              {progress !== null && <progress aria-label="Export progress" className="block w-full" value={progress} max={total} />}
            </div>
          </form>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-orange-200">{error}</p>}
      </section>
    </div>
  );
}
