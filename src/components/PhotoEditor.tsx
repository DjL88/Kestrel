import { newId } from '../core/ids';
import { loadImage } from '../providers/loadImage';
import type { FocusPoint } from '../core/exportFraming';
import { messages as m } from '../i18n/messages';
import { ChevronDown, Columns2, Copy, Maximize, Minimize, Crop, Download, History, Lightbulb, RectangleHorizontal, RectangleVertical, Redo2, RotateCcw, RotateCw, Settings2, SlidersHorizontal, Square, SquircleDashed, Undo2, Wand2 } from 'lucide-react';
import { recipeAt } from '../core/editHistory';
import { formatClock } from '../core/formatDate';
import { DEFAULT_FRAMING, MIN_CROP_SIZE, displayFramingFor, detailAnchor, drawFramedPhoto, estimateLevel, framedSize, resizeCrop, thirdsCropAnchor, type CropCorner, type PhotoFraming } from '../core/photoFraming';
import { PhotoExportPanel } from './PhotoExportPanel';
import { AppearanceDialog } from './AppearanceDialog';
import { downloadExport } from '../providers/browserExport';
import { gridSizeFor } from '../core/subjectModel';
import { QuickAdjust } from './QuickAdjust';
import { AreaSelector } from './AreaSelector';
import { placeInRegion, sampledRegion, type Region } from '../core/subjectRegion';
import { Histogram } from './Histogram';
import { computeHistogram, type Histogram as HistogramData } from '../core/histogram';
import { applyCanvasPhotoEdit } from '../core/canvasEdit';
import { applyFix, critique, toneOnlyEdit, type Opinion } from '../core/critique';
import { fullContext } from '../core/masks';
import { MaskOverlay } from './MaskOverlay';
import { MaskPanel } from './MaskPanel';
import { createSubjectMask, framingKey } from '../core/maskTypes';
import { detectSubject } from '../providers/subjectDetector';
import { PresetPanel } from './PresetPanel';
import { autoEnhance, mergeAutoSuggestion } from '../core/autoEnhance';
import { proposeSubjectAwareAuto, type InsightSubjectKind } from '../core/insightSubjectAuto';
import { PANEL_DEFAULT, clampPanelWidth } from '../core/panelWidth';
import { PhotoViewport } from './PhotoViewport';
import { maxZoomFor, percentFor, stepZoom, zoomForPercent } from '../core/zoomControls';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_EDIT, EDIT_CHOICES, TONE_CONTROLS, DETAIL_CONTROLS, NOISE_CONTROL, isNeutralEdit, isEmptyEdit, type PhotoEdit } from '../core/photoEdits';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';

import { FIT_VIEW } from '../core/viewportTransform';
import { beforeSnapshot, type ComparisonStage } from '../core/compareStages';
import { resolveKeyboardCommand, type KeyBindingsMap } from '../core/keyboardCommands';
import { visiblePhotoDetail } from '../core/visiblePhotoDetail';

const FIT_PREVIEW_EDGE = 2200;
const DIAL_KEYS = [...EDIT_CHOICES.map(({ key }) => key), ...TONE_CONTROLS.map(({ key }) => key), ...DETAIL_CONTROLS.map(({ key }) => key)] as const;
import { isRawPreviewFile } from '../core/rawFormats';
import { tasks } from '../core/taskStore';
import { canDevelopRaw, developRaw, matchPreviewOrientation } from '../providers/rawDevelop';
import { extractRawPreview } from '../core/nefPreview';
import { PaidNotice } from './PaidNotice';
import { useAccess } from '../providers/useAccess';
const PANEL_KEY = 'kestrel-panel-width-v1';
const SHEET_KEY = 'kestrel-sheet-v1';
export type EditorTab = 'auto' | 'crop' | 'edit' | 'masks' | 'history' | 'export';
type Tab = EditorTab;
const TABS: { id: Tab; label: string; Icon: typeof Crop }[] = [
  { id: 'auto', label: 'Auto', Icon: Lightbulb },
  { id: 'crop', label: 'Crop', Icon: Crop },
  { id: 'edit', label: 'Edit', Icon: SlidersHorizontal },
  { id: 'masks', label: 'Masks', Icon: SquircleDashed },
  { id: 'history', label: 'History', Icon: History },
  { id: 'export', label: 'Export', Icon: Download },
];

/** The modifier key people expect on this device, for shortcut hints in tooltips. */
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

interface Props {
  /** Opens the macro pad settings and how-to, on the Edit tab. */
  onOpenMacroPad?: () => void;
  /** Suggest colour and tone the first time a photo is opened, when the project asked for it. */
  autoEdit?: boolean;
  frame: PhotoFrame;
  provider: BrowserPreviewProvider;
  needsAccess: boolean;
  bindings: KeyBindingsMap;
  onEdit: (edit: PhotoEdit) => void;
  initialTab?: EditorTab;
  onTabChange?: (tab: EditorTab) => void;
  /** Route primary Export through the existing single/batch export workflow. */
  onExport?: () => void;
  exportCount?: number;
  onExportRequested?: (frames: readonly PhotoFrame[]) => void;
  /** Applying a named look is a deliberate batch action when multiple photos are selected. */
  onApplyLook?: (edit: PhotoEdit) => void;
  onHistoryStep: (direction: -1 | 1) => void;
  /** Restore the photo to how it was after this many history steps. */
  onHistoryJump: (cursor: number) => void;
  copiedEdit: PhotoEdit | null;
  onCopyEdit: (edit: PhotoEdit) => void;
  keeperCount: number;
  onCreateVirtualCopy: (framing?: PhotoFraming) => void;
  onFocusPoint: (point?: FocusPoint) => void;
  onFramingChange: (framing: PhotoFraming) => void;
  onRemoveVirtualCopy?: () => void;
  panelSide: 'left' | 'right';
  onPanelSideChange: (side: 'left' | 'right') => void;
  hand?: 'left' | 'right';
  onHandChange?: (hand: 'left' | 'right') => void;
  showFilmstrip: boolean;
  onApplyToKeepers: (edit: PhotoEdit) => void;
  onUndoKeeperEdits?: () => void;
}

