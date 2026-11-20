import { EXPORT_PREFERENCES_KEY, EXPORT_PRESETS_KEY, readExportPreferences, readExportPresets, type ExportPreset } from '../core/exportPreferences';
import { isRawPreviewFile } from '../core/rawFormats';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import {
  EXPORT_FORMATS, LEGACY_FORMAT_IDS, PLATFORMS, customFormat, formatById, framingFor, toProfile, turnFormat,
  type BarStyle, type CustomSize, type ExportFormat, type Fit,
} from '../core/exportFormats';
import type { FocusPoint } from '../core/exportFraming';
import type { PhotoFrame } from '../core/types';
import { archiveExports, downloadExport, loadExportSource, renderExport } from '../providers/browserExport';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';
import { ExportPreviewTile } from './ExportPreviewTile';
import { ExportProofDock } from './ExportProofDock';
import { chooseProof, reconcileProofChoice, type ProofChoice } from '../core/exportProofSelection';
import { AdjustmentSlider } from './AdjustmentSlider';

/** Overlay and watermark sliders show their value as a whole percentage, never as an unexplained decimal. */
const percent = (value: number) => `${Math.round(value * 100)}%`;
import { ExportWizard } from './ExportWizard';
import { returnFocus } from './focusReturn';
import { KEEP_NAMES, stemFor, uniqueExportFilename, type NameTemplate } from '../core/exportNaming';
import { tasks } from '../core/taskStore';
import { useAccess } from '../providers/useAccess';
import { FREE_DAILY_EXPORT_LIMIT } from '../core/features';
import { parseUsage, recordUse, remainingToday } from '../core/dailyAllowance';
import { parseCustomExportDate } from '../core/exportDateInput';
import { exportMayContinue } from '../core/exportCancellation';
import { parseWatermark } from '../core/watermarkStore';
import { hasWatermark, NO_WATERMARK, WATERMARK_POSITIONS, WATERMARK_FONTS, type WatermarkOptions } from '../core/watermark';
import { NO_OVERLAY, overlayLines, type OverlayOptions } from '../core/exportOverlay';
import { exportFilename } from '../core/exportProfiles';
import { SocialIcon } from './SocialIcon';
import type { ExportPlace } from '../providers/exportToPlace';
import { isDesktopApp, saveWithDialog } from '../providers/desktopShell';
import { exportText as t } from '../i18n/areas/export';
import { formatLabel, shapeName, sizeName, watermarkPositionLabel } from '../i18n/areas/export/labels';

interface Props {
  frames: PhotoFrame[];
  provider: BrowserPreviewProvider;
  source?: HTMLImageElement | null;
  onClose: () => void;
  /** Called after a desktop save succeeds or a browser download is requested. */
  onDownloadRequested?: (frames: readonly PhotoFrame[]) => void;
  /** A place the person chose for this project's exports (for example the drive the originals are on). */
  exportPlace?: ExportPlace | null;
}

const button = 'min-h-11 rounded-md px-3 text-sm font-medium hover:bg-white/10 disabled:opacity-45 aria-disabled:opacity-45';
const field = 'min-h-10 w-full rounded-md border border-white/15 bg-[#15171C] px-2 text-base sm:text-sm';
const STORAGE_KEY = 'kestrel.lastExport.v2';
/** Photos drawn in the preview, and the most tiles shown at once, so a big selection stays quick. */
const PREVIEW_PHOTOS = 4;
const MAX_TILES = 12;

const FIT_LABELS: Record<Fit, string> = t.fit;
const DEFAULT_CUSTOM: CustomSize = { width: 1600, height: 1200, fit: 'keep', format: 'jpeg', quality: 90, prefix: 'custom_' };

function readView(): 'wizard' | 'list' {
  try { return localStorage.getItem('kestrel.exportView') === 'list' ? 'list' : 'wizard'; } catch { return 'wizard'; }
}

