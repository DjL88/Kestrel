import { BROWSER_ORIGINAL_ZIP_LIMIT, copyUnchangedOriginal, planOriginalCopies } from '../core/originalCopyExport';
import { EXPORT_PREFERENCES_KEY, EXPORT_PRESETS_KEY, readExportPreferences, readExportPresets, type ExportPreset } from '../core/exportPreferences';
import { isRawPreviewFile } from '../core/rawFormats';
import { master16Blocker } from '../core/master16';
import { DEFAULT_EDIT } from '../core/photoEdits';
import { exportRaw16Tiff } from '../providers/rawMaster16';
import { canDevelopRaw } from '../providers/rawDevelop';
import { safeExportName } from '../core/exportPlace';
import { editorText as editorT } from '../i18n/areas/editor';
import { RAW_MASTER_EXPORT_ERROR, rawMasterExportBlocked } from '../core/rawMasterExportGate';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import {
  LEGACY_FORMAT_IDS, PLATFORMS, customFormat, formatById, framingFor, toProfile, turnFormat,
  type BarStyle, type CustomSize, type ExportFormat, type Fit,
} from '../core/exportFormats';
import type { FocusPoint } from '../core/exportFraming';
import type { PhotoFrame } from '../core/types';
import { archiveExports, downloadExport, loadExportSource, renderExport } from '../providers/browserExport';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';
import { ExportProofDock } from './ExportProofDock';
import { chooseProof, reconcileProofChoice, type ProofChoice } from '../core/exportProofSelection';
import { AdjustmentSlider } from './AdjustmentSlider';

/** Overlay and watermark sliders show their value as a whole percentage, never as an unexplained decimal. */
const percent = (value: number) => `${Math.round(value * 100)}%`;
import { ExportWizard } from './ExportWizard';
import { returnFocus } from './focusReturn';
import { KEEP_NAMES, stemFor, uniqueExportFilename, type NameTemplate } from '../core/exportNaming';
import { tasks } from '../core/taskStore';
import { exportBatchQueue } from '../core/exportBatchQueue';
import { planConnectedExports } from '../core/exportBatchDestinations';
import { parseCustomExportDate } from '../core/exportDateInput';
import { exportMayContinue } from '../core/exportCancellation';
import { parseWatermark, watermarkForStorage } from '../core/watermarkStore';
import { legacyWatermarkBlob, loadLocalWatermarkAsset, saveLocalWatermarkAsset, watermarkBlobDataUrl } from '../core/watermarkAssetVault';
import { metadataForExport, NO_EXPORT_METADATA, type ExportMetadataOptions } from '../core/exportMetadataOptions';
import { hasWatermark, NO_WATERMARK, WATERMARK_POSITIONS, WATERMARK_FONTS, type WatermarkOptions } from '../core/watermark';
import { NO_OVERLAY, exportOverlayTitle, photoOverlayLines, type OverlayOptions } from '../core/exportOverlay';
import { exportFilename } from '../core/exportProfiles';
import { SocialIcon } from './SocialIcon';
import { commonSocialSizes, uniqueRenderedSocialFormats, type SocialSizeGroup } from '../core/exportSocialGroups';
import type { ExportPlace } from '../providers/exportToPlace';
import { chooseDesktopExportFolder, isDesktopApp, isMobileShell, saveWithDialog } from '../providers/desktopShell';
import { exportText as t } from '../i18n/areas/export';
import { formatLabel, shapeName, sizeName, watermarkPositionLabel } from '../i18n/areas/export/labels';