export function PhotoEditor({ autoEdit, onOpenMacroPad,
  frame, provider, needsAccess, bindings, onEdit, initialTab, onTabChange, onApplyLook, onExport, exportCount = 1, onExportRequested, onHistoryStep, onHistoryJump, copiedEdit, onCopyEdit, keeperCount,
  onApplyToKeepers, onUndoKeeperEdits, onCreateVirtualCopy, onRemoveVirtualCopy, onFramingChange, onFocusPoint,
  panelSide, onPanelSideChange, hand, onHandChange, showFilmstrip,
}: Props) {
  const originalCanvas = useRef<HTMLCanvasElement>(null);
  const editedCanvas = useRef<HTMLCanvasElement>(null);
  const sourceImage = useRef<HTMLImageElement | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const originalDetail = useRef<HTMLCanvasElement>(null);
  const editedDetail = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [showDetail, setShowDetail] = useState(false);
  const [sourceState, setSourceState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [developedRev, setDevelopedRev] = useState(0);
  const [developing, setDeveloping] = useState(false);
  const [developNote, setDevelopNote] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [beforeStage, setBeforeStage] = useState<ComparisonStage>('original');
  const [dial, setDial] = useState(0);
  const [panelWidth, setPanelWidth] = useState(() => {
    try { return clampPanelWidth(Number(localStorage.getItem(PANEL_KEY)) || PANEL_DEFAULT); } catch { return PANEL_DEFAULT; }
  });
  const cornerDrag = useRef<{ corner: CropCorner; x: number; y: number; point: { x: number; y: number } } | null>(null);
  const [autoNotes, setAutoNotes] = useState<string[]>([]);
  // Auto is a reversible visual preview; never save a suggested edit before an explicit Apply.
  const [pendingAuto, setPendingAuto] = useState<{ base: PhotoEdit; edit: PhotoEdit; cropKey: string; source: HTMLImageElement } | null>(null);
  const [autoAnalysing, setAutoAnalysing] = useState(false);
  // Invalidates slow ONNX results when a proposal is replaced, a tab changes or this editor unmounts.
  const autoRun = useRef(0);
  const subjectCache = useRef<{ source: HTMLImageElement; cropKey: string; result: Awaited<ReturnType<typeof detectSubject>> } | null>(null);
  useEffect(() => () => { autoRun.current += 1; }, []);
  // Once asked for, the opinion stays up to date as the edit changes, until it is hidden.
  const [opinions, setOpinions] = useState<Opinion[] | null>(null);
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectNotice, setDetectNotice] = useState('');
  const [brushRadius, setBrushRadius] = useState(0.05);
  const [erase, setErase] = useState(false);
  const [selectingArea, setSelectingArea] = useState(false);
  const [paintOn, setPaintOn] = useState(false);
  const [showMaskOverlay, setShowMaskOverlay] = useState(true);
  // The mask tint hides the real change, so it steps aside while a slider is being moved.
  const [sliderBusy, setSliderBusy] = useState(false);
  const sliderTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(sliderTimer.current), []);
  const [dialUsed, setDialUsed] = useState(false);
  // On a phone the Edit tab opens as one big slider within thumb reach. The full list is one tap away.
  const [allControls, setAllControls] = useState(false);
  const [quickChoices, setQuickChoices] = useState(false);
  const { can } = useAccess();
  // The editor is remounted for each photo; retain the chosen tab across the filmstrip.
  const [tab, setCurrentTab] = useState<Tab>(() => initialTab === 'auto' && !can('autoTab')
    ? 'edit' : initialTab ?? (can('autoTab') ? 'auto' : 'edit'));
  const setTab = (next: Tab) => { setCurrentTab(next); onTabChange?.(next); };
  const [previewRecipe, setPreviewRecipe] = useState<{ edit?: PhotoEdit; framing?: PhotoFraming } | null>(null);
  const cropEntry = useRef<PhotoFraming | null>(null);
  const panelScroll = useRef<HTMLDivElement>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const isPhone = useMediaQuery('(max-width: 899px), (max-height: 549px)');
  // On a phone the tools open as a sheet above the bar. Tapping the open tab again folds it away for a full-height photo.
  const [sheetOpen, setSheetOpen] = useState(() => {
    try { return localStorage.getItem(SHEET_KEY) !== 'closed'; } catch { return true; }
  });
  const rememberSheet = (open: boolean) => {
    setSheetOpen(open);
    try { localStorage.setItem(SHEET_KEY, open ? 'open' : 'closed'); } catch { /* the sheet still works for this session */ }
  };
  const chooseTab = (id: Tab) => {
    if (!isPhone) { setTab(id); return; }
    if (id === tab && sheetOpen) {
      // Folding the crop tool away applies the crop, since its Apply button is inside the sheet.
      if (id === 'crop') setTab('edit');
      rememberSheet(false);
      return;
    }
    setTab(id);
    rememberSheet(true);
  };
  // Full screen uses the whole page, so the macro pad and keyboard shortcuts keep working. Not every browser allows it (iPhone Safari does not).
  const canFullscreen = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled);
  const [fullscreen, setFullscreen] = useState(() => typeof document !== 'undefined' && Boolean(document.fullscreenElement));
  const [landscapeLocked, setLandscapeLocked] = useState(false);
  const [orientationNotice, setOrientationNotice] = useState('');
  const canLockOrientation = isPhone && typeof screen !== 'undefined' && typeof screen.orientation?.lock === 'function';
  useEffect(() => {
    const sync = () => {
      setFullscreen(Boolean(document.fullscreenElement));
      if (!document.fullscreenElement) { setLandscapeLocked(false); setOrientationNotice(''); }
    };
    document.addEventListener('fullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  const toggleFullscreen = () => {
    const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    request.catch(() => { /* the browser refused; the editor carries on as before */ });
  };
  const toggleLandscape = async () => {
    if (!fullscreen || !canLockOrientation) return;
    try {
      if (landscapeLocked) { screen.orientation.unlock(); setLandscapeLocked(false); }
      else { await screen.orientation.lock('landscape'); setLandscapeLocked(true); }
      setOrientationNotice('');
    } catch {
      setOrientationNotice('This device cannot lock rotation. Turn your device to view the photo in landscape.');
    }
  };
  // A saved or resized layout can leave the Export tab selected on a screen that has no such tab.
  useEffect(() => { if (!isPhone && tab === 'export') setTab('auto'); }, [isPhone, tab]);
  const cropOpen = tab === 'crop';
  const [previewCrop, setPreviewCrop] = useState(false);
  const [gridLines, setGridLines] = useState(true);
  const [cropNotice, setCropNotice] = useState('');
  const cropDrag = useRef<{ x: number; y: number; anchorX: number; anchorY: number } | null>(null);
  const [markFocus, setMarkFocus] = useState(false);
  const [transform, setTransform] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const [exportOpen, setExportOpen] = useState(false);
  const openExport = () => { if (onExport) onExport(); else setExportOpen(true); };
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [editNotice, setEditNotice] = useState('');
  const savedEdit = frame.edit ?? DEFAULT_EDIT;
  // While a history step is being previewed, draw that step's recipe instead of the saved one.
  const edit = (previewRecipe ? previewRecipe.edit : frame.edit) ?? DEFAULT_EDIT;
  // Painting is always a deliberate choice: leaving a mask or the Masks tab switches it off.
  useEffect(() => { setPaintOn(false); }, [selectedMaskId, tab]);
  // Delete or Backspace removes the selected mask, as in Lightroom. Typing in a field is never touched.
  useEffect(() => {
    if (tab !== 'masks' || !selectedMaskId) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.key !== 'Delete' && event.key !== 'Backspace') || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], dialog, [role="dialog"]')) return;
      const masks = edit.masks ?? [];
      if (!masks.some((mask) => mask.id === selectedMaskId)) return;
      event.preventDefault();
      onEdit({ ...edit, masks: masks.filter((mask) => mask.id !== selectedMaskId).map((mask) => mask.limit?.id === selectedMaskId ? { ...mask, limit: undefined } : mask) });
      setSelectedMaskId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, selectedMaskId, edit, onEdit]);
  const framing = (previewRecipe ? previewRecipe.framing : frame.framing) ?? DEFAULT_FRAMING;
  // Subject detection must not apply its result if the saved edit or crop changed while it ran.
  const detectionContext = useRef<{ edit: PhotoEdit; crop: string } | null>(null);
  const cropKey = framingKey(frame.framing ?? DEFAULT_FRAMING);
  useLayoutEffect(() => {
    detectionContext.current = { edit: savedEdit, crop: cropKey };
    return () => { detectionContext.current = null; };
  }, [savedEdit, cropKey]);
  const isRaw = isRawPreviewFile(frame.filename) && !frame.isDemo;

  useEffect(() => {
    let active = true;
    const image = new Image();
    setSourceState('loading');
    sourceImage.current = null;

    async function load() {
      const url = await provider.getFullPreviewUrl(frame);
      if (!active) return;
      if (!url) throw new Error('Preview unavailable');
      await loadImage(url, image);
      if (!active) return;

      sourceImage.current = image;
      setSourceState('ready');
    }

    void load().catch(() => {
      if (active) setSourceState('error');
    });
    return () => { active = false; };
    // Catalogue edits replace the frame object while keeping the source for this ID.
  }, [frame.id, provider, needsAccess, developedRev]);

  /** Decode the RAW sensor data (desktop app only) and use the full-size result in place of the embedded preview. */
  async function developFromRaw() {
    setDeveloping(true); setDevelopNote(null);
    const task = tasks.start(`Developing ${frame.filename} from RAW`);
    try {
      const result = await provider.developFromOriginal(frame.stableKey, async (original) => {
        const developed = await developRaw(original, /\.([a-z0-9]+)$/i.exec(frame.filename)?.[1] ?? 'nef');
        return matchPreviewOrientation(developed, await extractRawPreview(original).catch(() => null));
      });
      if (result === 'missing') {
        const message = 'Reconnect the original file first.';
        setDevelopNote(message);
        task.fail(message);
        return;
      }
      if (result === 'superseded') {
        task.finish('The source changed or a newer development started.');
        return;
      }
      task.finish();
      setDevelopedRev((count) => count + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'This RAW file could not be developed.';
      setDevelopNote(`${message} Kestrel keeps using the preview stored in the file.`);
      task.fail(message);
    } finally { setDeveloping(false); }
  }


  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const [histogram, setHistogram] = useState<HistogramData | null>(null);
  const source = sourceState === 'ready' ? sourceImage.current : null;
  // Compute one small, unedited sample when the photo or framing changes.
  // All look thumbnails share it, instead of decoding or processing the full image twelve times.
  const lookPreviewSource = useMemo(() => {
    if (!source || tab !== 'auto') return null;
    try {
      const canvas = document.createElement('canvas');
      drawFramedPhoto(source, canvas, framing, { scale: Math.min(1, 160 / Math.max(source.naturalWidth, source.naturalHeight)) });
      return canvas.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, canvas.width, canvas.height) ?? null;
    } catch {
      return null;
    }
  }, [source, framing, tab]);
  const guide = cropOpen && !previewCrop;
  const displayFraming = useMemo(() => displayFramingFor(framing, guide), [framing, guide]);
  const displayCompare = compare && !guide && sourceState === 'ready';
  const before = beforeSnapshot(frame, beforeStage);
  const outputSize = source ? framedSize(source.naturalWidth, source.naturalHeight, framing) : null;
  const size = source ? framedSize(source.naturalWidth, source.naturalHeight, displayFraming) : null;
  const fit = size ? Math.min(viewport.width / size.width, viewport.height / size.height) : 0;
  const position = size && fit ? {
    left: (viewport.width - size.width * fit) / 2, top: (viewport.height - size.height * fit) / 2,
    width: size.width * fit, height: size.height * fit,
  } : undefined;
  const cropRect = guide && outputSize && position ? {
    left: position.left + outputSize.x * fit, top: position.top + outputSize.y * fit,
    width: outputSize.width * fit, height: outputSize.height * fit,
  } : null;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const maxZoom = maxZoomFor(fit, dpr);
  const zoomTo = (zoom: number) => setTransform((current) => {
    const next = Math.max(1, Math.min(maxZoom, zoom));
    return { zoom: next, pan: next === 1 ? { x: 0, y: 0 } : current.pan };
  });
  useEffect(() => {
    const onZoomKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const direction = event.key === '+' || event.key === '=' ? 1 : event.key === '-' ? -1 : 0;
      if (!direction) return;
      event.preventDefault();
      setTransform((current) => {
        const next = stepZoom(current.zoom, direction, maxZoom);
        return { zoom: next, pan: next === 1 ? { x: 0, y: 0 } : current.pan };
      });
    };
    window.addEventListener('keydown', onZoomKey);
    return () => window.removeEventListener('keydown', onZoomKey);
  }, [maxZoom]);
  const detail = size ? visiblePhotoDetail(size.width, size.height, viewport.width, viewport.height, transform) : null;

  useEffect(() => {
    const canvas = editedCanvas.current;
    if (!source || !size || !canvas) return;
    const scale = Math.min(1, FIT_PREVIEW_EDGE / Math.max(size.width, size.height));
    drawFramedPhoto(source, canvas, displayFraming, { scale });
    applyCanvasPhotoEdit(canvas, edit);
    // A small copy keeps the histogram cheap, and it reads the edited result.
    const small = document.createElement('canvas');
    const shrink = Math.min(1, 256 / Math.max(canvas.width, canvas.height));
    small.width = Math.max(1, Math.round(canvas.width * shrink));
    small.height = Math.max(1, Math.round(canvas.height * shrink));
    const smallContext = small.getContext('2d', { willReadFrequently: true });
    if (smallContext) {
      smallContext.drawImage(canvas, 0, 0, small.width, small.height);
      setHistogram(computeHistogram(smallContext.getImageData(0, 0, small.width, small.height).data));
    }
  }, [source, displayFraming, edit, size?.width, size?.height]);

  useEffect(() => {
    if (!displayCompare || !source || !size || !originalCanvas.current) return;
    const scale = Math.min(1, FIT_PREVIEW_EDGE / Math.max(size.width, size.height));
    drawFramedPhoto(source, originalCanvas.current, displayFraming, { scale });
    if (before.edit) applyCanvasPhotoEdit(originalCanvas.current, before.edit);
  }, [source, displayFraming, displayCompare, before.edit, size?.width, size?.height]);

  useEffect(() => {
    setShowDetail(false);
    if (!source || !detail) return;
    const timer = window.setTimeout(() => {
      if (!editedDetail.current) return;
      const { region } = detail;
      const scale = Math.min(1, detail.scale * window.devicePixelRatio, Math.sqrt(5_000_000 / (region.width * region.height)));
      if (scale <= 0) return;
      drawFramedPhoto(source, editedDetail.current, displayFraming, { region, scale });
      applyCanvasPhotoEdit(editedDetail.current, edit, Math.max(size!.width, size!.height) * scale, {
        aspect: size!.height / size!.width,
        view: { x: region.x / size!.width, y: region.y / size!.height, w: region.width / size!.width, h: region.height / size!.height },
      });
      if (displayCompare && originalDetail.current) {
        drawFramedPhoto(source, originalDetail.current, displayFraming, { region, scale });
        if (before.edit) applyCanvasPhotoEdit(originalDetail.current, before.edit, Math.max(size!.width, size!.height) * scale, {
          aspect: size!.height / size!.width,
          view: { x: region.x / size!.width, y: region.y / size!.height, w: region.width / size!.width, h: region.height / size!.height },
        });
      }
      setShowDetail(true);
    }, 110);
    return () => window.clearTimeout(timer);
  }, [source, displayFraming, edit, before.edit, displayCompare, transform, viewport]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || exportOpen || !source || event.key === 'Tab') return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.isContentEditable || target?.closest('textarea, select, input:not([type="range"])')) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.code === 'KeyZ') {
        event.preventDefault();
        onHistoryStep(event.shiftKey ? 1 : -1);
        return;
      }
      const command = resolveKeyboardCommand({ event, bindings, activeMode: 'edit', isSuppressed: false });
      if (!command) return;
      event.preventDefault();
      const key = DIAL_KEYS[dial];
      switch (command.id) {
        case 'edit.copy': onCopyEdit(edit); setEditNotice('Adjustments copied'); break;
        case 'edit.paste': if (copiedEdit) onEdit(copiedEdit); break;
        case 'edit.reset': onEdit(DEFAULT_EDIT); break;
        case 'edit.beforeAfter': if (!guide) setCompare((value) => !value); break;
        case 'edit.wbNeutral': onEdit({ ...edit, warmth: 0 }); break;
        case 'edit.prevControl':
          setDialUsed(true);
          setDial((index) => (index + 1) % DIAL_KEYS.length);
          break;
        case 'edit.knobCcw':
        case 'edit.knobCw': {
          setDialUsed(true);
          const step = command.id === 'edit.knobCw' ? 0.1 : -0.1;
          const value = Math.max(key === 'sharpen' ? 0 : -2, Math.min(2, Math.round(((edit[key] ?? 0) + step) * 20) / 20));
          onEdit({ ...edit, [key]: value });
          break;
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bindings, copiedEdit, dial, edit, exportOpen, guide, onCopyEdit, onEdit, onHistoryStep, source]);

  // Tell the filmstrip below how much room the panel takes, because the panel runs down beside it on wide screens.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--editor-panel-w', `${panelWidth + 8}px`);
    return () => { root.style.removeProperty('--editor-panel-w'); };
  }, [panelWidth]);

  // Opening the crop tab shows the whole photo with the crop box. Remember the crop so Cancel can put it back.
  useEffect(() => {
    setPreviewCrop(false);
    setTransform(FIT_VIEW);
    autoRun.current += 1;
    setAutoAnalysing(false);
    setPreviewRecipe(null);
    setPendingAuto(null);
    setOpinions(null);
    // Each tab opens at its top. Otherwise the new tab inherits the old scroll position and starts under the tab bar.
    panelScroll.current?.scrollTo({ top: 0 });
    if (tab === 'crop') cropEntry.current = frame.framing ?? DEFAULT_FRAMING;
    else setMarkFocus(false);
    // Only when the tab changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Turning Before/After on shows the whole photo first, not whatever crop a previous zoom left
  // behind — otherwise comparing can look like it "selected" a sliver of the image instead of showing it.
  // Zooming in *during* the comparison (to check detail) is unaffected: this only fires on the off-to-on edge.
  useEffect(() => {
    if (compare) setTransform(FIT_VIEW);
  }, [compare]);

  // Auto-develop: get the best available quality without making anyone ask for it. The quick embedded preview shows
  // immediately so there's nothing to wait on, then this silently swaps in the full sensor decode once it's ready —
  // "Develop from RAW" in RAW options below is only there to retry or force it again, never required for normal use.
  useEffect(() => {
    if (!isRaw || !canDevelopRaw() || !source || developing || provider.isDeveloped(frame.stableKey)) return;
    void developFromRaw();
    // Once per photo: developing flips provider.isDeveloped, which this effect re-checks when `source` next changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  /** A quick, conservative category hint. Segmentation still determines the mask, not the filename or tag. */
  function autoSubjectKind(): InsightSubjectKind {
    if (frame.subjectKind === 'landscape') return 'landscape';
    if (frame.subjectKind === 'wildlife' || frame.subjectKind === 'people') return frame.subjectKind;
    const labels = [...(frame.tags ?? []), ...(frame.subjectNames ?? [])].join(' ').toLowerCase();
    if (/\b(bird|mammal|wildlife|animal|insect)\b/.test(labels)) return 'wildlife';
    if (/\b(portrait|person|people|face)\b/.test(labels)) return 'people';
    if (/\b(aircraft|airplane|aeroplane|plane|helicopter|jet)\b/.test(labels)) return 'aircraft';
    return 'other';
  }

  /** Preview an offline global recipe; enrich it with a trustworthy subject mask when one exists. */
  async function previewAutoSuggestion() {
    const run = ++autoRun.current;
    const startedFor = detectionContext.current;
    const originalSource = source;
    setAutoAnalysing(true);
    setPendingAuto(null);
    setPreviewRecipe(null);
    setOpinions(null);
    setAutoNotes(['Analysing your photograph on this device…']);
    const stillCurrent = () => run === autoRun.current && detectionContext.current === startedFor &&
      sourceImage.current === originalSource && Boolean(originalSource);
    try {
      const sample = sampleOrientedSource(256);
      if (!sample || !originalSource || !outputSize || !startedFor) {
        if (run === autoRun.current) setAutoNotes(['Could not analyse this photo. Your edits have not changed.']);
        return;
      }
      const { edit: suggestion, notes } = autoEnhance(sample.data);
      if (notes.includes('Too small to analyse.')) {
        if (stillCurrent()) setAutoNotes(['This preview is too small to analyse. Your edits have not changed.']);
        return;
      }
      const result = mergeAutoSuggestion(savedEdit, suggestion);
      let proposal = result.edit;
      let subjectNote = '';
      let usedMask = false;
      const category = autoSubjectKind();

      if (category !== 'landscape') {
        try {
          // Analyse exactly the unedited cropped image, not the adjusted or downscaled editor canvas.
          const detectionCanvas = document.createElement('canvas');
          drawFramedPhoto(originalSource, detectionCanvas, frame.framing ?? DEFAULT_FRAMING, {
            scale: Math.min(1, 640 / Math.max(outputSize.width, outputSize.height)),
          });
          const context = detectionCanvas.getContext('2d', { willReadFrequently: true });
          if (context && detectionCanvas.width >= 8 && detectionCanvas.height >= 8) {
            let detection = subjectCache.current?.source === originalSource && subjectCache.current?.cropKey === cropKey
              ? subjectCache.current.result : null;
            if (!detection) {
              // Slow/broken inference must not hold the editing workflow hostage.
              let timeout: number | undefined;
              try {
                detection = await Promise.race([
                  detectSubject(detectionCanvas),
                  new Promise<never>((_, reject) => {
                    timeout = window.setTimeout(() => reject(new Error('Subject analysis timed out')), 8000);
                  }),
                ]);
              } finally { if (timeout !== undefined) window.clearTimeout(timeout); }
              if (stillCurrent()) subjectCache.current = { source: originalSource, cropKey, result: detection };
            }
            if (!stillCurrent()) return;
            const { grid, assessment } = detection;
            if (assessment.usable) {
              const pixels = context.getImageData(0, 0, detectionCanvas.width, detectionCanvas.height);
              const local = proposeSubjectAwareAuto({
                pixels: pixels.data, width: pixels.width, height: pixels.height, edit: proposal,
                subjectKind: category, segmentation: { grid, confidence: assessment.confidence },
                maskId: newId(), framingKey: cropKey,
              });
              proposal = local.edit;
              usedMask = local.usedMask;
              subjectNote = local.usedMask ? local.reason : 'No safe local adjustment was needed. ' + local.reason;
            } else {
              subjectNote = 'Subject edges were uncertain, so only global adjustments were considered.';
            }
          }
        } catch {
          if (!stillCurrent()) return;
          subjectNote = 'Subject detection was unavailable. Global suggestions still work offline.';
        }
      } else {
        subjectNote = 'The atmosphere is preserved without adding an automatic subject mask.';
      }
      if (!stillCurrent()) return;
      const changed = result.changed || usedMask;
      setPendingAuto(changed ? { base: savedEdit, edit: proposal, cropKey, source: originalSource } : null);
      setPreviewRecipe(changed ? { edit: proposal, framing: frame.framing } : null);
      setAutoNotes([
        changed
          ? usedMask
            ? 'Previewing a global recipe with a gentle subject adjustment. Nothing is saved until you apply it.'
            : 'Previewing a suggested global recipe. Nothing is saved until you apply it.'
          : 'Your photo already looks balanced. No new edit was suggested.',
        ...notes,
        subjectNote,
      ].filter(Boolean));
    } catch {
      if (stillCurrent()) setAutoNotes(['Could not complete the suggestion. Your existing edits are unchanged.']);
    } finally {
      if (run === autoRun.current) setAutoAnalysing(false);
    }
  }

  // Opt-in project assistance suggests a look on first open; it never silently commits edits.
  useEffect(() => {
    if (!autoEdit || !source || frame.edit || frame.editHistory?.steps.length) return;
    void previewAutoSuggestion();
    // One first-open run; re-run if the source switches from an embedded preview to developed RAW.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // Alt (Option) + scroll wheel changes the selected dial control, for scroll tools and macro pads.
  const wheelState = useRef({ edit, dial, onEdit });
  wheelState.current = { edit, dial, onEdit };
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      const { edit: current, dial: index, onEdit: apply } = wheelState.current;
      const key = DIAL_KEYS[index];
      const step = event.deltaY < 0 ? 0.05 : -0.05;
      const value = Math.max(key === 'sharpen' ? 0 : -2, Math.min(2, Math.round(((current[key] ?? 0) + step) * 20) / 20));
      setDialUsed(true);
      apply({ ...current, [key]: value });
    };
    node.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => node.removeEventListener('wheel', onWheel, { capture: true });
  }, []);

  function updateOpinions() {
    if (!source || !outputSize) return;
    const scale = Math.min(1, 320 / Math.max(outputSize.width, outputSize.height));
    const fresh = () => {
      const canvas = document.createElement('canvas');
      drawFramedPhoto(source, canvas, framing, { scale });
      return canvas;
    };
    const read = (canvas: HTMLCanvasElement) => {
      const image = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
      return { data: image.data, width: image.width, height: image.height };
    };
    const original = fresh();
    const tone = fresh();
    const result = fresh();
    applyCanvasPhotoEdit(tone, toneOnlyEdit(edit));
    applyCanvasPhotoEdit(result, edit);
    const subject = edit.masks?.find((mask) => mask.kind === 'subject' && !mask.invert) ?? edit.masks?.find((mask) => mask.kind === 'subject');
    setOpinions(critique({
      source: read(original), toneOnly: read(tone), after: read(result), edit,
      subject: subject ? { mask: subject, context: fullContext(original.width, original.height) } : undefined,
    }));
  }

  // When Auto previews a recipe, run the existing offline image-quality checks on the preview.
  useEffect(() => {
    if (!pendingAuto || !source || !outputSize) return;
    try { updateOpinions(); }
    catch { setAutoNotes((notes) => [...notes, 'Quality checks are unavailable for this preview.']); }
    // Recompute when the proposed recipe or image is replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAuto, source]);

  useEffect(() => {
    if (!opinions) return;
    const timer = window.setTimeout(updateOpinions, 400);
    return () => window.clearTimeout(timer);
    // Refresh after the edit settles. The first opinion is made by the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, framing]);

  /** Detect on the unedited, cropped photo, so the result matches what the mask will be laid over. */
  async function findSubject(background: boolean, replaceId?: string) {
    const startedFor = detectionContext.current;
    if (!source || !outputSize || !startedFor) return;
    setDetecting(true);
    setDetectNotice('');
    try {
      const preview = document.createElement('canvas');
      drawFramedPhoto(source, preview, framing, { scale: Math.min(1, 640 / Math.max(outputSize.width, outputSize.height)) });
      const { grid, assessment } = await detectSubject(preview);
      if (detectionContext.current !== startedFor) {
        if (detectionContext.current) setDetectNotice('Photo edits changed. Find the subject or background again.');
        return;
      }
      if (!assessment.usable) {
        setDetectNotice(assessment.reason);
        return;
      }
      const masks = edit.masks ?? [];
      const key = framingKey(framing);
      if (replaceId) {
        onEdit({ ...edit, masks: masks.map((mask) => mask.id === replaceId && mask.kind === 'subject'
          ? { ...mask, grid, framingKey: key, confidence: assessment.confidence, strokes: [] } : mask) });
      } else {
        const mask = { ...createSubjectMask(newId(), grid, key, assessment.confidence), invert: background };
        onEdit({ ...edit, masks: [...masks, mask] });
        setSelectedMaskId(mask.id);
        setShowMaskOverlay(true);
      }
      setDetectNotice(assessment.reason);
    } catch (error) {
      if (detectionContext.current === startedFor) {
        setDetectNotice(error instanceof Error ? error.message : 'Subject detection failed.');
      }
    } finally {
      if (detectionContext.current) setDetecting(false);
    }
  }

  /** Look for the subject only inside a dragged box, then lay the result back over the whole framed photo. */
  async function findInArea(region: Region) {
    const startedFor = detectionContext.current;
    if (!source || !outputSize || !startedFor) return;
    setSelectingArea(false);
    setDetecting(true);
    setDetectNotice('');
    try {
      const preview = document.createElement('canvas');
      drawFramedPhoto(source, preview, framing, { scale: Math.min(1, 640 / Math.max(outputSize.width, outputSize.height)) });
      const { box, bounds } = sampledRegion(region, preview.width, preview.height);
      const piece = document.createElement('canvas');
      piece.width = box.w;
      piece.height = box.h;
      piece.getContext('2d')?.drawImage(preview, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      const { grid, assessment } = await detectSubject(piece, { maxCoverage: 0.98 });
      if (detectionContext.current !== startedFor) {
        if (detectionContext.current) setDetectNotice('Photo edits changed. Select the area again.');
        return;
      }
      if (!assessment.usable) { setDetectNotice(assessment.reason); return; }
      const full = gridSizeFor(preview.height / preview.width);
      const mask = createSubjectMask(newId(), placeInRegion(grid, bounds, full.w, full.h), framingKey(framing), assessment.confidence);
      onEdit({ ...edit, masks: [...(edit.masks ?? []), mask] });
      setSelectedMaskId(mask.id);
      setShowMaskOverlay(true);
      setDetectNotice(assessment.reason);
    } catch (error) {
      if (detectionContext.current === startedFor) setDetectNotice(error instanceof Error ? error.message : 'Subject detection failed.');
    } finally {
      if (detectionContext.current) setDetecting(false);
    }
  }

  function sampleOrientedSource(edge = 112) {
    if (!source) return null;
    const canvas = document.createElement('canvas');
    const oriented = { ...DEFAULT_FRAMING, turns: framing.turns };
    drawFramedPhoto(source, canvas, oriented, { scale: Math.min(1, edge / Math.max(source.naturalWidth, source.naturalHeight)) });
    return canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height);
  }

  function createCropCopy() {
    const sample = sampleOrientedSource();
    if (!sample) return;
    const detail = detailAnchor(sample.data, sample.width, sample.height);
    const ratio = framing.ratio ?? (sample.height > sample.width ? 4 / 5 : 5 / 4);
    const anchor = thirdsCropAnchor(sample.width, sample.height, ratio, detail);
    onCreateVirtualCopy({ ...framing, ...anchor, ratio });
  }

  function autoLevel() {
    const sample = sampleOrientedSource();
    if (!sample) return;
    const correction = estimateLevel(sample.data, sample.width, sample.height);
    if (correction === null) {
      setCropNotice('No clear horizon or level line found.');
      return;
    }
    onFramingChange({ ...framing, straighten: correction });
    setCropNotice(correction ? `Straightened by ${correction}°` : 'The detected line is already level.');
  }

  /** One tab bar. On a phone it is a bottom toolbar of large icons, and on wider screens the top of the side panel. */
  // On a phone Export is the last tab in the bottom bar. On a wider screen it is a button in the header instead,
  // which leaves the side panel's tabs with room to breathe.
  const visibleTabs = isPhone ? TABS : TABS.filter((entry) => entry.id !== 'export');
  const tabList = (
    <div role="tablist" aria-label="Editing tools"
      className={isPhone
        ? 'grid shrink-0 grid-cols-6 border-t border-white/10 bg-kestrel-panel pb-[env(safe-area-inset-bottom)]'
        : 'sticky top-0 z-10 -mx-3 flex overflow-x-auto border-b border-white/10 bg-kestrel-panel px-2 workspace:-mx-4 workspace:px-3'}
      onKeyDown={(event) => {
        const order = visibleTabs.map((entry) => entry.id);
        const at = order.indexOf(tab);
        const next = event.key === 'ArrowRight' ? order[(at + 1) % order.length] : event.key === 'ArrowLeft' ? order[(at + order.length - 1) % order.length]
          : event.key === 'Home' ? order[0] : event.key === 'End' ? order[order.length - 1] : null;
        if (!next) return;
        event.preventDefault();
        setTab(next);
        document.getElementById(`tab-${next}`)?.focus();
      }}>
      {visibleTabs.map(({ id, label, Icon }) => (
        <button key={id} id={`tab-${id}`} role="tab" type="button" aria-selected={tab === id} aria-controls={`panel-${id}`} tabIndex={tab === id ? 0 : -1}
          aria-expanded={isPhone ? sheetOpen && tab === id : undefined}
          onClick={() => chooseTab(id)}
          className={isPhone
            ? 'relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-zinc-300 focus-visible:outline-2 focus-visible:outline-sky-300 aria-selected:text-white aria-selected:after:absolute aria-selected:after:top-0 aria-selected:after:h-0.5 aria-selected:after:w-10 aria-selected:after:bg-sky-200'
            : 'flex min-h-14 flex-1 shrink-0 flex-col items-center justify-center gap-1 border-b-2 border-transparent px-2 text-xs text-zinc-300 hover:text-white focus-visible:outline-2 focus-visible:outline-sky-300 aria-selected:border-sky-200 aria-selected:text-white'}>
          <Icon className="h-5 w-5" aria-hidden="true" />
          <span>{label}{id === 'masks' && edit.masks?.length ? <span className="ml-1 text-xs tabular-nums text-zinc-400">{edit.masks.length}</span> : null}</span>
        </button>
      ))}
    </div>
  );

  const button = 'min-h-11 rounded-md px-3 text-sm text-zinc-200 hover:bg-white/8 disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-sky-400';
  return (
    <section aria-label="Photo editor" className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden bg-kestrel-stage">
      <div role="toolbar" aria-label="Editor actions" className="mobile-toolbar-scroll flex min-w-0 max-w-full shrink-0 items-center justify-between gap-2 overflow-x-auto border-b border-white/10 bg-kestrel-panel px-2 pt-0.5 sm:px-4">
        <div className="flex items-center gap-1">
          <button type="button" className={`${button} inline-flex items-center`} aria-label="Undo" title={`Undo (${MOD}+Z)`} disabled={!frame.editHistory?.cursor} onClick={() => onHistoryStep(-1)}>
            <Undo2 className="h-4 w-4" aria-hidden="true" /><span className="sr-only sm:not-sr-only sm:ml-1.5">Undo</span>
          </button>
          <button type="button" className={`${button} inline-flex items-center`} aria-label="Redo" title={`Redo (${MOD}+Shift+Z)`} disabled={!frame.editHistory || frame.editHistory.cursor >= frame.editHistory.steps.length} onClick={() => onHistoryStep(1)}>
            <Redo2 className="h-4 w-4" aria-hidden="true" /><span className="sr-only sm:not-sr-only sm:ml-1.5">Redo</span>
          </button>
          <button type="button" aria-pressed={displayCompare} disabled={sourceState !== 'ready' || guide} onClick={() => setCompare(!compare)}
            title="Compare the current edit against an earlier stage (backslash)"
            className={`${button} inline-flex items-center gap-1.5 border border-white/15 aria-pressed:border-sky-300 aria-pressed:bg-sky-300/20 aria-pressed:text-sky-100`}>
            <Columns2 className="h-4 w-4" aria-hidden="true" />
            <span>Before / After</span>
            <span className="rounded bg-black/40 px-1.5 text-xs">{displayCompare ? 'On' : 'Off'}</span>
          </button>
          {displayCompare && (
            <label className="min-w-0">
              <span className="sr-only">Before comparison stage</span>
              <select aria-label="Before comparison stage" value={beforeStage}
                onChange={(event) => setBeforeStage(event.target.value as ComparisonStage)}
                className="h-11 max-w-[145px] rounded-md border border-white/15 bg-kestrel-panel px-1 text-xs text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-300 sm:max-w-[205px]">
                <option value="original">Original</option>
                <option value="previous" disabled={!frame.editHistory?.cursor}>Previous edit</option>
                <option value="last-export" disabled={!frame.lastExport}>Last export</option>
                {(frame.editHistory?.steps ?? []).map((step, index) => (
                  <option value={`step:${index + 1}`} key={index}>
                    {index + 1}. {m.historyStep[step.kind]} · {formatClock(step.at)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="flex items-center gap-1">
        <button type="button" className={`${button} inline-flex items-center`}
          aria-label="Appearance and layout settings" aria-expanded={appearanceOpen}
          onClick={() => setAppearanceOpen(true)} title="Display theme and editing tools side">
          <Settings2 className="h-4 w-4" aria-hidden="true" />
        </button>
        {canLockOrientation && fullscreen && (
          <button type="button" className={`${button} inline-flex items-center border border-white/15`}
            aria-pressed={landscapeLocked} onClick={() => void toggleLandscape()}
            title="Use landscape for this full-screen photo; return to automatic rotation when finished">
            {landscapeLocked ? 'Auto rotate' : 'Landscape'}
          </button>
        )}
        {canFullscreen && (
          <button type="button" className={`${button} inline-flex items-center`} aria-pressed={fullscreen} onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Leave full screen' : 'Full screen'} title={fullscreen ? 'Leave full screen (Esc)' : 'Full screen: the photo and tools fill the screen. Keyboard and macro pad keep working.'}>
            {fullscreen ? <Minimize className="h-4 w-4" aria-hidden="true" /> : <Maximize className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
        <button type="button" disabled={sourceState !== 'ready'} onClick={openExport} title={exportCount > 1 ? `Export ${exportCount} selected photos` : "Export this photo for social media or full size"}
          className={`${button} hidden items-center gap-1.5 bg-kestrel-copper font-semibold !text-zinc-950 hover:bg-kestrel-copper-hover! workspace:inline-flex`}>
          <Download className="h-4 w-4" aria-hidden="true" />{exportCount > 1 ? `Export ${exportCount}` : "Export"}
        </button>

        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden workspace:flex-row">
      <div ref={stage} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-black">
        {fit > 0 && (
          <div role="group" aria-label="Zoom" className="absolute bottom-2 right-2 z-30 flex items-center gap-1 rounded-md bg-black/70 p-1 text-xs text-zinc-100">
            <button type="button" aria-label="Zoom out" title="Zoom out (-)" className="h-7 w-7 rounded hover:bg-white/15"
              onClick={() => zoomTo(stepZoom(transform.zoom, -1, maxZoom))}>−</button>
            <span aria-live="polite" aria-label="Zoom level" className="min-w-10 text-center tabular-nums">{percentFor(transform.zoom, fit, dpr)}%</span>
            <button type="button" aria-label="Zoom in" title="Zoom in (+)" className="h-7 w-7 rounded hover:bg-white/15"
              onClick={() => zoomTo(stepZoom(transform.zoom, 1, maxZoom))}>+</button>
            <input type="range" min={1} max={maxZoom} step={(maxZoom - 1) / 200} value={transform.zoom}
              aria-label="Zoom amount" onChange={(event) => zoomTo(event.target.valueAsNumber)}
              className="min-h-11 w-20 accent-sky-300 desk:min-h-9" />
            <button type="button" title="Fit to screen " className="h-7 rounded px-1.5 hover:bg-white/15" onClick={() => zoomTo(1)}>Fit</button>
            <button type="button" title="Actual pixels " className="h-7 rounded px-1.5 hover:bg-white/15"
              onClick={() => zoomTo(zoomForPercent(100, fit, dpr))}>100%</button>
            <button type="button" title="Twice actual pixels " className="h-7 rounded px-1.5 hover:bg-white/15"
              onClick={() => zoomTo(zoomForPercent(200, fit, dpr))}>200%</button>
          </div>
        )}
        <PhotoViewport zoom={transform.zoom} pan={transform.pan} maxZoom={maxZoom} showZoomButton={false}
          onTransform={(zoom, pan) => setTransform({ zoom, pan })}
          overlayMode={displayCompare ? 'wipe' : 'hidden'}
          labels={displayCompare ? [before.label, 'Now'] : undefined}
          base={<>
            <canvas ref={editedCanvas} aria-label="Edited photo" role="img"
              hidden={sourceState !== 'ready'} className={position ? "absolute" : "absolute inset-0 h-full w-full object-contain"} style={position} />
            {detail && <canvas ref={editedDetail} aria-hidden="true" hidden={!showDetail}
              className="absolute" style={detail.style} />}
            {!guide && position && markFocus && <button type="button" aria-label="Place export focus point" title="Place export focus point"
              className="absolute z-10 cursor-crosshair focus-visible:outline-2 focus-visible:outline-sky-200" style={position}
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                const clamp = (value: number) => Math.min(1, Math.max(0, value));
                onFocusPoint(event.detail ? { x: clamp((event.clientX - bounds.left) / bounds.width),
                  y: clamp((event.clientY - bounds.top) / bounds.height) } : { x: 0.5, y: 0.5 });
                setMarkFocus(false);
              }} />}
            {!guide && position && frame.focusPoint && <span aria-hidden="true"
              className="pointer-events-none absolute z-20 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_#000]"
              style={{ left: position.left + position.width * frame.focusPoint.x, top: position.top + position.height * frame.focusPoint.y }} />}
            {tab === 'masks' && !guide && position && size && showMaskOverlay && !sliderBusy && edit.masks?.find((mask) => mask.id === selectedMaskId) && (
              <MaskOverlay mask={edit.masks.find((mask) => mask.id === selectedMaskId)!} masks={edit.masks} aspect={size.height / size.width} rect={position}
                brushRadius={brushRadius} paintOn={paintOn} erase={erase}
                onChange={(next) => onEdit({ ...edit, masks: edit.masks!.map((mask) => mask.id === next.id ? next : mask) })} />
            )}
            {tab === 'masks' && selectingArea && !guide && position && size && !displayCompare && (
              <AreaSelector rect={position} onSelect={(region) => void findInArea(region)} onCancel={() => setSelectingArea(false)} />
            )}
            {cropRect && <div style={cropRect}
              className={`crop-guide absolute border border-white/90 ${gridLines ? 'crop-thirds' : ''} ${framing.ratio ? 'cursor-move' : 'pointer-events-none'}`}
              onPointerDown={(event) => {
                if (!framing.ratio) return;
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                cropDrag.current = { x: event.clientX, y: event.clientY, anchorX: framing.x, anchorY: framing.y };
              }}
              onPointerMove={(event) => {
                if (!cropDrag.current || !size || !fit) return;
                const base = cropDrag.current;
                const bound = (value: number) => Math.max(0, Math.min(1, value));
                onFramingChange({
                  ...framing,
                  x: bound(base.anchorX + (event.clientX - base.x) / (size.width * fit * transform.zoom)),
                  y: bound(base.anchorY + (event.clientY - base.y) / (size.height * fit * transform.zoom)),
                });
              }}
              onLostPointerCapture={() => { cropDrag.current = null; }}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {outputSize && size && fit > 0 && (['tl', 'tr', 'bl', 'br'] as CropCorner[]).map((corner) => {
                const point = { x: outputSize.x + (corner.endsWith('r') ? outputSize.width : 0), y: outputSize.y + (corner.startsWith('b') ? outputSize.height : 0) };
                const names = { tl: 'top left', tr: 'top right', bl: 'bottom left', br: 'bottom right' };
                const apply = (target: { x: number; y: number }) => onFramingChange(resizeCrop(size.width, size.height, framing, corner, target));
                return (
                  <button key={corner} type="button" aria-label={`Crop corner, ${names[corner]}. Arrow keys resize it.`} title="Drag to resize the crop"
                    className="pointer-events-auto absolute grid h-11 w-11 touch-none place-items-center focus-visible:outline-none"
                    style={{ [corner.startsWith('t') ? 'top' : 'bottom']: -22, [corner.endsWith('l') ? 'left' : 'right']: -22, cursor: corner === 'tl' || corner === 'br' ? 'nwse-resize' : 'nesw-resize' }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      cornerDrag.current = { corner, x: event.clientX, y: event.clientY, point };
                    }}
                    onPointerMove={(event) => {
                      const start = cornerDrag.current;
                      if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                      const scale = fit * transform.zoom;
                      apply({ x: start.point.x + (event.clientX - start.x) / scale, y: start.point.y + (event.clientY - start.y) / scale });
                    }}
                    onLostPointerCapture={() => { cornerDrag.current = null; }}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      const step = size.width * (event.shiftKey ? 0.05 : 0.01);
                      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
                      if (!delta) return;
                      event.preventDefault();
                      event.stopPropagation();
                      apply({ x: point.x + delta[0], y: point.y + delta[1] });
                    }}>
                    <span className="h-3.5 w-3.5 border-2 border-white bg-black/60 shadow-[0_0_0_1.5px_#000]" />
                  </button>
                );
              })}
            </div>}
          </>}
          overlay={<>
            <canvas ref={originalCanvas} aria-label={`${before.label} photo`} role="img"
              className={position ? "absolute" : "absolute inset-0 h-full w-full object-contain"} style={position} />
            {detail && displayCompare && <canvas ref={originalDetail} aria-hidden="true" hidden={!showDetail}
              className="absolute" style={detail.style} />}
          </>}
        />
        {sourceState !== 'ready' && (
          <p role="status" className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-zinc-300">
            {sourceState === 'loading' ? 'Opening photo…' : needsAccess ? 'Reconnect the original file to edit it.' : 'This photo has no browser-readable preview.'}
          </p>
        )}
      </div>
      <PanelResizer width={panelWidth} side={panelSide} onChange={setPanelWidth} />
      <div ref={panelScroll} onInput={(event) => {
        if (tab !== 'masks' || !(event.target instanceof HTMLInputElement) || event.target.type !== 'range') return;
        setSliderBusy(true);
        window.clearTimeout(sliderTimer.current);
        sliderTimer.current = window.setTimeout(() => setSliderBusy(false), 700);
      }} style={{ '--panel-w': `${panelWidth}px` } as React.CSSProperties} className={`${isPhone && !sheetOpen ? 'hidden ' : ''}scroll-pt-14 max-h-[46%] shrink-0 space-y-2 overflow-y-auto border-t border-white/10 bg-kestrel-panel p-3 pt-0 workspace:relative workspace:z-10 ${showFilmstrip ? 'workspace:-mb-[156px] workspace:pb-[172px] ' : ''}workspace:max-h-none workspace:w-[var(--panel-w)] workspace:border-t-0 workspace:p-4 workspace:pt-0 ${panelSide === 'left' ? 'workspace:order-[-9999] workspace:border-r' : 'workspace:border-l'}`}>
        {!isPhone && tabList}
        {tab === 'auto' && !can('autoTab') && (
          <div role="tabpanel" id="panel-auto" aria-labelledby="tab-auto"><PaidNotice title="The Auto tab">Automatic colour and tone adjustments and local editing advice are here.</PaidNotice></div>
        )}
        {tab === 'auto' && can('autoTab') && (
          <div role="tabpanel" id="panel-auto" aria-labelledby="tab-auto" className="space-y-2">
        <div className="space-y-2 px-1">
          <button type="button" title="Preview an offline suggested recipe and check its quality before applying" disabled={sourceState !== 'ready' || autoAnalysing}
            className={`${button} inline-flex w-full items-center justify-center gap-2 border border-white/10 font-semibold`}
            onClick={() => void previewAutoSuggestion()}>
            <Lightbulb className="h-4 w-4 stroke-[1.75]" aria-hidden="true" />{autoAnalysing ? 'Analysing…' : 'Suggest a look'}
          </button>
          <p className="text-xs text-zinc-400">Kestrel checks the whole picture and, where reliable, the subject separately. Preview before applying; your original stays untouched.</p>
          {pendingAuto && (
            <div role="group" aria-label="Suggested edit preview" className="space-y-2 rounded-lg border border-white/15 bg-white/5 p-3">
              <p role="status" className="text-sm text-zinc-100">Previewing your suggested edit</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" aria-pressed={displayCompare} className={`${button} border border-white/15 aria-pressed:bg-sky-300/15`}
                  onClick={() => setCompare((current) => !current)}>{displayCompare ? 'Hide comparison' : 'Compare before / after'}</button>
                <button type="button" className={`${button} bg-kestrel-copper font-semibold !text-zinc-950 hover:bg-kestrel-copper-hover!`}
                  onClick={() => {
                    if (savedEdit !== pendingAuto.base || cropKey !== pendingAuto.cropKey || sourceImage.current !== pendingAuto.source) {
                      setAutoNotes(['The photo changed while previewing. Run Suggest a look again.']);
                    } else {
                      onEdit(pendingAuto.edit);
                      setAutoNotes(['Suggested look applied. You can undo it from Edit history.']);
                    }
                    autoRun.current += 1;
                    setPendingAuto(null);
                    setPreviewRecipe(null);
                  }}>Apply suggested edit</button>
                <button type="button" className={`${button} border border-white/15`} onClick={() => {
                  autoRun.current += 1;
                  setAutoAnalysing(false);
                  setPendingAuto(null);
                  setPreviewRecipe(null);
                  setOpinions(null);
                  setAutoNotes(['Suggestion dismissed. Your edit is unchanged.']);
                }}>Keep current edit</button>
              </div>
            </div>
          )}
        </div>
          {autoNotes.length > 0 && <ul role="status" className="list-disc space-y-0.5 pl-4 pt-1 text-xs text-zinc-300">
            {autoNotes.map((note) => <li key={note}>{note}</li>)}
          </ul>}
          {autoNotes.length > 0 && !pendingAuto && <p className="px-1 text-xs text-zinc-400">You can save an edit you like as a reusable recipe in Recipes below.</p>}
          {opinions && (
            <section aria-label="Quality checks for this look" className="space-y-2 rounded-md border border-white/10 p-2">
              {opinions.length === 0 && <p role="status" className="text-sm text-zinc-300">No obvious warning from this small preview. Check fine detail at 100% before exporting.</p>}
              {opinions.map((opinion) => (
                <div key={opinion.id} className="space-y-1 text-sm">
                  <p className="font-semibold text-zinc-100">{opinion.severity === 'warning' ? 'Watch out: ' : 'Tip: '}{opinion.title}</p>
                  <p className="text-xs text-zinc-300">{opinion.detail}</p>
                  {opinion.fix && !pendingAuto && (
                    <button type="button" className={`${button} border border-white/15 text-xs`}
                      onClick={() => onEdit(applyFix(edit, opinion.fix!))}>{opinion.fixLabel ?? 'Apply'}</button>
                  )}
                </div>
              ))}
              <button type="button" className="min-h-9 text-xs text-zinc-400 underline hover:text-white" onClick={() => setOpinions(null)}>Hide opinion</button>
            </section>
          )}
        <section aria-label="Photo recipes" className="space-y-1 border-t border-white/10 pt-2">
          <h3 className="text-sm font-medium text-zinc-100">Recipes</h3>
          <PresetPanel edit={edit} disabled={sourceState !== 'ready'} previewSource={lookPreviewSource} onApply={(next) => (onApplyLook ?? onEdit)({ ...next, ...(edit.masks ? { masks: edit.masks } : {}) })} />
        </section>
        <Histogram data={histogram} teach />

          </div>
        )}
        {tab === 'export' && (
          <div role="tabpanel" id="panel-export" aria-labelledby="tab-export" className="space-y-2 px-1 pt-2">
            <p className="text-sm text-zinc-300">Pick a platform and shape, preview the crop, then save.</p>
            <button type="button" disabled={sourceState !== 'ready'} className={`${button} w-full border border-white/10 font-semibold`} onClick={openExport}>
              Choose formats and export…
            </button>
          </div>
        )}
        {tab === 'edit' && (
          <div role="tabpanel" id="panel-edit" aria-labelledby="tab-edit" className="space-y-2">
        {isPhone && (allControls ? (
          <button type="button" className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-white/12 px-3 text-xs text-zinc-200 hover:bg-white/10" onClick={() => setAllControls(false)}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />Back to quick adjust
          </button>
        ) : (
          <QuickAdjust edit={edit} disabled={sourceState !== 'ready'} onEdit={onEdit}
            canStepBack={Boolean(frame.editHistory?.cursor)} canStepForward={Boolean(frame.editHistory && frame.editHistory.cursor < frame.editHistory.steps.length)}
            onStepBack={() => onHistoryStep(-1)} onStepForward={() => onHistoryStep(1)} peeking={displayCompare} onPeek={() => setCompare(!compare)} onShowAll={() => setAllControls(true)} />
        ))}
        <div className={isPhone && !allControls ? 'hidden' : 'space-y-2'}>
        <div className="space-y-2 px-1 py-2">
          {EDIT_CHOICES.map(({ key, label, options }, index) => (
            <fieldset key={key} disabled={sourceState !== 'ready'} className="min-w-0 disabled:opacity-45">
              <label className="block">
                <span className="flex items-center justify-between text-xs text-zinc-300">
                  <span>{label}{dialUsed && dial === index && <span className="ml-2 text-sky-200">Dial</span>}</span>
                  <output className="tabular-nums text-zinc-400">{key === 'exposure' ? `${(edit[key] * 0.4).toFixed(2)} EV` :
                    key === 'colour' && edit.colour === -2 ? 'Monochrome' : `${Math.round(edit[key] * (key === 'warmth' ? 8 : 20))}%`}</output>
                </span>
                <input type="range" min={key === 'exposure' ? -12.5 : -2} max={key === 'exposure' ? 12.5 : 2} step={0.1} value={edit[key]} aria-label={`${label} adjustment`}
                  onFocus={() => setDial(index)}
                  onChange={(event) => onEdit({ ...edit, [key]: event.target.valueAsNumber })}
                  onDoubleClick={() => onEdit({ ...edit, [key]: 0 })}
                  className="block min-h-9 w-full accent-sky-300 desk:min-h-7" />
              </label>
              {quickChoices && <div className="flex gap-1">
                {options.map((name, index) => (
                  <button type="button" key={name} aria-pressed={edit[key] === index - 1}
                    onClick={() => onEdit({ ...edit, [key]: index - 1 })}
                    className="min-h-11 rounded px-2 text-xs hover:bg-white/8 aria-pressed:bg-sky-300/15 desk:min-h-7">{name}</button>
                ))}
              </div>}
            </fieldset>
          ))}
          <button type="button" aria-expanded={quickChoices} onClick={() => setQuickChoices(!quickChoices)}
            className="min-h-10 rounded-md px-1 text-xs text-zinc-400 hover:text-white desk:min-h-7">Quick choices</button>
        </div>
        <details open className="border-t border-white/10">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm text-zinc-300 [&::-webkit-details-marker]:hidden">
            Tone <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </summary>
          <div className="space-y-1 px-1 pb-2">
            {TONE_CONTROLS.map(({ key, label }) => (
              <label key={key} className="block">
                <span className="flex items-center justify-between text-xs text-zinc-300">
                  <span>{label}{dialUsed && DIAL_KEYS[dial] === key && <span className="ml-2 text-sky-200">Dial</span>}</span>
                  <output className="tabular-nums text-zinc-400">{Math.round((edit[key] ?? 0) * 50)}</output>
                </span>
                <input type="range" min={-2} max={2} step={0.05} value={edit[key] ?? 0} aria-label={`${label} adjustment`}
                  title={key === 'brightness' ? 'Adjust midtone brightness while preserving pure black and white; use Exposure for overall light' : undefined}
                  disabled={sourceState !== 'ready'}
                  onChange={(event) => onEdit({ ...edit, [key]: event.target.valueAsNumber })}
                  onDoubleClick={() => onEdit({ ...edit, [key]: 0 })}
                  className="block min-h-9 w-full accent-sky-300 disabled:opacity-45 desk:min-h-7" />
              </label>
            ))}
          </div>
        </details>
        <details open className="border-t border-white/10">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm text-zinc-300 [&::-webkit-details-marker]:hidden">
            Detail <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </summary>
          <div className="space-y-1 px-1 pb-2">
            {DETAIL_CONTROLS.map(({ key, label }) => (
              <label key={key} className="block">
                <span className="flex items-center justify-between text-xs text-zinc-300">
                  <span>{label}{dialUsed && DIAL_KEYS[dial] === key && <span className="ml-2 text-sky-200">Dial</span>}</span>
                  <output className="tabular-nums text-zinc-400">{Math.round((edit[key] ?? 0) * 50)}</output>
                </span>
                <input type="range" min={key === 'sharpen' ? 0 : -2} max={2} step={0.05} value={edit[key] ?? 0} aria-label={`${label} adjustment`}
                  disabled={sourceState !== 'ready'}
                  onChange={(event) => onEdit({ ...edit, [key]: event.target.valueAsNumber })}
                  onDoubleClick={() => onEdit({ ...edit, [key]: 0 })}
                  className="block min-h-9 w-full accent-sky-300 disabled:opacity-45 desk:min-h-7" />
              </label>
            ))}
            <label className="block" title="Smooths the coloured speckle that shows in dark areas of high-ISO photos. Only colour is smoothed: edges, feathers and fine texture are left alone.">
              <span className="flex items-center justify-between text-xs text-zinc-300">
                <span>{NOISE_CONTROL.label}</span>
                <output className="tabular-nums text-zinc-400">{Math.round((edit.denoise ?? 0) * 50)}</output>
              </span>
              <input type="range" min={0} max={2} step={0.05} value={edit.denoise ?? 0} aria-label={`${NOISE_CONTROL.label} adjustment`}
                aria-describedby="denoise-help" disabled={sourceState !== 'ready'}
                onChange={(event) => onEdit({ ...edit, denoise: event.target.valueAsNumber })}
                onDoubleClick={() => onEdit({ ...edit, denoise: 0 })}
                className="block min-h-9 w-full accent-sky-300 disabled:opacity-45 desk:min-h-7" />
              <span id="denoise-help" className="block text-xs text-zinc-400">Smooths colour speckle only. Edges and fine texture stay as they are.</span>
            </label>
          </div>
        </details>
        <details className="border-b border-white/10 pb-1">
          <summary className="min-h-11 cursor-pointer py-3 text-sm">Export focus</summary>
          <button type="button" className={button} disabled={!position || guide} aria-pressed={markFocus} onClick={() => {
            setCompare(false);
            setTransform(FIT_VIEW);
            setMarkFocus(!markFocus);
          }}>{markFocus ? 'Cancel placement' : frame.focusPoint ? 'Move focus point' : 'Mark focus point'}</button>
          {frame.focusPoint && <button type="button" className={button} onClick={() => onFocusPoint(undefined)}>Clear</button>}
          <p className="px-1 pb-2 text-xs text-zinc-400">{markFocus ? 'Tap the subject. Press Enter on the photo to use the centre.' :
            'Used when cropping exports. Re-mark after changing the crop.'}</p>
        </details>
        {isRaw && (
          <div className="border-t border-white/10 pt-2">
            <p role={developing ? 'status' : undefined} className="px-1 text-xs text-zinc-300">{provider.isDeveloped(frame.stableKey)
              ? 'Developed from the RAW file as an 8-bit JPEG. Edits use that JPEG; the original RAW is unchanged.'
              : developing ? 'Getting the full quality from the RAW file…' : "You're editing the quick preview stored inside the RAW file."}</p>
            {/* Always visible, not tucked behind the disclosure: when the automatic attempt fails the person needs
                to see why without first hunting through RAW options. */}
            {developNote && <p role="status" className="px-1 text-xs text-amber-200">{developNote}</p>}
            {/* Only when the automatic attempt failed: one plain retry, nothing else to puzzle over. */}
            {canDevelopRaw() && !provider.isDeveloped(frame.stableKey) && developNote && (
              <button type="button" className={`${button} w-full border border-white/10`} disabled={developing || sourceState !== 'ready'} onClick={() => void developFromRaw()}>
                {developing ? 'Developing…' : 'Develop from RAW'}
              </button>
            )}
          </div>
        )}
        <details className="border-t border-white/10">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm text-zinc-300 [&::-webkit-details-marker]:hidden">
            Edit options <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </summary>
          <div className="flex flex-wrap gap-1">
            <button type="button" disabled={isEmptyEdit(edit)} className={button} onClick={() => {
              onEdit(DEFAULT_EDIT);

              setEditNotice('Adjustments reset');
            }}>Reset edits</button>
          </div>
          <div className="flex flex-wrap gap-1 border-t border-white/10 pt-1">
            <button type="button" disabled={keeperCount < 2 || isNeutralEdit(edit) || sourceState !== 'ready'}
              className={button} aria-expanded={confirmApply} onClick={() => setConfirmApply(!confirmApply)}>
              Apply to {keeperCount} keepers
            </button>
            {onUndoKeeperEdits && <button type="button" className={button} onClick={() => {
              onUndoKeeperEdits();
              setEditNotice('Batch adjustments undone');
            }}>Undo last batch</button>}
          </div>
          {confirmApply && !isNeutralEdit(edit) && sourceState === 'ready' && (
            <div className="rounded-md bg-black/25 p-2 text-sm">
              <p>Replace the adjustments on all {keeperCount} keepers with this photo’s settings?</p>
              <button type="button" className={button} onClick={() => setConfirmApply(false)}>Cancel</button>
              <button type="button" className={`${button} font-semibold`} onClick={() => {
                onApplyToKeepers(edit);
                setConfirmApply(false);
  
                setEditNotice(`Updated ${keeperCount} keepers`);
              }}>Apply adjustments</button>
            </div>
          )}
          <p role="status" className="text-xs text-zinc-400">{editNotice}</p>
          <div className="flex flex-wrap gap-1 border-t border-white/10 pt-1">
            <button type="button" className={button} onClick={() => onCreateVirtualCopy()}>Create virtual copy</button>
            {onRemoveVirtualCopy && <button type="button" className={button} aria-expanded={confirmRemove} onClick={() => setConfirmRemove(!confirmRemove)}>Remove virtual copy</button>}
          </div>
          {confirmRemove && onRemoveVirtualCopy && (
            <div className="rounded-md bg-black/25 p-2 text-sm">
              <p>Remove this version and its edits? The original file stays in the shoot.</p>
              <button type="button" className={button} onClick={() => setConfirmRemove(false)}>Cancel</button>
              <button type="button" className={button} onClick={onRemoveVirtualCopy}>Remove copy</button>
            </div>
          )}

          {!frame.isDemo && <button type="button" className={button} disabled={!provider.hasBlob(frame.stableKey)}
            onClick={async () => {
              const original = await provider.ensureOriginal(frame.stableKey);
              if (original) downloadExport(original, original instanceof File ? original.name : frame.filename);
            }}>Download original</button>}
          {outputSize && <p className="mt-2 text-xs text-zinc-400">Output {outputSize.width.toLocaleString()} × {outputSize.height.toLocaleString()} px</p>}
        </details>
        </div>
          </div>
        )}
        {tab === 'crop' && (
          <div role="tabpanel" id="panel-crop" aria-labelledby="tab-crop" className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={sourceState !== 'ready'} className={`${button} bg-kestrel-copper font-semibold !text-zinc-950 hover:bg-kestrel-copper-hover!`}
                onClick={() => setTab('edit')}>Apply crop</button>
              <button type="button" disabled={sourceState !== 'ready'} className={`${button} border border-white/15`}
                onClick={() => { if (cropEntry.current) onFramingChange(cropEntry.current); setTab('edit'); }}>Cancel</button>
            </div>
            <p className="px-1 text-xs text-zinc-400">Drag the corners or the box on the photo. Changes are saved as you go. Apply returns to the editing view with the crop in place, and Cancel puts back the crop you started with.</p>
          <fieldset disabled={sourceState !== 'ready'} className="space-y-2">
            <div className="flex flex-wrap">
              <button type="button" className={`${button} inline-flex items-center gap-1.5`} onClick={createCropCopy}>
                <Copy className="h-4 w-4" aria-hidden="true" />Auto crop copy</button>
              <button type="button" className={`${button} inline-flex items-center gap-1.5`} onClick={() => onFramingChange({
                ...framing, turns: (framing.turns + 1) % 4, x: 1 - framing.y, y: framing.x,
              })}>
                <RotateCw className="h-4 w-4" aria-hidden="true" />Rotate 90°</button>
              <button type="button" className={`${button} inline-flex items-center gap-1.5`} onClick={autoLevel}>
                <Wand2 className="h-4 w-4" aria-hidden="true" />Auto-level</button>
              <button type="button" className={`${button} inline-flex items-center gap-1.5`} onClick={() => { onFramingChange(DEFAULT_FRAMING); setCropNotice(''); }}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />Reset</button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button type="button" className={button} aria-pressed={previewCrop} onClick={() => {
                setPreviewCrop(!previewCrop);
                setTransform(FIT_VIEW);
              }}>{previewCrop ? 'Edit crop' : 'Preview crop'}</button>
              <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={gridLines} onChange={(event) => setGridLines(event.target.checked)} />Gridlines</label>
            </div>
            {cropNotice && <p role="status" className="text-xs text-zinc-300">{cropNotice}</p>}
            <label className="flex min-h-11 items-center justify-between gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5">
                {framing.ratio === null ? <Crop className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                  : framing.ratio === 1 ? <Square className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                  : framing.ratio > 1 ? <RectangleHorizontal className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                  : <RectangleVertical className="h-4 w-4 text-zinc-400" aria-hidden="true" />}
                Aspect ratio
              </span>
              <span className="relative inline-flex min-w-0 max-w-[60%] shrink-0 items-center">
                <select aria-label="Crop aspect ratio" value={framing.ratio ?? ''} onChange={(event) => onFramingChange({ ...framing, ratio: Number(event.target.value) || null })}
                  className="min-h-11 w-full min-w-0 appearance-none truncate rounded-md border border-white/10 bg-[#252830] py-2 pl-3 pr-10 text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300">
                  <option value="">Original</option>
                  <option value={1}>Square</option>
                  <option value={4 / 5}>4:5</option>
                  <option value={5 / 4}>5:4</option>
                  <option value={3 / 2}>3:2</option>
                  <option value={9 / 16}>9:16</option>
                  <option value={2 / 3}>2:3</option>
                </select>
                <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 h-4 w-4 shrink-0 stroke-[1.75] text-zinc-300" />
              </span>
            </label>
            <label className="block px-1 pb-1">
              <span className="flex items-center justify-between text-xs text-zinc-300"><span>Crop size</span>
                <output className="tabular-nums text-zinc-400">{Math.round((framing.size ?? 1) * 100)}%</output></span>
              <input type="range" min={MIN_CROP_SIZE} max={1} step={0.01} value={framing.size ?? 1} aria-label="Crop size"
                onChange={(event) => size && onFramingChange({ ...framing, ratio: framing.ratio ?? size.width / size.height, size: event.target.valueAsNumber })}
                onDoubleClick={() => onFramingChange({ ...framing, size: undefined })}
                className="block min-h-9 w-full accent-sky-300 desk:min-h-7" />
            </label>
            <label className="block text-xs">Straighten <output>{framing.straighten.toFixed(1)}°</output>
              <input type="range" min={-12} max={12} step={0.1} value={framing.straighten}
                onChange={(event) => onFramingChange({ ...framing, straighten: event.target.valueAsNumber })}
                className="block min-h-10 w-full accent-sky-300" />
            </label>
            {framing.ratio && (['x', 'y'] as const).map((axis) => (
              <label key={axis} className="block text-xs">{axis === 'x' ? 'Horizontal crop position' : 'Vertical crop position'}
                <input type="range" min={0} max={1} step={0.01} value={framing[axis]}
                  onChange={(event) => onFramingChange({ ...framing, [axis]: event.target.valueAsNumber })}
                  className="block min-h-10 w-full accent-sky-300" />
              </label>
            ))}
          </fieldset>

          </div>
        )}
        {tab === 'masks' && !can('masks') && (
          <div role="tabpanel" id="panel-masks" aria-labelledby="tab-masks"><PaidNotice title="Masks and subject detection">Brush, gradient and subject masks, and selecting an area, are here.</PaidNotice></div>
        )}
        {tab === 'masks' && can('masks') && (
          <div role="tabpanel" id="panel-masks" aria-labelledby="tab-masks">
            <MaskPanel masks={edit.masks ?? []} selectedId={selectedMaskId} disabled={sourceState !== 'ready'}
              brushRadius={brushRadius} paintOn={paintOn} onPaintOn={setPaintOn} erase={erase} showOverlay={showMaskOverlay}
              onSelect={setSelectedMaskId} onChange={(masks) => onEdit({ ...edit, masks })}
              onBrushRadius={setBrushRadius} onErase={setErase} onShowOverlay={setShowMaskOverlay}
              onFindSubject={(background) => void findSubject(background)} onRefind={(id) => void findSubject(false, id)} selectingArea={selectingArea} onSelectArea={setSelectingArea}
              detecting={detecting} detectNotice={detectNotice} currentFramingKey={framingKey(framing)} />

          </div>
        )}
        {tab === 'history' && (
          <div role="tabpanel" id="panel-history" aria-labelledby="tab-history">
            <div className="space-y-2" aria-label="Edit history">
              <p className="px-1 text-xs text-zinc-400">Hover or focus a step to preview it. Press it to restore the photo to that point. Later steps stay available to redo.</p>
              <ol className="space-y-1">
                {[{ label: 'Original', at: 0 }, ...(frame.editHistory?.steps ?? []).map((step) => ({ label: m.historyStep[step.kind], at: step.at }))].map((entry, index) => {
                  const cursor = frame.editHistory?.cursor ?? 0;
                  const history = frame.editHistory;
                  const current = index === cursor;
                  return (
                    <li key={index}>
                      <button type="button" aria-current={current ? 'step' : undefined} disabled={!history}
                        onClick={() => { onHistoryJump(index); setPreviewRecipe(null); }}
                        onMouseEnter={() => history && !current && setPreviewRecipe(recipeAt(history, index) ?? null)}
                        onMouseLeave={() => setPreviewRecipe(null)}
                        onFocus={() => history && !current && setPreviewRecipe(recipeAt(history, index) ?? null)}
                        onBlur={() => setPreviewRecipe(null)}
                        className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-sm hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300 aria-[current=step]:bg-sky-300/15 aria-[current=step]:font-semibold ${index > cursor ? 'text-zinc-500' : 'text-zinc-200'}`}>
                        <span>{current ? '● ' : ''}{entry.label}{index > cursor ? ' (undone)' : ''}</span>
                        <time className="tabular-nums text-xs text-zinc-400" dateTime={entry.at ? new Date(entry.at).toISOString() : undefined}>{entry.at ? formatClock(entry.at) : 'start'}</time>
                      </button>
                    </li>
                  );
                })}
              </ol>
              {!frame.editHistory?.steps.length && <p className="px-1 text-sm text-zinc-400">{m.emptyHistory}</p>}
            </div>
          </div>
        )}
      </div>
      {isPhone && tabList}
      </div>
      {orientationNotice && <p role="status" className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-2 right-2 z-40 rounded-md bg-kestrel-panel p-3 text-center text-xs text-zinc-100">{orientationNotice}</p>}
      {appearanceOpen && <AppearanceDialog side={panelSide} onSideChange={onPanelSideChange} hand={hand} onHandChange={onHandChange} onClose={() => setAppearanceOpen(false)} onOpenMacroPad={onOpenMacroPad} />}
      {exportOpen && !onExport && <PhotoExportPanel frames={[frame]} provider={provider} source={source} onClose={() => setExportOpen(false)} onDownloadRequested={onExportRequested} />}
    </section>
  );
}

function PanelResizer({ width, side, onChange }: { width: number; side: 'left' | 'right'; onChange: (width: number) => void }) {
  const move = (next: number) => {
    const clamped = clampPanelWidth(next, window.innerWidth);
    onChange(clamped);
    try { localStorage.setItem(PANEL_KEY, String(clamped)); } catch { /* the width still applies for this session */ }
  };
  return (
    <div role="separator" aria-orientation="vertical" aria-label="Resize adjustments panel" aria-valuenow={width} tabIndex={0}
      className={`${side === 'left' ? 'workspace:order-[-1]' : ''} hidden w-2 shrink-0 cursor-col-resize bg-white/5 hover:bg-sky-300/30 focus-visible:outline-2 focus-visible:outline-sky-300 workspace:block`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        move(side === 'right' ? window.innerWidth - event.clientX : event.clientX);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const grow = (event.key === 'ArrowLeft') === (side === 'right');
        move(width + (grow ? 20 : -20));
      }} />
  );
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}