function loadChosen(freshStart = false): string[] {
  // The step-by-step guide starts with nothing chosen. Earlier choices are still remembered for the list.
  if (freshStart) return [];
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

export function PhotoExportPanel({ frames, provider, source, onClose, onDownloadRequested, exportPlace }: Props) {
  const [placeNote, setPlaceNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [chosen, setChosen] = useState<string[]>(() => loadChosen(readView() === 'wizard'));
  const [preferences] = useState(() => readExportPreferences({ getItem: (key) => localStorage.getItem(key) }));
  const [presets, setPresets] = useState(() => readExportPresets({ getItem: (key) => localStorage.getItem(key) }));
  const [presetName, setPresetName] = useState('');
  const [presetNote, setPresetNote] = useState('');
  const [fits, setFits] = useState(preferences.fits);
  const [overrides, setOverrides] = useState(preferences.overrides);
  const [turned, setTurned] = useState(preferences.turned);
  const [view, setView] = useState<'wizard' | 'list'>(readView);
  const [openPlatforms, setOpenPlatforms] = useState<Record<string, boolean>>({});
  const [bars, setBars] = useState<BarStyle>(preferences.bars);
  const [customOn, setCustomOn] = useState(false);
  const [custom, setCustom] = useState<CustomSize>(DEFAULT_CUSTOM);
  const [anchors, setAnchors] = useState<Record<string, FocusPoint>>({});
  const [zooms, setZooms] = useState<Record<string, number>>({});
  const [naming, setNaming] = useState<NameTemplate>(KEEP_NAMES);
  const [overlay, setOverlay] = useState<OverlayOptions>(() => {
    try { return { ...NO_OVERLAY, watermark: parseWatermark(localStorage.getItem('kestrel.watermark.v1')) }; } catch { return NO_OVERLAY; }
  });
  const [markNote, setMarkNote] = useState<string | null>(null);
  const [sources, setSources] = useState<Record<string, HTMLImageElement>>({});
  const [proofChoice, setProofChoice] = useState<ProofChoice | null>(null);
  const [proofLoadFailed, setProofLoadFailed] = useState<string | null>(null);
  const [proofRetry, setProofRetry] = useState(0);
  const [timestamp, setTimestamp] = useState<'now' | 'capture' | 'custom'>('now');
  const [customDate, setCustomDate] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  // The ZIP is packed as soon as the files are ready, so Download is an immediate tap. A download started after waiting
  // is ignored by iPhone Safari, which only allows it straight from a tap.
  const [zip, setZip] = useState<Blob | null>(null);
  const packing = useRef<File[] | null>(null);
  const desktop = isDesktopApp();
  const [saving, setSaving] = useState(false);
  const saveRunning = useRef(false);
  const [savedName, setSavedName] = useState<string | null>(null);
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
  const proofPhotoIds = frames.map(frame => frame.id);
  const proofFormatIds = selected.map(format => format.id);
  const activeProof = reconcileProofChoice(proofChoice, proofPhotoIds, proofFormatIds);
  const chooseProofPhoto = (photoId: string) => setProofChoice(previous => chooseProof(previous, { photoId }, proofPhotoIds, proofFormatIds));
  const chooseProofFormat = (destinationId: string) => setProofChoice(previous => chooseProof(previous, { destinationId }, proofPhotoIds, proofFormatIds));
  const resultsReady = files.length > 0;
  const zoomFor = (frame: PhotoFrame, format: ExportFormat) => zooms[`${frame.id}|${format.id}`] ?? 1;
  const anchorFor = (frame: PhotoFrame, format: ExportFormat): FocusPoint => anchors[`${frame.id}|${format.id}`] ?? frame.focusPoint ?? { x: 0.5, y: 0.5 };

  async function deliver(file: Blob, name: string, exported: readonly PhotoFrame[]) {
    if (saveRunning.current) return;
    setError('');
    if (!desktop) {
      downloadExport(file, name);
      onDownloadRequested?.(exported);
      return;
    }

    saveRunning.current = true;
    setSaving(true);
    setSavedName(null);
    try {
      if (await saveWithDialog(file, name)) {
        setSavedName(name);
        onDownloadRequested?.(exported);
      }
    } catch {
      setError(t.panel.saveFailed);
    } finally {
      saveRunning.current = false;
      setSaving(false);
    }
  }

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      activeExport.current?.abort();
      returnFocus(previous);
    };
  }, []);

  useEffect(() => {
    // Focus the title for screen readers without scrolling: the header sits above the scroll area, so scrolling would push the content under it.
    title.current?.focus({ preventScroll: true });
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

  // The fixed proof can inspect ANY selected photo, not just the first four gallery thumbnails.
  // Only load the current proof photo; switching selection invalidates stale async completions.
  const proofFrame = frames.find(frame => frame.id === activeProof?.photoId);
  const proofSource = proofFrame && sources[proofFrame.id];
  useEffect(() => {
    if (!proofFrame || proofSource) return;
    let active = true;
    setProofLoadFailed(null);
    (async () => {
      try {
        const image = source && frames.length === 1 ? source : await loadExportSource(proofFrame, provider);
        if (active) setSources(prior => ({ ...prior, [proofFrame.id]: image }));
      } catch {
        if (active) setProofLoadFailed(proofFrame.id);
      }
    })();
    return () => { active = false; };
    // A retry explicitly re-attempts a failed source; other photo choices cancel stale loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proofFrame, proofSource, provider, source, frames.length, proofRetry]);

  useEffect(() => {
    function close(event: KeyboardEvent) {
      if (event.key === 'Tab') {
        const stops = [...(dialog.current?.querySelectorAll<HTMLElement>('button, input, select, summary, [tabindex="0"]') ?? [])]
          .filter((item) => !item.matches(':disabled') && item.getClientRects().length > 0);
        const boundary = event.shiftKey ? stops[0] : stops.at(-1);
        const focused = document.activeElement;
        if (stops.length && (focused === title.current || !dialog.current?.contains(focused) || focused === boundary)) {
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

  const { can } = useAccess();
  const unlimited = can('unlimitedExport');
  const USAGE_KEY = 'kestrel.exportsToday.v1';
  const readUsage = () => { try { return parseUsage(localStorage.getItem(USAGE_KEY)); } catch { return null; } };

  async function prepare() {
    if (timestamp === 'custom' && !parseCustomExportDate(customDate)) {
      setError(t.panel.invalidDate);
      return;
    }
    if (!unlimited) {
      const wanted = frames.length * selected.length;
      const left = remainingToday(readUsage(), new Date(), FREE_DAILY_EXPORT_LIMIT);
      if (wanted > left) {
        setError(left === 0
          ? t.panel.limitUsed(FREE_DAILY_EXPORT_LIMIT)
          : t.panel.limitLeft(FREE_DAILY_EXPORT_LIMIT, left));
        return;
      }
    }
    if (customOn && customResult && 'error' in customResult) {
      setError(customResult.error);
      return;
    }
    setProgress(0);
    setError('');
    const controller = new AbortController();
    activeExport.current = controller;
    const task = tasks.start(t.panel.exporting(frames.length * selected.length), { total: frames.length * selected.length, cancel: () => controller.abort() });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(chosen)); } catch { /* Optional preference. */ }
    const started = new Date();
    const pickedDate = timestamp === 'custom' ? parseCustomExportDate(customDate) : null;
    const output: File[] = [];
    const usedExportNames = new Set<string>();
    try {
      for (const [frameIndex, frame] of frames.entries()) {
        if (!exportMayContinue(controller.signal.aborted, task.cancelled, cancelled.current)) return;
        const stem = stemFor(naming, frame.filename, frameIndex, frames.length);
        const image = source && frames.length === 1 ? source : await loadExportSource(frame, provider);
        const recorded = frame.exif.capturedAtMs ?? provider.originalInfo(frame.stableKey)?.lastModified;
        const date = pickedDate ?? (timestamp === 'capture' && Number.isFinite(recorded) ? new Date(recorded!) : started);
        if (!exportMayContinue(controller.signal.aborted, task.cancelled, cancelled.current)) return;
        for (const format of selected) {
          if (!exportMayContinue(controller.signal.aborted, task.cancelled, cancelled.current)) return;
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          if (!exportMayContinue(controller.signal.aborted, task.cancelled, cancelled.current)) return;
          const rendered = await renderExport(image, frame, toProfile(format), date, controller.signal, framingFor(format.fit), undefined, {
            focus: anchorFor(frame, format), bars, zoom: zoomFor(frame, format), stem, overlay,
          });
          if (!exportMayContinue(controller.signal.aborted, task.cancelled, cancelled.current)) return;
          const uniqueName = uniqueExportFilename(rendered.name, usedExportNames);
          output.push(uniqueName === rendered.name
            ? rendered
            : new File([rendered], uniqueName, { type: rendered.type, lastModified: rendered.lastModified }));
          setProgress(output.length);
          task.progress(output.length);
        }
      }
      // Stop must never publish partial results or charge the Free allowance.
      if (!exportMayContinue(controller.signal.aborted, task.cancelled, cancelled.current)) return;
      if (!unlimited && output.length) { try { localStorage.setItem(USAGE_KEY, JSON.stringify(recordUse(readUsage(), new Date(), output.length))); } catch { /* the count is best effort */ } }
      try {
        localStorage.setItem(EXPORT_PREFERENCES_KEY, JSON.stringify({ fits, overrides, turned, bars }));
      } catch { /* Export remains usable when storage is unavailable. */ }
      task.finish();
      setFiles(output);
      setZip(null);
      if (output.length > 1) {
        packing.current = output;
        const isCurrent = () => !cancelled.current && packing.current === output;
        archiveExports(output).then(
          (packed) => { if (isCurrent()) setZip(packed); },
          () => { if (isCurrent()) setError(t.panel.zipFailed); },
        );
      }
    } catch (reason) {
      if (!controller.signal.aborted && !task.cancelled && !cancelled.current) { const message = reason instanceof Error ? reason.message : t.panel.prepareFailed; setError(message); task.fail(message); }
    } finally {
      task.fail(t.panel.stopped); // does nothing if the task already finished or was cancelled
      activeExport.current = null;
      if (!cancelled.current) setProgress(null);
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
            <span className="block">{formatLabel(shownFormat)}</span>
            <span className="block text-xs text-zinc-400">{sizeName(shownFormat)}</span>
          </span>
        </label>
        {on && format.id !== 'master' && (
          <label className="block px-2 pb-2 text-xs text-zinc-300">
            <span className="sr-only">{t.list.howItFits(formatLabel(format))}</span>
            <select className={field} value={current} aria-label={t.list.howItFits(formatLabel(format))}
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
        <input type="checkbox" checked={customOn} onChange={(event) => setCustomOn(event.target.checked)} />{t.formats.customSize}
      </label>
      {customOn && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {(['width', 'height'] as const).map((axis) => (
            <label key={axis}>{axis === 'width' ? t.custom.width : t.custom.height}
              <input className={field} type="number" min={1} max={12000} value={Number.isFinite(custom[axis]) ? custom[axis] : ''}
                onChange={(event) => setCustom((prior) => ({ ...prior, [axis]: event.target.valueAsNumber }))} />
            </label>
          ))}
          <label className="col-span-2">{t.custom.fit}
            <select className={field} value={custom.fit} onChange={(event) => setCustom((prior) => ({ ...prior, fit: event.target.value as Fit }))}>
              {(Object.keys(FIT_LABELS) as Fit[]).map((fit) => <option key={fit} value={fit}>{FIT_LABELS[fit]}</option>)}
            </select>
          </label>
          <label>{t.custom.fileType}
            <select className={field} value={custom.format} onChange={(event) => setCustom((prior) => ({ ...prior, format: event.target.value as 'jpeg' | 'png' }))}>
              <option value="jpeg">{t.custom.jpeg}</option>
              <option value="png">{t.custom.pngLossless}</option>
            </select>
          </label>
          <label>{t.custom.jpegQuality}
            <input className={field} type="number" min={50} max={100} disabled={custom.format === 'png'} value={Number.isFinite(custom.quality) ? custom.quality : ''}
              onChange={(event) => setCustom((prior) => ({ ...prior, quality: event.target.valueAsNumber }))} />
          </label>
          <label className="col-span-2">{t.custom.filenamePrefix}
            <input className={field} maxLength={24} value={custom.prefix} onChange={(event) => setCustom((prior) => ({ ...prior, prefix: event.target.value }))} />
          </label>
          {customResult && 'error' in customResult
            ? <p role="alert" className="col-span-2 text-xs font-semibold text-orange-200">{customResult.error}</p>
            : <p className="col-span-2 text-zinc-400">{t.custom.shapeNote(shapeName(custom.width, custom.height))}</p>}
        </div>
      )}
    </fieldset>
  );
  const firstFormat = selected.find((format) => format.id !== 'custom') ?? selected[0];
  const exampleName = frames[0] && firstFormat
    ? exportFilename((() => { const stem = stemFor(naming, frames[0].filename, 0, frames.length); return stem ? `${stem}.${firstFormat.format}` : frames[0].filename; })(), toProfile(firstFormat), false) : '';
  const check = 'flex min-h-10 items-center gap-2 text-sm';
  const namingBlock = (
    <fieldset className="space-y-2 rounded-lg border border-white/10 p-3">
      <legend className="px-1 text-sm font-medium text-zinc-100">{t.naming.legend}</legend>
      <label className={check}><input type="radio" name="naming" checked={!naming.name} onChange={() => setNaming(KEEP_NAMES)} />{t.naming.keepNames}</label>
      <label className={check}><input type="radio" name="naming" checked={Boolean(naming.name)} onChange={() => setNaming((prior) => ({ ...prior, name: prior.name || t.naming.defaultName }))} />{t.naming.ownName}</label>
      {naming.name && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs">{t.naming.name}
            <input className={field} maxLength={60} value={naming.name} onChange={(event) => setNaming((prior) => ({ ...prior, name: event.target.value }))} />
          </label>
          <label className="text-xs">{t.naming.number}
            <select className={field} value={naming.numbers} onChange={(event) => setNaming((prior) => ({ ...prior, numbers: event.target.value as NameTemplate['numbers'] }))}>
              <option value="original">{t.naming.fromOriginal}</option>
              <option value="sequence">{t.naming.counting}</option>
            </select>
          </label>
        </div>
      )}
      {exampleName && <p className="text-xs text-zinc-400">{t.naming.example} <span className="text-zinc-200">{exampleName}</span></p>}
    </fieldset>
  );
  const textOverlayBlock = (
    <fieldset className="space-y-2 rounded-lg border border-white/10 p-3">
      <legend className="px-1 text-sm font-medium text-zinc-100">{t.overlay.legend}</legend>
      <label className={check}><input type="checkbox" checked={overlay.on} onChange={(event) => setOverlay((prior) => ({ ...prior, on: event.target.checked }))} />{t.overlay.show}</label>
      {overlay.on && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs">{t.overlay.title}
              <input className={field} maxLength={100} value={overlay.title ?? ''} onChange={(event) => setOverlay((prior) => ({ ...prior, title: event.target.value }))} />
            </label>
            <label className="text-xs">{t.overlay.location}
              <input className={field} maxLength={100} value={overlay.location ?? ''} onChange={(event) => setOverlay((prior) => ({ ...prior, location: event.target.value }))} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-x-3">
            {([['camera', t.overlay.camera], ['lens', t.overlay.lens], ['settings', t.overlay.settings], ['date', t.overlay.date]] as const).map(([key, label]) => (
              <label key={key} className={check}><input type="checkbox" checked={overlay[key]} onChange={(event) => setOverlay((prior) => ({ ...prior, [key]: event.target.checked }))} />{label}</label>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs">{t.overlay.where}
              <select className={field} value={overlay.place} onChange={(event) => setOverlay((prior) => ({ ...prior, place: event.target.value as OverlayOptions['place'] }))}>
                <option value="bottom">{t.overlay.bottom}</option><option value="top">{t.overlay.top}</option>
              </select>
            </label>
            <label className="text-xs">{t.overlay.text}
              <select className={field} value={overlay.tone} onChange={(event) => setOverlay((prior) => ({ ...prior, tone: event.target.value as OverlayOptions['tone'] }))}>
                <option value="light">{t.overlay.light}</option><option value="dark">{t.overlay.dark}</option>
              </select>
            </label>
          </div>
          <label className="block text-xs">{t.overlay.alignment}
            <select className={field} value={overlay.align ?? 'left'} onChange={(event) => setOverlay((prior) => ({ ...prior, align: event.target.value as OverlayOptions['align'] }))}>
              <option value="left">{t.overlay.left}</option><option value="centre">{t.overlay.centre}</option><option value="right">{t.overlay.right}</option>
            </select>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <AdjustmentSlider label={t.overlay.textSize} ariaLabel={t.overlay.textSize} min={0.75} max={1.75} step={0.05} neutral={1}
              value={overlay.scale ?? 1} formatValue={percent}
              onChange={(value) => setOverlay((prior) => ({ ...prior, scale: value }))} />
            <AdjustmentSlider label={t.overlay.shade} ariaLabel={t.overlay.shade} min={0} max={1} step={0.05} neutral={0.62}
              value={overlay.shade ?? 0.62} formatValue={percent}
              onChange={(value) => setOverlay((prior) => ({ ...prior, shade: value }))} />
          </div>
          {frames.every((frame) => overlayLines(frame.exif, overlay).length === 0) && (
            <p role="status" className="text-xs text-zinc-400">{t.overlay.noDetails}</p>
          )}
        </>
      )}
    </fieldset>
  );
  const mark = overlay.watermark ?? NO_WATERMARK;
  useEffect(() => {
    // The watermark is remembered for next time. A picture too big for storage is simply not remembered.
    try { localStorage.setItem('kestrel.watermark.v1', JSON.stringify(mark)); } catch { /* storage full or blocked */ }
  }, [mark]);
  const setMark = (change: Partial<WatermarkOptions>) => setOverlay((prior) => ({ ...prior, watermark: { ...(prior.watermark ?? NO_WATERMARK), ...change } }));
  function chooseMarkPicture(file: File | undefined) {
    if (!file) return;
    // Embedded SVG and arbitrary image MIME types are not safe portable watermark assets.
    // Use decoded raster formats only until the private local asset vault is implemented.
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 3_000_000) {
      setMarkNote(t.watermark.pictureTooBig); return;
    }
    const reader = new FileReader();
    reader.onload = () => { setMarkNote(null); setMark({ kind: 'image', imageData: String(reader.result), on: true }); };
    reader.readAsDataURL(file);
  }
  const watermarkBlock = (
    <fieldset className="space-y-2 rounded-lg border border-white/10 p-3">
      <legend className="px-1 text-sm font-medium text-zinc-100">{t.watermark.legend}</legend>
      <label className={check}><input type="checkbox" checked={mark.on} onChange={(event) => setMark({ on: event.target.checked })} />{t.watermark.add}</label>
      {mark.on && (
        <div className="space-y-2">
          <label className="block text-sm text-zinc-300">{t.watermark.type}
            <select className={field} value={mark.kind} onChange={(event) => setMark({ kind: event.target.value as WatermarkOptions['kind'] })}>
              <option value="text">{t.watermark.text}</option><option value="image">{t.watermark.picture}</option>
            </select>
          </label>
          {mark.kind === 'text' ? (
            <label className="block text-sm text-zinc-300">{t.watermark.text}
              <input className={field} maxLength={80} placeholder={t.watermark.placeholder} value={mark.text} onChange={(event) => setMark({ text: event.target.value })} />
            </label>
          ) : (
            <label className="block text-sm text-zinc-300">{t.watermark.picture}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="block min-h-11 w-full py-2 text-sm" onChange={(event) => chooseMarkPicture(event.target.files?.[0])} />
              {mark.imageData && <span className="text-xs text-zinc-400">{t.watermark.pictureChosen}</span>}
            </label>
          )}
          {markNote && <p role="status" className="text-xs text-amber-200">{markNote}</p>}
          <label className="block text-sm text-zinc-300">{t.watermark.position}
            <select className={field} value={mark.position} onChange={(event) => setMark({ position: event.target.value as WatermarkOptions['position'] })}>
              {WATERMARK_POSITIONS.map((item) => <option key={item.id} value={item.id}>{watermarkPositionLabel(item.id)}</option>)}
            </select>
          </label>
          {mark.kind === 'text' && (
            <label className="block text-sm text-zinc-300">Watermark font
              <select className={field} value={mark.font ?? 'inter'} onChange={(event) => setMark({ font: event.target.value as WatermarkOptions['font'] })}>
                {WATERMARK_FONTS.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
              </select>
            </label>
          )}
          {mark.kind === 'text' && (
            <label className="block text-sm text-zinc-300">{t.watermark.colour}
              <select className={field} value={mark.tone} onChange={(event) => setMark({ tone: event.target.value as WatermarkOptions['tone'] })}>
                <option value="auto">Automatic · best contrast</option>
                <option value="light">{t.watermark.white}</option><option value="dark">{t.watermark.black}</option>
              </select>
            </label>
          )}
          <AdjustmentSlider label={t.watermark.size} ariaLabel={t.watermark.size} min={0.03} max={mark.kind === 'image' ? 0.5 : 0.2} step={0.01}
            neutral={NO_WATERMARK.size} value={mark.size} formatValue={percent} onChange={(value) => setMark({ size: value })} />
          <AdjustmentSlider label={t.watermark.strength} ariaLabel={t.watermark.strength} min={0.15} max={1} step={0.05}
            neutral={NO_WATERMARK.opacity} value={mark.opacity} formatValue={percent} onChange={(value) => setMark({ opacity: value })} />
          {!hasWatermark(mark) && <p role="status" className="text-xs text-zinc-400">{mark.kind === 'text' ? t.watermark.typeText : t.watermark.choosePicture}</p>}
        </div>
      )}
    </fieldset>
  );
  const overlayBlock = <>{textOverlayBlock}{watermarkBlock}</>;
  const wizard = view === 'wizard' && !resultsReady;
  const optionsBlock = (
    <>
      {namingBlock}
      {!wizard && overlayBlock}
              <fieldset disabled={progress !== null} className="space-y-2">
                {anyBars && (
                  <label className="block text-sm">{t.borders.label}
                    <select className={`${field} mt-1`} value={bars} onChange={(event) => setBars(event.target.value as BarStyle)}>
                      <option value="white">{t.borders.white}</option>
                      <option value="black">{t.borders.black}</option>
                      <option value="blur">{t.borders.blur}</option>
                    </select>
                  </label>
                )}
                <label className="block text-sm">{t.options.photoDate}
                  <select className={`${field} mt-1`} value={timestamp} onChange={(event) => setTimestamp(event.target.value as typeof timestamp)}>
                    <option value="now">{t.options.timeOfExport}</option>
                    <option value="capture">{t.options.recordedDate}</option>
                    <option value="custom">{t.options.chooseDate}</option>
                  </select>
                </label>
                {timestamp === 'custom' && (
                  <div className="space-y-1">
                    <input required type="datetime-local" aria-label={t.options.customDate} aria-describedby="export-date-hint"
                      className={field} value={customDate} onChange={(event) => setCustomDate(event.target.value)} />
                    {!parseCustomExportDate(customDate) && <p id="export-date-hint" className="text-xs text-orange-200">{t.options.dateHint}</p>}
                  </div>
                )}
              </fieldset>
              {selected.some((format) => format.format === 'jpeg') && (
                <details>
                  <summary className="min-h-11 cursor-pointer py-2 text-sm">{t.options.prefixesAndQuality}</summary>
                  <fieldset disabled={progress !== null} className="space-y-3">
                    {selected.filter((format) => format.id !== 'custom').map((format) => (
                      <div key={format.id} className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 p-2">
                        <h4 className="col-span-full text-sm font-medium">{formatLabel(format)}</h4>
                        <label className="text-xs">{t.custom.filenamePrefix}
                          <input value={format.prefix} maxLength={24} className={field} onChange={(event) => setOverrides((prior) => ({ ...prior, [format.id]: { ...prior[format.id], prefix: event.target.value } }))} />
                        </label>
                        {format.format === 'jpeg' && (
                          <label className="text-xs">{t.custom.jpegQuality}
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

  function savePresets(next: ExportPreset[], success: string) {
    try {
      localStorage.setItem(EXPORT_PRESETS_KEY, JSON.stringify(next));
      setPresets(next);
      setPresetNote(success);
    } catch {
      setPresetNote('Could not save export presets on this device.');
    }
  }

  const changeView = (next: 'wizard' | 'list') => { setView(next); try { localStorage.setItem('kestrel.exportView', next); } catch { /* Optional preference. */ } };
  const invalidDate = timestamp === 'custom' && !parseCustomExportDate(customDate);
  const blocked = Boolean(customOn && customResult && 'error' in customResult) || invalidDate;
  const canShare = files.length > 0 && navigator.canShare?.({ files });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-3 max-md:p-0" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <section ref={dialog} className={`workspace-popover flex max-h-[92dvh] w-full ${resultsReady ? 'max-w-xl' : 'max-w-4xl'} flex-col overflow-hidden rounded-xl border border-white/15 bg-kestrel-raised shadow-xl max-md:h-full max-md:max-h-none max-md:rounded-none max-md:border-0`}>
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-kestrel-raised px-2 py-1">
          <button type="button" onClick={onClose} aria-label={t.panel.close} title={t.panel.close} className={button}><X className="h-5 w-5" aria-hidden="true" /></button>
          <h2 id="export-title" ref={title} tabIndex={-1} className="min-w-0 flex-1 truncate text-center text-base font-semibold">{t.panel.title(frames.length)}</h2>
          {resultsReady || wizard ? <span className="w-11" /> : (
            <button type="submit" form="export-form" aria-label={progress !== null ? t.panel.preparingOf(progress, total) : t.prepare.files(total)} disabled={!total || progress !== null || blocked}
              className={`${button} bg-kestrel-copper font-semibold text-zinc-950 hover:bg-kestrel-copper-hover!`}>
              {progress !== null ? `${progress}/${total}…` : total > 1 ? t.panel.prepareCount(total) : t.panel.prepare}
            </button>
          )}
        </header>
        {!resultsReady && <ExportProofDock frames={frames} formats={selected} sources={sources} choice={activeProof}
          failedPhotoId={proofLoadFailed} onRetry={() => setProofRetry(value => value + 1)}
          onChoosePhoto={chooseProofPhoto} onChooseDestination={chooseProofFormat} bars={bars} overlay={overlay}
          anchorFor={anchorFor} zoomFor={zoomFor}
          onAnchor={(frame, format, point) => setAnchors(prior => ({ ...prior, [`${frame.id}|${format.id}`]: point }))}
          onZoom={(frame, format, zoom) => setZooms(prior => ({ ...prior, [`${frame.id}|${format.id}`]: zoom }))} />}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        {!resultsReady && progress === null && (
          <details className="mb-2 rounded-md border border-white/15 px-3 py-2">
            <summary className="cursor-pointer py-2 text-sm">Export presets</summary>
            <ul className="space-y-2">
              {presets.map(preset => (
                <li key={preset.name} className="flex flex-wrap items-center gap-2">
                  <button type="button" className={button} onClick={() => {
                    setChosen(preset.formats);
                    setFits(preset.fits);
                    setOverrides(preset.overrides);
                    setTurned(preset.turned);
                    setBars(preset.bars);
                    setCustomOn(false);
                    setPresetNote(`Applied ${preset.name}.`);
                  }}>{preset.name}</button>
                  <button type="button" className={button} aria-label={`Remove preset ${preset.name}`}
                    onClick={() => savePresets(presets.filter(item => item !== preset), 'Preset removed.')}>
                    {t.wizard.remove}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="text-sm">Preset name
                <input className={field} maxLength={40} value={presetName} onChange={event => setPresetName(event.target.value)} />
              </label>
              <button type="button" className={button} disabled={!chosen.length || customOn || !presetName.trim() || presets.length >= 20}
                onClick={() => {
                  const name = presetName.trim();
                  if (presets.some(item => item.name.toLowerCase() === name.toLowerCase())) {
                    setPresetNote('Use a different name for this preset.');
                    return;
                  }
                  savePresets([...presets, { name, formats: chosen, fits, overrides, turned, bars }], 'Preset saved.');
                }}>Save preset</button>
            </div>
            {customOn && <p className="text-xs text-zinc-400">Presets save standard formats.</p>}
            <p role="status" className="text-xs text-zinc-300">{presetNote}</p>
          </details>
        )}
        {!resultsReady && (
          <p className="mt-1 text-center">
            <button type="button" onClick={() => changeView(wizard ? 'list' : 'wizard')} className="min-h-10 px-3 text-xs text-zinc-300 underline underline-offset-4 hover:text-white">
              {wizard ? t.panel.showAll : t.panel.guideMe}
            </button>
          </p>
        )}
        {!resultsReady && frames.some((frame) => !frame.isDemo && isRawPreviewFile(frame.filename) && provider.isDeveloped(frame.stableKey)) && (
          <p className="mb-2 text-center text-xs text-zinc-300">{t.panel.rawDeveloped}</p>
        )}
        {!resultsReady && frames.some((frame) => !frame.isDemo && isRawPreviewFile(frame.filename) && !provider.isDeveloped(frame.stableKey)) && (
          <p className="mb-2 text-center text-xs text-zinc-300">{t.panel.rawPreview}</p>
        )}
        {resultsReady ? (
          <div className="space-y-3">
            <p role="status" className="text-sm text-zinc-300">
              {saving ? t.results.saving : savedName ? t.results.saved(savedName) : t.results.ready(files.length)}
            </p>
            <div className="flex flex-wrap gap-2">
              {files.length === 1 && <button type="button" className={`${button} bg-kestrel-copper text-zinc-950 hover:bg-kestrel-copper-hover!`}
                aria-disabled={saving} onClick={() => void deliver(files[0], files[0].name, frames.slice(0, 1))}>{desktop ? t.results.save : t.results.download}</button>}
              {files.length > 1 && <button type="button" disabled={!zip} aria-disabled={saving || !zip} className={`${button} bg-kestrel-copper text-zinc-950 hover:bg-kestrel-copper-hover!`}
                onClick={() => { if (zip) void deliver(zip, 'kestrel-exports.zip', frames); }}>{zip ? (desktop ? t.results.saveZip : t.results.downloadZip) : t.results.packingZip}</button>}
              {exportPlace && <button type="button" className={button} disabled={placeBusy} onClick={async () => {
                setPlaceBusy(true); setPlaceNote(null);
                const result = await exportPlace.save(files);
                setPlaceNote(result.ok ? { ok: true, text: t.results.savedToPlace(result.count, exportPlace.label) } : { ok: false, text: result.message });
                setPlaceBusy(false);
              }}>{placeBusy ? t.results.saving : t.results.alsoSave(exportPlace.label)}</button>}
              {canShare && <button type="button" className={button} onClick={() => {
                void navigator.share({ files }).catch((reason) => {
                  if ((reason as Error).name !== 'AbortError') setError(t.results.shareFailed);
                });
              }}>{t.results.share}</button>}
              <button type="button" className={button} disabled={saving} onClick={() => {
                packing.current = null;
                setFiles([]);
                setZip(null);
                setError('');
                setSavedName(null);
              }}>{t.results.changeSettings}</button>
            </div>
            {placeNote && <p role={placeNote.ok ? 'status' : 'alert'} className={`text-sm ${placeNote.ok ? 'text-emerald-200' : 'text-amber-200'}`}>{placeNote.text}</p>}
            {files.length > 1 && files.length <= 12 && <details>
              <summary className="min-h-11 cursor-pointer py-2 text-sm">{desktop ? t.results.saveEach : t.results.downloadEach}</summary>
              {files.map((file, index) => <button type="button" className={`${button} block max-w-full truncate`}
                key={index} aria-disabled={saving} onClick={() => {
                  const frame = frames[Math.floor(index / selected.length)];
                  void deliver(file, file.name, frame ? [frame] : []);
                }}>{file.name}</button>)}
            </details>}
          </div>
        ) : wizard ? (
          <>
            <ExportWizard frames={frames} sources={sources} chosen={chosen} onToggle={toggle} customOn={customOn} onCustomOn={setCustomOn} customSlot={customBlock}
              selected={selected} fits={fits} onFit={(id, fit) => setFits((prior) => ({ ...prior, [id]: fit }))} bars={bars} onBars={setBars}
              anchorFor={anchorFor} onAnchor={(frame, format, anchor) => setAnchors((prior) => ({ ...prior, [`${frame.id}|${format.id}`]: anchor }))}
              zoomFor={zoomFor} onZoom={(frame, format, zoom) => setZooms((prior) => ({ ...prior, [`${frame.id}|${format.id}`]: zoom }))}
              onTurn={(id) => setTurned((prior) => ({ ...prior, [id]: !prior[id] }))} overlay={overlay} overlaySlot={overlayBlock} reviewSlot={optionsBlock}
              busy={progress !== null} total={total} progress={progress} blocked={blocked} onPrepare={() => void prepare()} />
            {progress !== null && <progress aria-label={t.panel.progress} className="mt-2 block w-full" value={progress} max={total} />}
          </>
        ) : (
          <form id="export-form" className="mt-2 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]" onSubmit={(event) => { event.preventDefault(); void prepare(); }}>
            <fieldset disabled={progress !== null} className="min-w-0 space-y-3">
              <legend className="mb-1 text-sm font-medium text-zinc-100">{t.list.chooseFormats}</legend>
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
                      {count > 0 && <span className="rounded-full bg-sky-300/20 px-2 text-xs text-sky-100">{t.list.chosen(count)}</span>}
                      <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </summary>
                    <div className="space-y-1 p-1">{formats.map(formatRow)}</div>
                  </details>
                );
              })}
              {customBlock}
              <p className="text-xs text-zinc-400">{t.list.sizesNote}</p>
            </fieldset>

            <div className="min-w-0 space-y-3">
              <section aria-label={t.list.previews}>
                <h3 className="mb-1 text-sm font-medium text-zinc-100">{t.list.preview}</h3>
                {tiles.length === 0 ? <p className="text-sm text-zinc-400">{t.list.choosePreview}</p> : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {tiles.map(({ frame, format }) => (
                      <ExportPreviewTile key={`${frame.id}|${format.id}`} frame={frame} source={sources[frame.id]} format={format} bars={bars}
                        anchor={anchorFor(frame, format)} onAnchor={(anchor) => setAnchors((prior) => ({ ...prior, [`${frame.id}|${format.id}`]: anchor }))}
                        zoom={zoomFor(frame, format)} onZoom={(zoom) => setZooms((prior) => ({ ...prior, [`${frame.id}|${format.id}`]: zoom }))}
                        platform={format.platform} overlay={overlay} onTurn={() => setTurned((prior) => ({ ...prior, [format.id]: !prior[format.id] }))} />
                    ))}
                  </div>
                )}
                {hiddenTiles > 0 && <p className="mt-1 text-xs text-zinc-400">{t.list.hiddenTiles(tiles.length, hiddenTiles)}</p>}
              </section>
              {optionsBlock}
            </div>
            <div className="space-y-2 md:col-span-2">
              {progress !== null && <progress aria-label={t.panel.progress} className="block w-full" value={progress} max={total} />}
            </div>
          </form>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-orange-200">{error}</p>}
        </div>
      </section>
    </div>
  );
}