interface Props {
  frames: PhotoFrame[];
  provider: BrowserPreviewProvider;
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
const SHARED_SOCIAL_SIZES = commonSocialSizes();
const FEATURED_SIZE_IDS = new Set(['ig-45', 'ig-story', 'ig-11', 'ig-34']);

const FIT_LABELS: Record<Fit, string> = t.fit;
const DEFAULT_CUSTOM: CustomSize = { width: 1600, height: 1200, fit: 'keep', format: 'jpeg', quality: 90, prefix: 'custom_', allowUpscale: false };

function readView(): 'wizard' | 'list' {
  try { return localStorage.getItem('kestrel.exportView') === 'wizard' ? 'wizard' : 'list'; } catch { return 'list'; }
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

export function PhotoExportPanel({ frames, provider, onClose, onDownloadRequested, exportPlace }: Props) {
  const [placeNote, setPlaceNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [placeTaskId, setPlaceTaskId] = useState<number | null>(null);
  const [openingPlace, setOpeningPlace] = useState(false);
  const placeBusy = openingPlace || placeTaskId !== null;
  const [chosen, setChosen] = useState<string[]>(() => loadChosen(false));
  const [preferences] = useState(() => readExportPreferences({ getItem: (key) => localStorage.getItem(key) }));
  const [presets, setPresets] = useState(() => readExportPresets({ getItem: (key) => localStorage.getItem(key) }));
  const [presetName, setPresetName] = useState('');
  const [presetNote, setPresetNote] = useState('');
  const [fits, setFits] = useState(preferences.fits);
  const [overrides, setOverrides] = useState(preferences.overrides);
  const [turned, setTurned] = useState(preferences.turned);
  const [view, setView] = useState<'wizard' | 'list'>(readView);
  const [simpleTab, setSimpleTab] = useState<'export' | 'advanced'>('export');
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
  const markSelection = useRef(0);
  const [metadata, setMetadata] = useState<ExportMetadataOptions>({ ...NO_EXPORT_METADATA });
  const [sources, setSources] = useState<Record<string, HTMLImageElement>>({});
  const [proofChoice, setProofChoice] = useState<ProofChoice | null>(null);
  const [proofLoadFailed, setProofLoadFailed] = useState<string | null>(null);
  const [proofRetry, setProofRetry] = useState(0);
  const [timestamp, setTimestamp] = useState<'now' | 'capture' | 'custom'>('now');
  const [customDate, setCustomDate] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [originalPrepared, setOriginalPrepared] = useState(false);
  const outputPlatforms = useRef(new WeakMap<File, ExportFormat['platform']>());
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
      const made = { ...format, fit: format.id === 'master' || format.id === 'full-jpeg' || format.id === 'before-after' ? format.fit : fits[id] ?? format.fit, prefix: edit?.prefix ?? format.prefix, quality: edit?.quality ?? format.quality };
      return [turned[id] ? turnFormat(made) : made];
    });
    const configured = customResult && 'format' in customResult ? [...base, customResult.format] : base;
    // Old saved choices can repeat one identical Instagram/Facebook/TikTok
    // rendering. Different per-photo crop positions must remain separate.
    return uniqueRenderedSocialFormats(configured, format => frames.map(frame => {
      const key = `${frame.id}|${format.id}`;
      const focus = anchors[key] ?? frame.focusPoint ?? { x: 0.5, y: 0.5 };
      return `${focus.x},${focus.y}:${zooms[key] ?? 1}`;
    }).join(';'));
  }, [chosen, fits, overrides, turned, customResult, frames, anchors, zooms]);
  const total = selected.length * frames.length;
  const proofPhotoIds = frames.map(frame => frame.id);
  const proofFormatIds = selected.map(format => format.id);
  const activeProof = reconcileProofChoice(proofChoice, proofPhotoIds, proofFormatIds);
  const chooseProofPhoto = (photoId: string) => setProofChoice(previous => chooseProof(previous, { photoId }, proofPhotoIds, proofFormatIds));
  const chooseProofFormat = (destinationId: string) => setProofChoice(previous => chooseProof(previous, { destinationId }, proofPhotoIds, proofFormatIds));
  const resultsReady = files.length > 0;
  const zoomFor = (frame: PhotoFrame, format: ExportFormat) => zooms[`${frame.id}|${format.id}`] ?? 1;
  const anchorFor = (frame: PhotoFrame, format: ExportFormat): FocusPoint => anchors[`${frame.id}|${format.id}`] ?? frame.focusPoint ?? { x: 0.5, y: 0.5 };

  function finishDelivery(exported: readonly PhotoFrame[], complete: boolean) {
    onDownloadRequested?.(exported);
    if (complete && !cancelled.current) onClose();
  }

  async function deliver(file: Blob, name: string, exported: readonly PhotoFrame[], complete = true) {
    if (saveRunning.current) return;
    setError('');
    if (!desktop) {
      downloadExport(file, name);
      finishDelivery(exported, complete);
      return;
    }

    saveRunning.current = true;
    setSaving(true);
    setSavedName(null);
    try {
      if (await saveWithDialog(file, name, originalPrepared)) {
        if (!complete && !cancelled.current) setSavedName(name);
        finishDelivery(exported, complete);
      }
    } catch {
      if (!cancelled.current) setError(t.panel.saveFailed);
    } finally {
      saveRunning.current = false;
      if (!cancelled.current) setSaving(false);
    }
  }

  /** A sensor-derived 16-bit TIFF is an explicit advanced export alongside
   * ordinary web/social output. It has its own renderer: never imply an 8-bit
   * browser PNG is the RAW master, and never write pixels to the original. */
  async function saveRawTiff() {
    if (frames.length !== 1 || saveRunning.current || progress !== null) return;
    const frame = frames[0];
    if (frame.isDemo || !isRawPreviewFile(frame.filename) || !canDevelopRaw()) return;
    const blocker = master16Blocker(frame.edit ?? DEFAULT_EDIT, frame.framing);
    if (blocker) { setError(blocker); return; }

    saveRunning.current = true;
    setSaving(true);
    setError('');
    const task = tasks.start(editorT.raw.masterTask);
    try {
      const original = await provider.ensureOriginal(frame.stableKey);
      if (!original) throw new Error(editorT.raw.masterReconnect);
      const shown = await loadExportSource(frame, provider);
      const tiff = await exportRaw16Tiff(
        original, shown, frame.edit ?? DEFAULT_EDIT, frame.framing,
        metadataForExport(frame, metadata),
      );
      // The 16-bit TIFF keeps its sensor-derived pixels. Descriptive XMP is
      // opt-in using exactly the same form as JPEG/PNG. Source EXIF, camera
      // identifiers and GPS are never copied implicitly. No burnt-in overlays.
      if (cancelled.current) { task.finish(editorT.raw.cancelledTask); return; }
      const stem = safeExportName(frame.filename.replace(/\\.[^.]+$/, '')).replace(/\\.[^.]+$/, '');
      const name = `${stem}_16bit.tif`;
      const saved = desktop ? await saveWithDialog(tiff, name, true) : (downloadExport(tiff, name), true);
      if (saved) {
        task.finish(editorT.raw.masterSavedTask);
        onDownloadRequested?.([frame]);
        if (!cancelled.current) onClose();
      } else {
        task.finish(editorT.raw.cancelledTask);
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : editorT.raw.masterFailed;
      task.fail(message);
      if (!cancelled.current) setError(message);
    } finally {
      saveRunning.current = false;
      if (!cancelled.current) setSaving(false);
    }
  }

  /**
   * Save the actual linked source bytes with their real camera extension.
   * No edit renderer, preview, crop, watermark, EXIF stripping, XMP rewrite
   * or Free-export allowance participates in this explicit source-copy path.
   */
  async function saveUnchangedOriginals() {
    if (saveRunning.current || activeExport.current || openingPlace || placeTaskId !== null ||
        frames.length === 0 || progress !== null) return;
    saveRunning.current = true;
    setError('');
    setOriginalPrepared(false);
    setOpeningPlace(true);
    try {
      const sourceFrames = structuredClone(frames);
      const planned = planOriginalCopies(sourceFrames);
      if (desktop && !isMobileShell()) {
        const destination = await chooseDesktopExportFolder();
        if (!destination || cancelled.current) return;
        const byId = new Map(sourceFrames.map(frame => [frame.id, frame]));
        exportBatchQueue.enqueue({
          title: t.originals.background(sourceFrames.length),
          items: planned,
          recipe: { mode: 'original-bytes', startedAt: Date.now() },
        }, {
          render: async (item, _recipe, signal) => {
            const source = byId.get(item.sourceId);
            if (!source) throw new Error(t.originals.sourceMissing);
            return copyUnchangedOriginal(source, provider, item.filename, signal);
          },
          save: (item, file, signal) => destination.save(file, item.subfolder, signal),
        });
        // Job has been accepted by the application Task Manager and is no
        // longer coupled to this dialog. Files are written one at a time.
        onClose();
        return;
      }

      // Browsers cannot stream an arbitrary collection to an exclusive user-
      // selected folder on all devices. A bounded in-memory ZIP is offered,
      // never an unbounded 500-RAW operation that can exhaust a phone.
      const sizes = sourceFrames.map(frame => provider.originalInfo(frame.stableKey)?.size);
      if (sourceFrames.length > 1 &&
          sizes.reduce<number>((sum, size) => sum + (size ?? 0), 0) > BROWSER_ORIGINAL_ZIP_LIMIT) {
        throw new Error(t.originals.browserLimit);
      }
      const controller = new AbortController();
      activeExport.current = controller;
      const task = tasks.start(t.originals.background(sourceFrames.length), {
        total: sourceFrames.length, cancel: () => controller.abort(),
      });
      setOpeningPlace(false);
      setSaving(true);
      const originals: File[] = [];
      let totalBytes = 0;
      try {
        for (const [index, item] of planned.entries()) {
          controller.signal.throwIfAborted();
          const file = await copyUnchangedOriginal(sourceFrames[index], provider, item.filename, controller.signal);
          totalBytes += file.size;
          if (sourceFrames.length > 1 && totalBytes > BROWSER_ORIGINAL_ZIP_LIMIT)
            throw new Error(t.originals.browserLimit);
          originals.push(file);
          task.progress(index + 1, sourceFrames.length);
        }
        controller.signal.throwIfAborted();
        if (!cancelled.current) {
          setOriginalPrepared(true);
          setFiles(originals);
          setZip(null);
          if (originals.length > 1) {
            packing.current = originals;
            const expected = originals;
            void archiveExports(originals).then(packed => {
              if (!cancelled.current && packing.current === expected) setZip(packed);
            }).catch(() => {
              if (!cancelled.current && packing.current === expected) setError(t.panel.zipFailed);
            });
          }
        }
        task.finish();
      } catch (error) {
        task.fail(error instanceof Error ? error.message : t.originals.sourceMissing);
        throw error;
      } finally {
        activeExport.current = null;
      }
    } catch (error) {
      if (!cancelled.current) setError(error instanceof Error ? error.message : t.originals.sourceMissing);
    } finally {
      saveRunning.current = false;
      if (!cancelled.current) {
        setOpeningPlace(false);
        setSaving(false);
      }
    }
  }

  async function deliverToPlace() {
    if (!exportPlace || saveRunning.current || !files.length) return;
    saveRunning.current = true;
    setPlaceNote(null);
    const controller = new AbortController();
    const task = tasks.start(t.results.alsoSave(exportPlace.label), {
      total: files.length, cancel: () => controller.abort(),
    });
    setPlaceTaskId(task.id);
    try {
      const result = await exportPlace.save(files, files.map(file => outputPlatforms.current.get(file)), {
        signal: controller.signal,
        onProgress: count => task.progress(count),
      });
      if (result.ok) {
        task.finish();
        finishDelivery(frames, true);
      } else {
        if (!result.stopped) task.fail(result.message);
        if (!cancelled.current) setPlaceNote({ ok: false, text: result.message });
      }
    } catch {
      task.fail(t.panel.saveFailed);
      if (!cancelled.current) setPlaceNote({ ok: false, text: t.panel.saveFailed });
    } finally {
      saveRunning.current = false;
      if (!cancelled.current) setPlaceTaskId(null);
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
          const image = await loadExportSource(frame, provider);
          if (active) setSources((prior) => (prior[frame.id] ? prior : { ...prior, [frame.id]: image }));
        } catch { /* That photo simply has no preview. Exporting reports the problem. */ }
      }
    })();
    return () => { active = false; };
    // The first few photos only change when the selection does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, provider]);

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
        const image = await loadExportSource(proofFrame, provider);
        if (active) setSources(prior => ({ ...prior, [proofFrame.id]: image }));
      } catch {
        if (active) setProofLoadFailed(proofFrame.id);
      }
    })();
    return () => { active = false; };
    // A retry explicitly re-attempts a failed source; other photo choices cancel stale loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proofFrame, proofSource, provider, proofRetry]);

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


  /**
   * Connected destinations support genuine background saving: a run folder and connector
   * are opened before the queue accepts any work. The immutable photo/recipe snapshot
   * is retained by the app-level queue, not by this dialog's lifetime.
   *
   * Ordinary browser downloads and the manual Save/ZIP route remain available below.
   */
  async function queueToBackgroundDestination(kind: 'connected' | 'desktop') {
    if ((kind === 'connected' && !exportPlace) || (kind === 'desktop' && (!desktop || isMobileShell())) ||
        saveRunning.current || activeExport.current || !total || blocked) return;
    if (timestamp === 'custom' && !parseCustomExportDate(customDate)) {
      setError(t.panel.invalidDate); return;
    }
    // The normal RAW workflow is still a JPEG development/preview, not a verified
    // high-bit-depth source-derived master. Never label that as a full-quality RAW export.
    if (rawMasterExportBlocked(selected, frames)) {
      setError(RAW_MASTER_EXPORT_ERROR);
      return;
    }
    saveRunning.current = true;
    setOpeningPlace(true);
    setError('');
    try {
      // An explicit click grants the chosen destination; no implicit upload.
      const destination = kind === 'desktop' ? await chooseDesktopExportFolder() : await exportPlace!.openBatch();
      if (!destination || cancelled.current) return; // Cancelling the folder picker is not an export.
      const photographs = structuredClone(frames);
      const options = {
        formats: structuredClone(selected), anchors: structuredClone(anchors),
        zooms: structuredClone(zooms), bars, overlay: structuredClone(overlay), metadata: structuredClone(metadata),
        timestamp, customDate, naming: structuredClone(naming), startedAt: Date.now(),
      };
      const planned = planConnectedExports(photographs, options.formats, options.naming);
      if (!planned.length) throw new Error('Choose at least one export format.');
      const ticket = exportBatchQueue.enqueue({
        title: `${t.results.backgroundSaving(planned.length)} · ${destination.folder}`,
        items: planned.map(entry => entry.item),
        recipe: options,
        // Only native desktop folder writes use createNew/exclusive output.
        // Cloud/NAS connectors may not guarantee no-overwrite, so they must
        // never be auto-retried after an ambiguous remote PUT.
        retrySafe: kind === 'desktop',
      }, {
        async render(item, recipe, signal) {
          signal.throwIfAborted();
          const [frameIndex, formatIndex] = item.sourceId.split(':').map(Number);
          const frame = photographs[frameIndex];
          const format = recipe.formats[formatIndex];
          if (!frame || !format) throw new Error('The photo or export format is no longer available.');
          const image = await loadExportSource(frame, provider, 'background');
          signal.throwIfAborted();
          const stem = stemFor(recipe.naming, frame.filename, frameIndex, photographs.length);
          const recorded = frame.exif.capturedAtMs ?? provider.originalInfo(frame.stableKey)?.lastModified;
          const chosenDate = recipe.timestamp === 'custom' ? parseCustomExportDate(recipe.customDate) : null;
          const date = chosenDate ?? (recipe.timestamp === 'capture' && Number.isFinite(recorded)
            ? new Date(recorded!) : new Date(recipe.startedAt));
          const key = `${frame.id}|${format.id}`;
          return renderExport(image, frame, toProfile(format), date, signal, framingFor(format.fit), undefined, {
            focus: recipe.anchors[key] ?? frame.focusPoint ?? { x: 0.5, y: 0.5 },
            bars: recipe.bars, zoom: recipe.zooms[key] ?? 1, stem, overlay: recipe.overlay,
             metadata: metadataForExport(frame, recipe.metadata),
          });
        },
        async save(item, rendered, signal) {
          // The naming plan is generated before starting, including camera-name collisions.
          // A render's internal filename cannot replace the independently validated target.
          const file = rendered.name === item.filename ? rendered
            : new File([rendered], item.filename, { type: rendered.type, lastModified: rendered.lastModified });
          await destination.save(file, item.subfolder, signal);
        },
      });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(chosen));
        localStorage.setItem(EXPORT_PREFERENCES_KEY, JSON.stringify({ fits, overrides, turned, bars }));
      } catch { /* Export is not dependent on settings storage. */ }
      void ticket.done.then(result => {
        if (result === 'completed') onDownloadRequested?.(photographs);
      });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start saving to that destination.');
    } finally {
      saveRunning.current = false;
      if (!cancelled.current) setOpeningPlace(false);
    }
  }

  async function prepare() {
    if (saveRunning.current || activeExport.current || !total || blocked) return;
    if (timestamp === 'custom' && !parseCustomExportDate(customDate)) {
      setError(t.panel.invalidDate);
      return;
    }
    if (customOn && customResult && 'error' in customResult) {
      setError(customResult.error);
      return;
    }
    // Match the connected background route: an 8-bit preview cannot be sold
    // to the photographer as a verified full-quality RAW master.
    if (rawMasterExportBlocked(selected, frames)) {
      setError(RAW_MASTER_EXPORT_ERROR);
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
        const image = await loadExportSource(frame, provider);
        const recorded = frame.exif.capturedAtMs ?? provider.originalInfo(frame.stableKey)?.lastModified;
        const date = pickedDate ?? (timestamp === 'capture' && Number.isFinite(recorded) ? new Date(recorded!) : started);
        if (!exportMayContinue(controller.signal.aborted, task.cancelled, cancelled.current)) return;
        for (const format of selected) {
          if (!exportMayContinue(controller.signal.aborted, task.cancelled, cancelled.current)) return;
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          if (!exportMayContinue(controller.signal.aborted, task.cancelled, cancelled.current)) return;
          const rendered = await renderExport(image, frame, toProfile(format), date, controller.signal, framingFor(format.fit), undefined, {
            focus: anchorFor(frame, format), bars, zoom: zoomFor(frame, format), stem, overlay,
             metadata: metadataForExport(frame, metadata),
          });
          if (!exportMayContinue(controller.signal.aborted, task.cancelled, cancelled.current)) return;
          const uniqueName = uniqueExportFilename(rendered.name, usedExportNames);
          const file = uniqueName === rendered.name
            ? rendered
            : new File([rendered], uniqueName, { type: rendered.type, lastModified: rendered.lastModified });
          outputPlatforms.current.set(file, format.platform);
          output.push(file);
          setProgress(output.length);
          task.progress(output.length);
        }
      }
      // Stop must never publish partial results.
      if (!exportMayContinue(controller.signal.aborted, task.cancelled, cancelled.current)) return;
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


  const toggle = (id: string, on: boolean) => setChosen((previous) => on ? (previous.includes(id) ? previous : [...previous, id]) : previous.filter((item) => item !== id));
  const toggleSharedSize = (group: SocialSizeGroup, on: boolean) => setChosen(previous => {
    const withoutAliases = previous.filter(id => !group.ids.includes(id));
    return on ? [...withoutAliases, group.canonical.id] : withoutAliases;
  });
  const anyBars = selected.some((format) => format.fit === 'bars' && format.width > 0);

  const formatRow = (format: ExportFormat, group?: SocialSizeGroup) => {
    const on = group ? group.ids.some(id => chosen.includes(id)) : chosen.includes(format.id);
    const current = fits[format.id] ?? format.fit;
    const shownFormat = turned[format.id] ? turnFormat(format) : format;
    return (
      <div key={format.id} className="rounded-md bg-white/5">
        <label className="flex min-h-11 items-center gap-2 px-2 text-sm">
          <input type="checkbox" checked={on} onChange={(event) => group ? toggleSharedSize(group, event.target.checked) : toggle(format.id, event.target.checked)} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span>{formatLabel(shownFormat)}</span>
              {group && <span className="inline-flex items-center gap-2" title={group.platforms.map(id => PLATFORMS.find(p => p.id === id)?.label ?? id).join(', ')}>
                {group.platforms.map(id => <SocialIcon key={id} id={id} className="h-4 w-4 shrink-0 text-zinc-300" />)}
                <span className="sr-only">Suitable for {group.platforms.map(id => PLATFORMS.find(p => p.id === id)?.label ?? id).join(', ')}</span>
              </span>}
            </span>
            <span className="block text-xs text-zinc-400">{sizeName(shownFormat)}</span>
          </span>
        </label>
        {on && format.id === 'full-jpeg' && frames.some(frame => !frame.isDemo && isRawPreviewFile(frame.filename)) && (
          <p role="note" className="px-2 pb-2 text-xs text-zinc-300">{t.formats.fullJpegHelp}</p>
        )}
        {on && format.id !== 'master' && format.id !== 'full-jpeg' && format.id !== 'before-after' && (
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
          <label className="col-span-2 flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={custom.allowUpscale === true}
              onChange={(event) => setCustom((prior) => ({ ...prior, allowUpscale: event.target.checked }))} />
            <span>{t.custom.allowUpscale}</span>
          </label>
          <label className="col-span-2">{t.custom.filenamePrefix}
            <input className={field} maxLength={24} value={custom.prefix} onChange={(event) => setCustom((prior) => ({ ...prior, prefix: event.target.value }))} />
          </label>
          {customResult && 'error' in customResult
            ? <p role="alert" className="col-span-2 text-xs font-semibold text-orange-200">{customResult.error}</p>
            : <p className="col-span-2 text-zinc-400">{custom.allowUpscale
              ? t.custom.upscaleNote : t.custom.shapeNote(shapeName(custom.width, custom.height))}</p>}
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
              <input className={field} maxLength={100} value={frames.length === 1 ? exportOverlayTitle(frames[0], overlay) : overlay.title ?? ''} onChange={(event) => setOverlay((prior) => ({ ...prior, title: event.target.value }))} />
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
          <label className="block text-sm text-zinc-300">{t.typeface}
            <select className={field} value={overlay.font ?? 'inter'} onChange={event => setOverlay(prior => ({ ...prior, font: event.target.value as OverlayOptions['font'] }))}>
              {WATERMARK_FONTS.map(font => <option key={font.id} value={font.id}>{font.label}</option>)}
            </select>
          </label>
          {frames.every((frame) => photoOverlayLines(frame, overlay).length === 0) && (
            <p role="status" className="text-xs text-zinc-400">{t.overlay.noDetails}</p>
          )}
        </>
      )}
    </fieldset>
  );
  const mark = overlay.watermark ?? NO_WATERMARK;
  useEffect(() => {
    // Persist the *reference* only, not the watermark's picture bytes.
    // Keep historic inline data intact until a successful migration.
    if (mark.kind === 'image' && !mark.imageAssetId) return;
    try { localStorage.setItem('kestrel.watermark.v1', JSON.stringify(watermarkForStorage(mark))); }
    catch { /* The live photo/edit must never depend on preference storage. */ }
  }, [mark]);
  useEffect(() => {
    if (mark.kind !== 'image' || !mark.imageAssetId || mark.imageData) return;
    let active = true;
    void loadLocalWatermarkAsset(mark.imageAssetId).then(async blob => {
      if (!blob) throw new Error('Watermark image not found.');
      const imageData = await watermarkBlobDataUrl(blob);
      if (active) setOverlay(previous => {
        if (previous.watermark?.imageAssetId !== mark.imageAssetId || previous.watermark?.imageData) return previous;
        return { ...previous, watermark: { ...(previous.watermark ?? NO_WATERMARK), imageData } };
      });
    }).catch(() => { if (active) setMarkNote(t.watermark.pictureMissing); });
    return () => { active = false; };
  }, [mark.kind, mark.imageAssetId, mark.imageData]);
  useEffect(() => {
    // One-time migration from old inline watermark preferences, offline only.
    if (mark.kind !== 'image' || !mark.imageData || mark.imageAssetId) return;
    let active = true;
    void (async () => saveLocalWatermarkAsset(legacyWatermarkBlob(mark.imageData!)))().then(imageAssetId => {
      if (active) setOverlay(previous => {
        if (previous.watermark?.imageData !== mark.imageData || previous.watermark?.imageAssetId) return previous;
        return { ...previous, watermark: { ...(previous.watermark ?? NO_WATERMARK), imageAssetId } };
      });
    }).catch(() => { if (active) setMarkNote(t.watermark.storageFailed); });
    return () => { active = false; };
  }, [mark.kind, mark.imageAssetId, mark.imageData]);
  const setMark = (change: Partial<WatermarkOptions>) => setOverlay((prior) => ({ ...prior, watermark: { ...(prior.watermark ?? NO_WATERMARK), ...change } }));
  async function chooseMarkPicture(file: File | undefined) {
    if (!file) return;
    const choice = ++markSelection.current;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 3_000_000) {
      setMarkNote(t.watermark.pictureTooBig); return;
    }
    try {
      // Save locally first; if permission/storage fails, keep the prior mark.
      const [imageAssetId, imageData] = await Promise.all([
        saveLocalWatermarkAsset(file), watermarkBlobDataUrl(file),
      ]);
      if (choice !== markSelection.current || cancelled.current) return;
      setMarkNote(null);
      setMark({ kind: 'image', imageAssetId, imageData, on: true });
    } catch {
      if (choice === markSelection.current && !cancelled.current) setMarkNote(t.watermark.storageFailed);
    }
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
              <span className="block text-xs text-zinc-400">{t.watermark.localOnly}</span>
            </label>
          )}
          {markNote && <p role="status" className="text-xs text-amber-200">{markNote}</p>}
          <label className="block text-sm text-zinc-300">{t.watermark.position}
            <select className={field} value={mark.position} onChange={(event) => setMark({ position: event.target.value as WatermarkOptions['position'] })}>
              {WATERMARK_POSITIONS.map((item) => <option key={item.id} value={item.id}>{watermarkPositionLabel(item.id)}</option>)}
            </select>
          </label>
          {mark.kind === 'text' && (
            <label className="block text-sm text-zinc-300">{t.typeface}
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
  const metadataBlock = (
    <details className="rounded-md border border-white/10 px-3 py-2">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">{t.metadata.title}</summary>
      <fieldset disabled={progress !== null || placeBusy} className="space-y-2">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={metadata.enabled}
            onChange={event => setMetadata(previous => ({ ...previous, enabled: event.target.checked }))} />
          {t.metadata.include}
        </label>
        <p className="text-xs text-zinc-400">{t.metadata.privacy}</p>
        {metadata.enabled && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs sm:col-span-2">{t.metadata.photoTitle}
              <input className={field} maxLength={200}
                value={metadata.title === null && frames.length === 1
                  ? exportOverlayTitle(frames[0], NO_OVERLAY) : metadata.title ?? ''}
                onChange={event => setMetadata(previous => ({ ...previous, title: event.target.value }))} />
            </label>
            {metadata.title === null && frames.length > 1 && (
              <p className="text-xs text-zinc-400 sm:col-span-2">{t.metadata.perPhoto}</p>
            )}
            <label className="text-xs sm:col-span-2">{t.metadata.caption}
              <textarea rows={2} className={field} maxLength={4096} value={metadata.caption}
                onChange={event => setMetadata(previous => ({ ...previous, caption: event.target.value }))} />
            </label>
            <label className="text-xs">{t.metadata.creator}
              <input className={field} maxLength={200} value={metadata.creator}
                onChange={event => setMetadata(previous => ({ ...previous, creator: event.target.value }))} />
            </label>
            <label className="text-xs">{t.metadata.copyright}
              <input className={field} maxLength={300} value={metadata.copyright}
                onChange={event => setMetadata(previous => ({ ...previous, copyright: event.target.value }))} />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-xs sm:col-span-2">
              <input type="checkbox" checked={metadata.includeKeywords}
                onChange={event => setMetadata(previous => ({ ...previous, includeKeywords: event.target.checked }))} />
              {t.metadata.includeKeywords}
            </label>
            {metadata.includeKeywords && <label className="text-xs sm:col-span-2">{t.metadata.keywords}
              <input className={field} maxLength={2048} value={metadata.keywords}
                onChange={event => setMetadata(previous => ({ ...previous, keywords: event.target.value }))} />
            </label>}
            <p className="text-xs text-zinc-400 sm:col-span-2">{t.metadata.help}</p>
          </div>
        )}
      </fieldset>
    </details>
  );
  const wizard = view === 'wizard' && !resultsReady;
  const optionsBlock = (
    <>
      {namingBlock}
      {metadataBlock}
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

  async function savePresets(next: ExportPreset[], success: string) {
    try {
      // Convert any historic inline picture marks before writing any preset.
      // Every saved preset contains only a local asset fingerprint.
      const safe = await Promise.all(next.map(async preset => {
        const watermark = preset.overlay?.watermark;
        if (!preset.overlay || !watermark) return preset;
        let selected = watermark;
        if (watermark.kind === 'image' && !watermark.imageAssetId && watermark.imageData) {
          const imageAssetId = await saveLocalWatermarkAsset(legacyWatermarkBlob(watermark.imageData));
          selected = { ...watermark, imageAssetId };
        }
        return { ...preset, overlay: { ...preset.overlay, watermark: watermarkForStorage(selected) } };
      }));
      localStorage.setItem(EXPORT_PRESETS_KEY, JSON.stringify(safe));
      setPresets(safe);
      setPresetNote(success);
    } catch {
      setPresetNote(t.presets.saveFailed);
    }
  }

  const changeView = (next: 'wizard' | 'list') => { setView(next); try { localStorage.setItem('kestrel.exportView', next); } catch { /* Optional preference. */ } };
  const invalidDate = timestamp === 'custom' && !parseCustomExportDate(customDate);
  const blocked = Boolean(customOn && customResult && 'error' in customResult) || invalidDate ||
    Boolean(mark.on && mark.kind === 'image' && !mark.imageData);
  // These actions are export choices, not huge independent cards above the
  // scrolling export page. An original copy is byte-for-byte and never edited.
  const originalChoice = (
    <div className="rounded-md border border-white/12 p-2">
      <button type="button" aria-busy={saving} className={`${button} inline-flex w-full items-center justify-between gap-2 text-left`}
        disabled={saving || progress !== null || placeBusy || !frames.length || frames.some(frame => frame.isDemo)}
        onClick={() => void saveUnchangedOriginals()}>
        <span>{t.originals.action(frames.length)}</span>
        {saving && <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
      </button>
      <p className="px-3 pb-1 text-xs text-zinc-400">{t.originals.privacy}</p>
      {frames.some(frame => frame.isDemo) && <p role="note" className="px-3 text-xs text-amber-200">{t.originals.unavailable}</p>}
      {(!desktop || isMobileShell()) && frames.length > 1 && <p className="px-3 text-xs text-zinc-400">{t.originals.browserLimitHelp}</p>}
    </div>
  );
  const rawMasterChoice = frames.length === 1 && !frames[0].isDemo &&
    isRawPreviewFile(frames[0].filename) && canDevelopRaw() ? (
      <div className="rounded-md border border-white/12 p-2">
        <button type="button" aria-busy={saving} className={`${button} inline-flex w-full items-center justify-between gap-2 text-left`}
          disabled={saving || progress !== null || placeBusy} onClick={() => void saveRawTiff()}>
          <span>{saving ? editorT.raw.masterBusy : t.rawTiff.action}</span>
          {saving && <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
        </button>
        <details className="px-3 pb-1 text-xs text-zinc-300">
          <summary className="min-h-9 cursor-pointer py-2">{t.rawTiff.details}</summary>
          <p>{t.rawTiff.help}</p>
        </details>
      </div>
    ) : null;

  const destinationActions = (
    <div className="space-y-2">
      {desktop && !isMobileShell() && (
        <button type="button" disabled={!total || progress !== null || blocked || placeBusy || saving}
          className={`${button} w-full border border-white/15 text-left`}
          onClick={() => void queueToBackgroundDestination('desktop')}>
          {placeBusy ? t.results.choosingFolder : t.results.desktopBackground(total)}
        </button>
      )}
      {exportPlace && (
        <button type="button" disabled={!total || progress !== null || blocked || placeBusy}
          className={`${button} w-full border border-white/15 text-left`}
          onClick={() => void queueToBackgroundDestination('connected')}>
          {openingPlace ? t.results.connectingDestination :
            placeTaskId !== null ? t.results.backgroundSaving(total) :
              t.results.connectedBackground(total, exportPlace.label)}
        </button>
      )}
    </div>
  );

  const presetsBlock = progress === null && !placeBusy ? (
          <details className="mb-2 rounded-md border border-white/15 px-3 py-2">
            <summary className="cursor-pointer py-2 text-sm">{t.presets.title}</summary>
            <ul className="space-y-2">
              {presets.map(preset => (
                <li key={preset.name} className="flex flex-wrap items-center gap-2">
                  <button type="button" className={button} onClick={() => {
                    setChosen(preset.formats);
                    setFits(preset.fits);
                    setOverrides(preset.overrides);
                    setTurned(preset.turned);
                    setBars(preset.bars);
                    setCustomOn(Boolean(preset.custom));
                    if (preset.custom) setCustom(structuredClone(preset.custom));
                    if (preset.overlay) setOverlay(structuredClone(preset.overlay));
                     setMetadata(preset.metadata ? structuredClone(preset.metadata) : { ...NO_EXPORT_METADATA });
                    if (preset.naming) setNaming({ ...preset.naming });
                    // Cropping/focus belongs to the current photographs, never a reusable preset.
                    setPresetNote(t.presets.applied(preset.name));
                  }}>{preset.name}</button>
                  <button type="button" className={button} aria-label={t.presets.remove(preset.name)}
                    onClick={() => savePresets(presets.filter(item => item !== preset), t.presets.removed)}>
                    {t.wizard.remove}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="text-sm">{t.presets.name}
                <input className={field} maxLength={40} value={presetName} onChange={event => setPresetName(event.target.value)} />
              </label>
              <button type="button" className={button} disabled={!total || blocked || !presetName.trim() || presets.length >= 20}
                onClick={() => {
                  const name = presetName.trim();
                  if (presets.some(item => item.name.toLowerCase() === name.toLowerCase())) {
                    setPresetNote(t.presets.duplicate);
                    return;
                  }
                  savePresets([...presets, structuredClone({ name, formats: chosen, fits, overrides, turned, bars,
                    overlay, metadata, naming, ...(customOn ? { custom } : {}),
                  })], t.presets.saved);
                }}>{t.presets.save}</button>
            </div>
            <p role="status" className="text-xs text-zinc-300">{presetNote}</p>
          </details>
  ) : null;

  const canShare = files.length > 0 && navigator.canShare?.({ files });
  const featuredGroups = SHARED_SOCIAL_SIZES.filter(group => FEATURED_SIZE_IDS.has(group.canonical.id));
  const otherGroups = SHARED_SOCIAL_SIZES.filter(group => !FEATURED_SIZE_IDS.has(group.canonical.id));
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-0" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <section ref={dialog} className={`workspace-popover flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col overflow-hidden border-0 bg-kestrel-raised shadow-xl`}>
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
        {!resultsReady && !wizard && (
          <div role="tablist" aria-label="Export settings" className="sticky top-0 z-10 flex gap-1 border-b border-white/10 bg-kestrel-raised py-2">
            <button type="button" role="tab" aria-selected={simpleTab === 'export'}
              className={`${button} flex-1 aria-selected:bg-white/10 aria-selected:text-white`}
              onClick={() => setSimpleTab('export')}>Export</button>
            <button type="button" role="tab" aria-selected={simpleTab === 'advanced'}
              className={`${button} flex-1 aria-selected:bg-white/10 aria-selected:text-white`}
              onClick={() => setSimpleTab('advanced')}>Advanced</button>
          </div>
        )}
        {resultsReady ? (
          <div className="space-y-3">
            <p role="status" className="text-sm text-zinc-300">
              {saving ? t.results.saving : savedName ? t.results.saved(savedName) : t.results.ready(files.length)}
            </p>
            <div className="flex flex-wrap gap-2">
              {files.length === 1 && <button type="button" aria-busy={saving} className={`${button} inline-flex items-center gap-2 bg-kestrel-copper text-zinc-950 hover:bg-kestrel-copper-hover!`}
                disabled={saving || placeBusy} onClick={() => void deliver(files[0], files[0].name, frames.slice(0, 1))}>
                {saving && <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
                {saving ? t.results.saving : desktop ? t.results.save : t.results.download}</button>}
              {files.length > 1 && <button type="button" aria-busy={saving || !zip} disabled={saving || placeBusy || !zip} className={`${button} inline-flex items-center gap-2 bg-kestrel-copper text-zinc-950 hover:bg-kestrel-copper-hover!`}
                onClick={() => { if (zip) void deliver(zip, 'kestrel-exports.zip', frames); }}>
                {(saving || !zip) && <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
                {saving ? t.results.saving : zip ? (desktop ? t.results.saveZip : t.results.downloadZip) : t.results.packingZip}</button>}
              {exportPlace && <button type="button" aria-busy={placeBusy} className={`${button} inline-flex items-center gap-2`} disabled={saving || placeBusy}
                onClick={() => void deliverToPlace()}>{placeBusy && <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}{placeBusy ? t.results.saving : t.results.alsoSave(exportPlace.label)}</button>}
              {placeTaskId !== null && <button type="button" className={button} onClick={() => tasks.cancel(placeTaskId)}>
                {t.looks.cancel}
              </button>}
              {canShare && <button type="button" className={button} disabled={saving || placeBusy} onClick={() => {
                void navigator.share({ files }).catch((reason) => {
                  if ((reason as Error).name !== 'AbortError') setError(t.results.shareFailed);
                });
              }}>{t.results.share}</button>}
              <button type="button" className={button} disabled={saving || placeBusy} onClick={() => {
                packing.current = null;
                setFiles([]);
                setOriginalPrepared(false);
                setZip(null);
                setError('');
                setSavedName(null);
              }}>{t.results.changeSettings}</button>
            </div>
            {placeNote && <p role={placeNote.ok ? 'status' : 'alert'} className={`text-sm ${placeNote.ok ? 'text-emerald-200' : 'text-amber-200'}`}>{placeNote.text}</p>}
            {files.length > 1 && files.length <= 12 && <details>
              <summary className="min-h-11 cursor-pointer py-2 text-sm">{desktop ? t.results.saveEach : t.results.downloadEach}</summary>
              {files.map((file, index) => <button type="button" className={`${button} block max-w-full truncate`}
                key={index} disabled={saving || placeBusy} onClick={() => {
                  const frame = frames[originalPrepared ? index : Math.floor(index / selected.length)];
                  void deliver(file, file.name, frame ? [frame] : [], false);
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
          <form id="export-form" className="mt-2 min-w-0 space-y-3"
            onSubmit={event => { event.preventDefault(); void prepare(); }}>
            {simpleTab === 'export' ? (
              <fieldset disabled={progress !== null} className="min-w-0 space-y-3">
                <legend className="mb-1 text-sm font-medium text-zinc-100">{t.list.chooseFormats}</legend>
                <div className="space-y-1.5">
                  {formatRow(formatById('master')!)}
                  {formatRow(formatById('full-jpeg')!)}
                  {formatRow(formatById('before-after')!)}
                  {originalChoice}
                </div>
                <h3 className="text-sm font-medium text-zinc-100">Popular social sizes</h3>
                <div className="space-y-1.5">
                  {featuredGroups.map(group => formatRow(group.canonical, group))}
                </div>
                <details className="rounded-md border border-white/10 p-2">
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-zinc-200">More sizes</summary>
                  <div className="space-y-1.5 pt-2">
                    {otherGroups.map(group => formatRow(group.canonical, group))}
                    {customBlock}
                  </div>
                </details>
                <p className="text-xs text-zinc-400">
                  Identical sizes use one image for all the platforms shown beside them. A different crop or quality is kept separate.
                </p>
                {destinationActions}
              </fieldset>
            ) : (
              <section aria-label="Advanced export settings" className="space-y-3">
                <h3 className="text-sm font-medium text-zinc-100">Text, watermark and finishing options</h3>
                {overlayBlock}
                {optionsBlock}
                {presetsBlock}
                {rawMasterChoice}
              </section>
            )}
            {progress !== null && <progress aria-label={t.panel.progress} className="block w-full" value={progress} max={total} />}
          </form>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-orange-200">{error}</p>}
        </div>
      </section>
    </div>
  );
}
