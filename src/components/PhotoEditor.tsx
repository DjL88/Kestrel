import { newId } from '../core/ids';
import { loadImage } from '../providers/loadImage';
import type { FocusPoint } from '../core/exportFraming';
import { messages as m } from '../i18n/messages';
import { editorText as t } from '../i18n/areas/editor';
import { ChevronDown, ChevronLeft, ChevronRight, Columns2, Copy, Maximize, Minimize, Crop, Download, History, Lightbulb, RectangleHorizontal, RectangleVertical, Redo2, RotateCcw, RotateCw, SlidersHorizontal, Square, SquircleDashed, Undo2, Wand2 } from 'lucide-react';
import { recipeAt } from '../core/editHistory';
import { formatClock } from '../core/formatDate';
import { CROP_RATIOS, DEFAULT_FRAMING, MIN_CROP_SIZE, displayFramingFor, detailAnchor, drawCrop, drawFramedPhoto, estimateLevel, fixedShape, framedSize, resizeCrop, resizeCropEdge, thirdsCropAnchor, type CropCorner, type CropEdge, type PhotoFraming } from '../core/photoFraming';
import { PhotoExportPanel } from './PhotoExportPanel';
import { downloadExport } from '../providers/browserExport';
import { QuickAdjust } from './QuickAdjust';
import { AdjustmentSlider } from './AdjustmentSlider';
import { signedAdjustment } from '../core/adjustmentSlider';
import { AreaSelector } from './AreaSelector';
import { sampledRegion, type Region } from '../core/subjectRegion';
import { Histogram } from './Histogram';
import { computeHistogram, type Histogram as HistogramData } from '../core/histogram';
import { applyCanvasPhotoEdit } from '../core/canvasEdit';
import { applyFix, critique, toneOnlyEdit, type Opinion, type OpinionFigures } from '../core/critique';
import { fullContext, maskAlpha } from '../core/masks';
import { ColourCheckPanel, type ColourPreview } from './ColourCheckPanel';
import { MaskOverlay } from './MaskOverlay';
import { MaskPanel } from './MaskPanel';
import { createSubjectMask, framingKey, onlyAdjustmentsChanged, type SubjectDetail, type SubjectGrid } from '../core/maskTypes';
import { detectSubjectGuided, detectSubjectInArea, type GuidedSubject } from '../providers/subjectDetector';
import { GUIDED_RENDER_EDGE } from '../core/subjectGuide';
import { panToCentre } from '../core/eyeFinder';
import { locateEye } from '../providers/eyeLocator';
import { PresetPanel } from './PresetPanel';
import { mergeAutoSuggestion } from '../core/autoEnhance';
import { describeOutcome, naturalAuto, stageNaturalRecipe } from '../core/naturalAuto';
import { proposeSubjectAwareAuto, type InsightSubjectKind } from '../core/insightSubjectAuto';
import { PANEL_DEFAULT, clampPanelWidth } from '../core/panelWidth';
import { PhotoViewport } from './PhotoViewport';
import { maxZoomFor, stepZoom, zoomForPercent } from '../core/zoomControls';
import { ZoomControls } from './ZoomControls';
import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_EDIT, EDIT_CHOICES, TONE_CONTROLS, DETAIL_CONTROLS, NOISE_CONTROL, isNeutralEdit, isEmptyEdit, type PhotoEdit } from '../core/photoEdits';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';

import { FIT_VIEW, type ViewportTransform } from '../core/viewportTransform';
import { beforeSnapshot, type ComparisonStage } from '../core/compareStages';
import { resolveKeyboardCommand, type KeyBindingsMap } from '../core/keyboardCommands';
import { visiblePhotoDetail } from '../core/visiblePhotoDetail';

const FIT_PREVIEW_EDGE = 2200;
const DIAL_KEYS = [...EDIT_CHOICES.map(({ key }) => key), ...TONE_CONTROLS.map(({ key }) => key), ...DETAIL_CONTROLS.map(({ key }) => key)] as const;
import { isRawPreviewFile } from '../core/rawFormats';
import { tasks } from '../core/taskStore';
import { canDevelopRaw, canExportRawMaster, developRaw, matchPreviewOrientation, rawDngCopy, rawSensorMode, sensorModeLabel, type RawSensorMode } from '../providers/rawDevelop';
import { extractRawPreview } from '../core/nefPreview';
import { exportRaw16Tiff } from '../providers/rawMaster16';
import { isDesktopApp, saveWithDialog } from '../providers/desktopShell';
import { PaidNotice } from './PaidNotice';
import { useAccess } from '../providers/useAccess';
const PANEL_KEY = 'kestrel-panel-width-v1';
const SHEET_KEY = 'kestrel-sheet-v1';
export type EditorTab = 'auto' | 'crop' | 'edit' | 'masks' | 'history' | 'export';
type Tab = EditorTab;
const TABS: { id: Tab; label: string; Icon: typeof Crop }[] = [
  { id: 'auto', label: t.tabs.auto, Icon: Lightbulb },
  { id: 'crop', label: t.tabs.crop, Icon: Crop },
  { id: 'edit', label: t.tabs.edit, Icon: SlidersHorizontal },
  { id: 'masks', label: t.tabs.masks, Icon: SquircleDashed },
  { id: 'history', label: t.tabs.history, Icon: History },
  { id: 'export', label: t.tabs.export, Icon: Download },
];

/** The modifier key people expect on this device, for shortcut hints in tooltips. */
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

/** The quick choices under Exposure, Warmth and Colour, in the order of EDIT_CHOICES' options (-1, 0, +1). */
const CHOICE_WORDS: Record<(typeof EDIT_CHOICES)[number]['key'], readonly string[]> = {
  exposure: [t.choices.darker, t.choices.neutral, t.choices.brighter],
  warmth: [t.choices.cooler, t.choices.neutral, t.choices.warmer],
  colour: [t.choices.softer, t.choices.neutral, t.choices.richer],
};

/** The name `beforeSnapshot` gives a comparison stage, in the session's language. */
function stageLabel(label: string): string {
  if (label === 'Original') return t.common.original;
  if (label === 'Last export') return t.editor.lastExport;
  const step = /^Edit (\d+)$/.exec(label);
  return step ? t.editor.editStep(Number(step[1])) : label;
}

type OpinionText = { title: string; detail: (figures: OpinionFigures) => string; fix?: string };

/** A quality check's words, looked up by its id; an unknown id keeps the words `critique` gave it. */
function opinionWords(opinion: Opinion): { title: string; detail: string; fix: string } {
  const words = (t.critique.opinions as unknown as Record<string, OpinionText | undefined>)[opinion.id];
  if (!words) return { title: opinion.title, detail: opinion.detail, fix: opinion.fixLabel ?? t.common.apply };
  return { title: words.title, detail: words.detail(opinion.figures ?? {}), fix: words.fix ?? t.common.apply };
}

interface Props {
  /** Opens the macro pad settings and how-to, on the Edit tab. */
  onOpenMacroPad?: () => void;
  /** Suggest colour and tone the first time a photo is opened, when the project asked for it. */
  autoEdit?: boolean;
  frame: PhotoFrame;
  /** App-wide camera shared by Review, Compare and Edit: opening tools never moves the photo. */
  viewportTransform?: ViewportTransform;
  onViewportTransform?: (next: ViewportTransform) => void;
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
  /** Shared Section F desktop layout: tools fold into a docked rail. */
  toolsCollapsed?: boolean;
  /** Photo-only mode hides editing chrome without altering edits or zoom. */
  focusPhoto?: boolean;
  /** Phone tool tabs reopen the bottom sheet when the shared panes were folded. */
  onExpandTools?: () => void;
  /** Fold the panes away (the arrow on the tools' edge, or Tab). */
  onFoldTools?: () => void;
  onApplyToKeepers: (edit: PhotoEdit) => void;
  onUndoKeeperEdits?: () => void;
}

export function PhotoEditor({ autoEdit, onOpenMacroPad,
  frame, viewportTransform, onViewportTransform, provider, needsAccess, bindings, onEdit, initialTab, onTabChange, onApplyLook, onExport, exportCount = 1, onExportRequested, onHistoryStep, onHistoryJump, copiedEdit, onCopyEdit, keeperCount,
  onApplyToKeepers, onUndoKeeperEdits, onCreateVirtualCopy, onRemoveVirtualCopy, onFramingChange, onFocusPoint,
  panelSide, onPanelSideChange, hand, onHandChange,
  toolsCollapsed = false, focusPhoto = false, onExpandTools, onFoldTools,
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
  const [masterBusy, setMasterBusy] = useState(false);
  const [masterNote, setMasterNote] = useState<string | null>(null);
  const [dngBusy, setDngBusy] = useState(false);
  /** How each developed RAW's sensor data was stored, by photo, so the label and the DNG option tell the truth. */
  const [sensorModes, setSensorModes] = useState<Record<string, RawSensorMode>>({});
  const sensorMode = sensorModes[frame.stableKey] ?? 'other';
  const [dngNote, setDngNote] = useState<string | null>(null);
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
  const subjectCache = useRef<{ source: HTMLImageElement; cropKey: string; result: GuidedSubject } | null>(null);
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
  // While a mask's sliders move, and for 3 seconds after, the highlight steps aside so it doesn't cover the change.
  const sliderPause = useRef<number | undefined>(undefined);
  const pauseMaskHighlight = () => {
    setSliderBusy(true);
    window.clearTimeout(sliderPause.current);
    sliderPause.current = window.setTimeout(() => setSliderBusy(false), 3000);
  };
  useEffect(() => () => window.clearTimeout(sliderPause.current), []);
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
  const isPhone = !useMediaQuery('(min-width: 900px) and (min-height: 550px), (min-width: 840px) and (min-height: 440px) and (max-height: 549px)');
  // On a phone the tools open as a sheet above the bar. Tapping the open tab again folds it away for a full-height photo.
  const [sheetOpen, setSheetOpen] = useState(() => {
    try { return localStorage.getItem(SHEET_KEY) !== 'closed'; } catch { return true; }
  });
  const toolsHidden = focusPhoto || toolsCollapsed || (isPhone && !sheetOpen);
  const rememberSheet = (open: boolean) => {
    setSheetOpen(open);
    try { localStorage.setItem(SHEET_KEY, open ? 'open' : 'closed'); } catch { /* the sheet still works for this session */ }
  };
  const chooseTab = (id: Tab) => {
    if (toolsCollapsed) {
      onExpandTools?.();
      setTab(id);
      if (isPhone) rememberSheet(true);
      return;
    }
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
      setOrientationNotice(t.editor.rotationLocked);
    }
  };
  // A saved or resized layout can leave the Export tab selected on a screen that has no such tab.
  useEffect(() => { if (!isPhone && tab === 'export') setTab('auto'); }, [isPhone, tab]);
  const cropOpen = tab === 'crop';
  const [previewCrop, setPreviewCrop] = useState(false);
  const [gridLines, setGridLines] = useState(true);
  const [cropNotice, setCropNotice] = useState('');
  const cropDrag = useRef<{ x: number; y: number; anchorX: number; anchorY: number } | null>(null);
  // Drawing a new crop box with a mouse or pen: where it started, in photo pixels and on screen.
  const cropDraw = useRef<{ start: { x: number; y: number }; client: { x: number; y: number }; moved: boolean } | null>(null);
  const edgeDrag = useRef<{ edge: CropEdge; x: number; y: number; point: { x: number; y: number } } | null>(null);
  const [markFocus, setMarkFocus] = useState(false);
  // K.8: the export focus dot shows only while it is being placed or while the Export focus section is open.
  const [exportFocusOpen, setExportFocusOpen] = useState(false);
  // Standalone editor keeps a local camera; the project workspace supplies the
  // shared camera so Review → Edit → Compare retains precisely the same view.
  const [localTransform, setLocalTransform] = useState<ViewportTransform>(FIT_VIEW);
  const transform = viewportTransform ?? localTransform;
  const setTransform = (next: ViewportTransform | ((current: ViewportTransform) => ViewportTransform)) => {
    const updated = typeof next === 'function' ? next(transform) : next;
    if (onViewportTransform) onViewportTransform(updated);
    else setLocalTransform(updated);
  };
  const [eyeNote, setEyeNote] = useState<string | null>(null);
  const [findingEye, setFindingEye] = useState(false);
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
      const url = await provider.getFullPreviewUrl(frame, 'selected');
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
    const task = tasks.start(t.raw.developingTask(frame.filename));
    try {
      const key = frame.stableKey;
      const result = await provider.developFromOriginal(key, async (original) => {
        const mode = await rawSensorMode(original, frame.filename);
        setSensorModes((modes) => modes[key] === mode ? modes : { ...modes, [key]: mode });
        const developed = await developRaw(original, /\.([a-z0-9]+)$/i.exec(frame.filename)?.[1] ?? 'nef');
        return matchPreviewOrientation(developed, await extractRawPreview(original).catch(() => null));
      });
      if (result === 'missing') {
        const message = t.raw.reconnectFirst;
        setDevelopNote(message);
        task.fail(message);
        return;
      }
      if (result === 'superseded') {
        task.finish(t.raw.superseded);
        return;
      }
      task.finish();
      setDevelopedRev((count) => count + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : t.raw.developFailed;
      setDevelopNote(t.raw.developFailedNote(message));
      task.fail(message);
    } finally { setDeveloping(false); }
  }


  /**
   * MVP proof: export edited RGB16 TIFF directly from the original RAW. No
   * JPEG/HTML canvas intermediary, and never discard an unsupported adjustment.
   * This is intentionally an explicit test export, not the default master.
   */
  async function exportHighPrecisionMaster() {
    if (masterBusy) return;
    setMasterBusy(true);
    setMasterNote(null);
    const task = tasks.start(t.raw.masterTask);
    try {
      if (previewRecipe || pendingAuto) {
        throw new Error(t.raw.masterApplyFirst);
      }
      if (!source) throw new Error(t.raw.masterWait);
      const original = await provider.ensureOriginal(frame.stableKey);
      if (!original) throw new Error(t.raw.masterReconnect);
      const output = await exportRaw16Tiff(original, source, frame.edit ?? DEFAULT_EDIT, frame.framing);
      const name = frame.filename.replace(/\.[^.]+$/, '') + '_16bit.tif';
      // The browser hands the file to its own downloads; the desktop app asks where to save it.
      const saved = isDesktopApp() ? await saveWithDialog(output, name) : (downloadExport(output, name), true);
      if (saved) {
        setMasterNote(t.raw.masterSaved);
        task.finish(t.raw.masterSavedTask);
      } else {
        setMasterNote(t.raw.masterCancelled);
        task.finish(t.raw.cancelledTask);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t.raw.masterFailed;
      setMasterNote(message);
      task.fail(message);
    } finally {
      setMasterBusy(false);
    }
  }


  /** Save a lossless DNG of a Nikon High Efficiency RAW beside wherever the person chooses. The original is only read. */
  async function saveDngCopy() {
    if (dngBusy) return;
    setDngBusy(true);
    setDngNote(null);
    const task = tasks.start(t.raw.dngTask);
    try {
      const original = await provider.ensureOriginal(frame.stableKey);
      if (!original) throw new Error(t.raw.dngReconnect);
      const dng = await rawDngCopy(original);
      const saved = await saveWithDialog(dng, frame.filename.replace(/\.[^.]+$/, '') + '.dng');
      setDngNote(saved ? t.raw.dngSaved : t.raw.dngCancelled);
      task.finish(saved ? t.raw.dngSavedTask : t.raw.cancelledTask);
    } catch (error) {
      const message = error instanceof Error ? error.message : t.raw.dngFailed;
      setDngNote(message);
      task.fail(message);
    } finally {
      setDngBusy(false);
    }
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
  const beforeLabel = stageLabel(before.label);
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
  /**
   * Zoom to the subject's eye: the subject is found as for masks, then the eye is looked for inside it. Only the view
   * moves; nothing is decided about focus, and when no eye stands out the view stays where it is.
   */
  async function zoomToEye() {
    if (findingEye || !source || !outputSize || !position || !fit) return;
    setFindingEye(true);
    setEyeNote(null);
    const startedFor = source;
    try {
      const framed = document.createElement('canvas');
      drawFramedPhoto(source, framed, framing, { scale: Math.min(1, GUIDED_RENDER_EDGE / Math.max(outputSize.width, outputSize.height)) });
      const cropKey = framingKey(framing);
      const cached = subjectCache.current?.source === source && subjectCache.current?.cropKey === cropKey ? subjectCache.current.result : null;
      const { eye, note, subject } = await locateEye(framed, cached);
      if (!cached && subject) subjectCache.current = { source, cropKey, result: subject };
      if (sourceImage.current !== startedFor) return;
      setEyeNote(note);
      if (!eye) return;
      const zoom = Math.max(1, Math.min(maxZoom, zoomForPercent(200, fit, dpr)));
      setTransform({ zoom, pan: panToCentre(eye, { width: position.width, height: position.height }, zoom) });
    } catch (error) {
      setEyeNote(error instanceof Error ? error.message : t.editor.eyeFailed);
    } finally {
      setFindingEye(false);
    }
  }
  useEffect(() => {
    if (!eyeNote) return;
    const timer = window.setTimeout(() => setEyeNote(null), 5000);
    return () => window.clearTimeout(timer);
  }, [eyeNote]);

  // The bottom bar (App) holds a place for the zoom controls, so they sit where culling has them.
  const [zoomSlot, setZoomSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setZoomSlot(document.getElementById('viewer-zoom-slot')); }, []);
  // The top row (App) holds a place for Export. Photo-only view removes the row, so look again when that changes.
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setHeaderSlot(document.getElementById('editor-header-actions')); }, [focusPhoto]);

  // Holding Shift shows the thirds grid, wherever the pointer is. Letting go, or leaving the window, hides it again.
  const [showGrid, setShowGrid] = useState(false);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === 'Shift' && !event.repeat && !target?.closest('input, textarea, select, [contenteditable="true"]')) setShowGrid(true);
    };
    const up = (event: KeyboardEvent) => { if (event.key === 'Shift') setShowGrid(false); };
    const away = () => setShowGrid(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', away);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', away); };
  }, []);

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
        case 'edit.copy': onCopyEdit(edit); setEditNotice(t.editor.adjustmentsCopied); break;
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

  // Opening the crop tab shows the whole photo with the crop box. Remember the crop so Cancel can put it back.
  useEffect(() => {
    setPreviewCrop(false);
    // Switching tool tabs must not move the photographer away from a detail at 100% or 200%.
    autoRun.current += 1;
    setAutoAnalysing(false);
    setPreviewRecipe(null);
    setPendingAuto(null);
    setOpinions(null);
    // Each tab opens at its top. Otherwise the new tab inherits the old scroll position and starts under the tab bar.
    panelScroll.current?.scrollTo({ top: 0 });
    if (tab === 'crop') cropEntry.current = frame.framing ?? DEFAULT_FRAMING;
    else setMarkFocus(false);
    // The Export focus section closes when its tab goes away, so its dot must go too.
    setExportFocusOpen(false);
    // Only when the tab changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Before/After uses the existing viewport camera; changing comparison must not move it.

  // Until camera-matched colour and 16-bit RAW-to-view fidelity are verified, do
  // not silently replace a faithful in-camera preview with a generic RAW look.
  // A photographer can explicitly develop from the RAW options below; this
  // never writes or modifies the original file.

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

  /**
   * Natural Auto: analyse the framed, unedited photo on this device, measure the subject when a trustworthy mask
   * exists, choose ordinary reversible slider values, then render and check them before offering a preview.
   * Nothing is saved until the photographer applies it.
   */
  async function previewAutoSuggestion() {
    const run = ++autoRun.current;
    const startedFor = detectionContext.current;
    const originalSource = source;
    setAutoAnalysing(true);
    setPendingAuto(null);
    setPreviewRecipe(null);
    setOpinions(null);
    setAutoNotes([t.auto.analysing]);
    const stillCurrent = () => run === autoRun.current && detectionContext.current === startedFor &&
      sourceImage.current === originalSource && Boolean(originalSource);
    try {
      if (!originalSource || !outputSize || !startedFor) {
        if (run === autoRun.current) setAutoNotes([t.auto.couldNotAnalyse]);
        return;
      }
      // Analyse exactly the unedited, framed image (crop and rotation applied), not the adjusted editor canvas.
      const analysisCanvas = document.createElement('canvas');
      drawFramedPhoto(originalSource, analysisCanvas, frame.framing ?? DEFAULT_FRAMING, {
        scale: Math.min(1, 640 / Math.max(outputSize.width, outputSize.height)),
      });
      const analysisContext = analysisCanvas.getContext('2d', { willReadFrequently: true });
      if (!analysisContext || analysisCanvas.width < 16 || analysisCanvas.height < 16) {
        if (stillCurrent()) setAutoNotes([t.auto.tooSmall]);
        return;
      }
      const analysis = analysisContext.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
      const category = autoSubjectKind();
      let segmentation: { grid: SubjectGrid; confidence: 'high' | 'medium' | 'low'; detail?: SubjectDetail | null } | null = null;
      let subjectNote = '';
      if (category !== 'landscape') {
        try {
          let detection = subjectCache.current?.source === originalSource && subjectCache.current?.cropKey === cropKey
            ? subjectCache.current.result : null;
          if (!detection) {
            // Slow or broken inference must not hold the editing workflow hostage.
            let timeout: number | undefined;
            try {
              // The detector steers the outline to small, distant subjects; it falls back to the whole photo by itself.
              const guideCanvas = document.createElement('canvas');
              drawFramedPhoto(originalSource, guideCanvas, frame.framing ?? DEFAULT_FRAMING, {
                scale: Math.min(1, GUIDED_RENDER_EDGE / Math.max(outputSize.width, outputSize.height)),
              });
              detection = await Promise.race([
                detectSubjectGuided(guideCanvas),
                new Promise<never>((_, reject) => {
                  timeout = window.setTimeout(() => reject(new Error('Subject analysis timed out')), 12000);
                }),
              ]);
            } finally { if (timeout !== undefined) window.clearTimeout(timeout); }
            if (stillCurrent()) subjectCache.current = { source: originalSource, cropKey, result: detection };
          }
          if (!stillCurrent()) return;
          if (detection.assessment.usable) segmentation = { grid: detection.grid, confidence: detection.assessment.confidence, detail: detection.detail };
          else subjectNote = t.auto.subjectUncertain;
        } catch {
          if (!stillCurrent()) return;
          subjectNote = t.auto.subjectUnavailable;
        }
      } else {
        subjectNote = t.auto.atmosphere;
      }
      const natural = naturalAuto({
        pixels: analysis.data, width: analysis.width, height: analysis.height, segmentation, iso: frame.exif?.iso,
      });
      if (natural.notes.includes('This preview is too small or too large to analyse.')) {
        if (stillCurrent()) setAutoNotes([t.auto.notAnalysed]);
        return;
      }
      let proposal = mergeAutoSuggestion(savedEdit, natural.edit).edit;
      let usedMask = false;
      if (segmentation) {
        const local = proposeSubjectAwareAuto({
          pixels: analysis.data, width: analysis.width, height: analysis.height, edit: proposal,
          subjectKind: category, segmentation, maskId: newId(), framingKey: cropKey, extra: natural.subjectEdit,
        });
        proposal = local.edit;
        usedMask = local.usedMask;
        subjectNote = local.usedMask ? local.reason : t.auto.noLocalAdjustment(local.reason);
      }
      // Render and check before offering: full strength, then gentler, then nothing.
      const staged = stageNaturalRecipe(analysis.data, analysis.width, analysis.height, savedEdit, proposal, segmentation);
      if (!stillCurrent()) return;
      const changed = staged.outcome === 'full' || staged.outcome === 'gentler';
      const keptMask = changed && (staged.edit.masks?.length ?? 0) > (savedEdit.masks?.length ?? 0);
      setPendingAuto(changed ? { base: savedEdit, edit: staged.edit, cropKey, source: originalSource } : null);
      setPreviewRecipe(changed ? { edit: staged.edit, framing: frame.framing } : null);
      setAutoNotes([
        changed
          ? keptMask
            ? t.auto.previewingWithMask
            : t.auto.previewingLook
          : staged.outcome === 'declined'
            ? t.auto.declined
            : t.auto.alreadyWorks,
        describeOutcome(staged.outcome, staged.reason),
        ...natural.notes.filter((note) => !note.includes('already works')),
        usedMask || subjectNote ? subjectNote : '',
      ].filter(Boolean));
    } catch {
      if (stillCurrent()) setAutoNotes([t.auto.failed]);
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

  /** A small before/after preview for the colour check, with the subject outline when there is one. */
  function colourPreview(): ColourPreview | null {
    if (!source || !outputSize) return null;
    const scale = Math.min(1, 160 / Math.max(outputSize.width, outputSize.height));
    const draw = (withEdit: boolean) => {
      const canvas = document.createElement('canvas');
      drawFramedPhoto(source, canvas, framing, { scale });
      if (withEdit) applyCanvasPhotoEdit(canvas, edit);
      const image = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
      return { data: image.data, width: image.width, height: image.height };
    };
    const before = draw(false);
    const after = draw(true);
    const mask = edit.masks?.find((candidate) => candidate.kind === 'subject');
    const subject = mask ? maskAlpha({ ...mask, invert: false }, after.width, after.height, fullContext(after.width, after.height)) : undefined;
    return { before, after, subject };
  }

  /** The photo as edited, 1,024 pixels on its longest side, as a JPEG drawn from the canvas (so it carries no metadata). */
  function reviewJpeg(): string | null {
    if (!source || !outputSize) return null;
    const canvas = document.createElement('canvas');
    drawFramedPhoto(source, canvas, framing, { scale: Math.min(1, 1024 / Math.max(outputSize.width, outputSize.height)) });
    applyCanvasPhotoEdit(canvas, edit);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? null;
  }

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
    catch { setAutoNotes((notes) => [...notes, t.auto.qualityUnavailable]); }
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
      const framed = document.createElement('canvas');
      drawFramedPhoto(source, framed, framing, { scale: Math.min(1, GUIDED_RENDER_EDGE / Math.max(outputSize.width, outputSize.height)) });
      const { grid, assessment, guide, detail } = await detectSubjectGuided(framed);
      if (detectionContext.current !== startedFor) {
        if (detectionContext.current) setDetectNotice(t.masks.editsChangedFind);
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
          ? { ...mask, grid, detail: detail ?? undefined, framingKey: key, confidence: assessment.confidence, strokes: [] } : mask) });
      } else {
        const mask = { ...createSubjectMask(newId(), grid, key, assessment.confidence, detail), invert: background };
        onEdit({ ...edit, masks: [...masks, mask] });
        setSelectedMaskId(mask.id);
        setShowMaskOverlay(true);
      }
      setDetectNotice(guide ? t.masks.traced(assessment.reason) : assessment.reason);
    } catch (error) {
      if (detectionContext.current === startedFor) {
        setDetectNotice(error instanceof Error ? error.message : t.masks.detectionFailed);
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
      const { grid, assessment, detail } = await detectSubjectInArea(piece, bounds, preview.height / preview.width);
      if (detectionContext.current !== startedFor) {
        if (detectionContext.current) setDetectNotice(t.masks.editsChangedArea);
        return;
      }
      if (!assessment.usable) { setDetectNotice(assessment.reason); return; }
      const mask = createSubjectMask(newId(), grid, framingKey(framing), assessment.confidence, detail);
      onEdit({ ...edit, masks: [...(edit.masks ?? []), mask] });
      setSelectedMaskId(mask.id);
      setShowMaskOverlay(true);
      setDetectNotice(assessment.reason);
    } catch (error) {
      if (detectionContext.current === startedFor) setDetectNotice(error instanceof Error ? error.message : t.masks.detectionFailed);
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
      setCropNotice(t.crop.noHorizon);
      return;
    }
    onFramingChange({ ...framing, straighten: correction });
    setCropNotice(correction ? t.crop.straightened(correction) : t.crop.alreadyLevel);
  }

  /** One tab bar. On a phone it is a bottom toolbar of large icons, and on wider screens the top of the side panel. */
  // On a phone Export is the last tab in the bottom bar. On a wider screen it is a button in the header instead,
  // which leaves the side panel's tabs with room to breathe.
  const visibleTabs = isPhone ? TABS : TABS.filter((entry) => entry.id !== 'export');
  const tabList = (
    <div role="tablist" aria-label={t.editor.tablist}
      className={isPhone
        ? 'grid shrink-0 grid-cols-6 border-t border-white/10 bg-kestrel-panel pb-[env(safe-area-inset-bottom)]'
        : 'sticky top-0 z-20 -mx-3 flex overflow-x-auto border-b border-white/10 bg-kestrel-panel px-2 workspace:-mx-4 workspace:px-3'}
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
        <button key={id} id={`tab-${id}`} role="tab" type="button" aria-label={label} title={label} aria-selected={tab === id} aria-controls={`panel-${id}`} tabIndex={tab === id ? 0 : -1}
          aria-expanded={isPhone ? sheetOpen && tab === id : undefined}
          onClick={() => chooseTab(id)}
          className={isPhone
            ? 'relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden px-0.5 text-xs text-zinc-300 focus-visible:outline-2 focus-visible:outline-sky-300 aria-selected:text-white aria-selected:after:absolute aria-selected:after:top-0 aria-selected:after:h-0.5 aria-selected:after:w-10 aria-selected:after:bg-sky-200'
            : 'flex min-h-14 flex-1 shrink-0 flex-col items-center justify-center gap-1 border-b-2 border-transparent px-2 text-xs text-zinc-300 hover:text-white focus-visible:outline-2 focus-visible:outline-sky-300 aria-selected:border-sky-200 aria-selected:text-white'}>
          <Icon className="h-5 w-5" aria-hidden="true" />
          <span className="w-full truncate text-center max-[420px]:sr-only">{label}{id === 'masks' && edit.masks?.length ? <span className="ml-1 text-xs tabular-nums text-zinc-400">{edit.masks.length}</span> : null}</span>
        </button>
      ))}
    </div>
  );

  const button = 'min-h-11 rounded-md px-3 text-sm text-zinc-200 hover:bg-white/8 disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-sky-400';
  return (
    <section aria-label={t.editor.region} className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden bg-kestrel-stage">
      {/* On a phone, Quick adjust has Undo, Redo and Before/After within thumb reach, so this row would only repeat them. */}
      {!focusPhoto && !(isPhone && tab === 'edit' && sheetOpen && !allControls && !(canLockOrientation && fullscreen)) && <div role="toolbar" aria-label={t.editor.toolbar} className="mobile-toolbar-scroll flex min-w-0 max-w-full shrink-0 items-center justify-between gap-2 overflow-x-auto border-b border-white/10 bg-kestrel-panel px-2 pt-0.5 sm:px-4">
        <div className="flex items-center gap-1">
          <button type="button" className={`${button} inline-flex items-center`} aria-label={m.undo} title={t.editor.undoTitle(MOD)} disabled={!frame.editHistory?.cursor} onClick={() => onHistoryStep(-1)}>
            <Undo2 className="h-4 w-4" aria-hidden="true" /><span className="sr-only sm:not-sr-only sm:ml-1.5">{m.undo}</span>
          </button>
          <button type="button" className={`${button} inline-flex items-center`} aria-label={m.redo} title={t.editor.redoTitle(MOD)} disabled={!frame.editHistory || frame.editHistory.cursor >= frame.editHistory.steps.length} onClick={() => onHistoryStep(1)}>
            <Redo2 className="h-4 w-4" aria-hidden="true" /><span className="sr-only sm:not-sr-only sm:ml-1.5">{m.redo}</span>
          </button>
          <button type="button" aria-pressed={displayCompare} disabled={sourceState !== 'ready' || guide} onClick={() => setCompare(!compare)}
            title={t.editor.compareTitle}
            className={`${button} inline-flex items-center gap-1.5 border border-white/15 aria-pressed:border-sky-300 aria-pressed:bg-sky-300/20 aria-pressed:text-sky-100`}>
            <Columns2 className="h-4 w-4" aria-hidden="true" />
            <span className="max-[420px]:sr-only">{t.editor.beforeAfter}</span>
            <span className="rounded bg-black/40 px-1.5 text-xs max-[420px]:sr-only">{displayCompare ? t.editor.on : t.editor.off}</span>
          </button>
          {displayCompare && (
            <label className="min-w-0">
              <span className="sr-only">{t.editor.beforeStage}</span>
              <select aria-label={t.editor.beforeStage} value={beforeStage}
                onChange={(event) => setBeforeStage(event.target.value as ComparisonStage)}
                className="h-11 max-w-[145px] rounded-md border border-white/15 bg-kestrel-panel px-1 text-xs text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-300 sm:max-w-[205px]">
                <option value="original">{t.common.original}</option>
                <option value="previous" disabled={!frame.editHistory?.cursor}>{t.editor.previousEdit}</option>
                <option value="last-export" disabled={!frame.lastExport}>{t.editor.lastExport}</option>
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
        {/* Zoom lives in the bottom bar with the photo navigation, in the same place as in culling (ZoomControls). */}
        {fit > 0 && (() => {
          const controls = <ZoomControls zoom={transform.zoom} fit={fit} dpr={dpr} maxZoom={maxZoom} onZoom={zoomTo} note={eyeNote}
            eye={{ onClick: () => void zoomToEye(), busy: findingEye, disabled: findingEye || sourceState !== 'ready', title: t.editor.eyeTitle }} />;
          return zoomSlot ? createPortal(controls, zoomSlot) : controls;
        })()}
        {/* Settings is in the top right corner of every page (App). */}
        {canLockOrientation && fullscreen && (
          <button type="button" className={`${button} inline-flex items-center border border-white/15`}
            aria-pressed={landscapeLocked} onClick={() => void toggleLandscape()}
            title={t.editor.landscapeTitle}>
            {landscapeLocked ? t.editor.autoRotate : t.editor.landscape}
          </button>
        )}
        {/* Full screen lives in one place, the filmstrip bar (FilmstripDock), in the editor and culling alike. */}
        {/* Export sits in the top row, where the library has it. */}
        {headerSlot ? createPortal(<>
        <button type="button" disabled={sourceState !== 'ready'} onClick={openExport} title={exportCount > 1 ? t.editor.exportSelectedTitle(exportCount) : t.editor.exportTitle}
          className={`${button} hidden items-center gap-1.5 bg-kestrel-copper font-semibold !text-zinc-950 hover:bg-kestrel-copper-hover! workspace:inline-flex`}>
          <Download className="h-4 w-4" aria-hidden="true" />{exportCount > 1 ? t.editor.exportCount(exportCount) : t.editor.export}
        </button>
        </>, headerSlot) : <>
        <button type="button" disabled={sourceState !== 'ready'} onClick={openExport} title={exportCount > 1 ? t.editor.exportSelectedTitle(exportCount) : t.editor.exportTitle}
          className={`${button} hidden items-center gap-1.5 bg-kestrel-copper font-semibold !text-zinc-950 hover:bg-kestrel-copper-hover! workspace:inline-flex`}>
          <Download className="h-4 w-4" aria-hidden="true" />{exportCount > 1 ? t.editor.exportCount(exportCount) : t.editor.export}
        </button>
        </>}

        </div>
      </div>}
      <div data-testid="editor-responsive-layout" className="kestrel-editor-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden workspace:flex-row">
      <div ref={stage} data-photo-stage tabIndex={0} aria-label={t.editor.canvas} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-black focus-visible:outline-2 focus-visible:outline-sky-300">
        <PhotoViewport zoom={transform.zoom} pan={transform.pan} maxZoom={maxZoom} showZoomButton={false}
          onTransform={(zoom, pan) => setTransform({ zoom, pan })}
          overlayMode={displayCompare ? 'wipe' : 'hidden'}
          labels={displayCompare ? [beforeLabel, t.editor.now] : undefined}
          base={<>
            <canvas ref={editedCanvas} aria-label={t.editor.editedPhoto} role="img"
              hidden={sourceState !== 'ready'} className={position ? "absolute" : "absolute inset-0 h-full w-full object-contain"} style={position} />
            {detail && <canvas ref={editedDetail} aria-hidden="true" hidden={!showDetail}
              className="absolute" style={detail.style} />}
            {/* A 3 × 3 thirds grid while the pointer is over the photo (not on touch screens). It follows the Gridlines
                switch in Crop, stays out of the way of Before/After, takes no clicks, and zooms with the photo. Holding
                Shift shows it at any time, Before/After included. */}
            {!guide && position && sourceState === 'ready' && (showGrid || (gridLines && !displayCompare)) && <div aria-hidden="true" data-testid="thirds-grid"
              className={`${showGrid ? '' : 'thirds-hover'} crop-thirds pointer-events-none absolute`} style={position} />}
            {!guide && position && markFocus && <button type="button" aria-label={t.editor.placeFocus} title={t.editor.placeFocus}
              className="absolute z-10 cursor-crosshair focus-visible:outline-2 focus-visible:outline-sky-200" style={position}
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                const clamp = (value: number) => Math.min(1, Math.max(0, value));
                onFocusPoint(event.detail ? { x: clamp((event.clientX - bounds.left) / bounds.width),
                  y: clamp((event.clientY - bounds.top) / bounds.height) } : { x: 0.5, y: 0.5 });
                setMarkFocus(false);
              }} />}
            {!guide && position && (markFocus || exportFocusOpen) && frame.focusPoint && <span aria-hidden="true" data-testid="export-focus-dot"
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
            {/* Drag across the photo with a mouse or pen to draw a new crop box. Touch keeps pinch and pan; the handles
                work everywhere. */}
            {cropRect && position && size && <div data-testid="crop-draw-surface" aria-hidden="true" className="absolute cursor-crosshair" style={position}
              onPointerDown={(event) => {
                if (event.button !== 0 || event.pointerType === 'touch') return;
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                const bounds = event.currentTarget.getBoundingClientRect();
                cropDraw.current = {
                  start: { x: (event.clientX - bounds.left) / bounds.width * size.width, y: (event.clientY - bounds.top) / bounds.height * size.height },
                  client: { x: event.clientX, y: event.clientY }, moved: false,
                };
              }}
              onPointerMove={(event) => {
                const draw = cropDraw.current;
                if (!draw || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                // A click, or a wobble of a few pixels, never replaces the crop.
                if (!draw.moved && Math.hypot(event.clientX - draw.client.x, event.clientY - draw.client.y) < 6) return;
                draw.moved = true;
                const bounds = event.currentTarget.getBoundingClientRect();
                onFramingChange(drawCrop(size.width, size.height, framing, draw.start,
                  { x: (event.clientX - bounds.left) / bounds.width * size.width, y: (event.clientY - bounds.top) / bounds.height * size.height }));
              }}
              onLostPointerCapture={() => { cropDraw.current = null; }}
              onDoubleClick={(event) => event.stopPropagation()} />}
            {cropRect && <div style={cropRect}
              className={`crop-guide absolute border border-white/90 ${gridLines ? 'crop-thirds' : ''} ${framing.ratio && !(outputSize && size && outputSize.width >= size.width - 1 && outputSize.height >= size.height - 1) ? 'cursor-move' : 'pointer-events-none'}`}
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
                                const apply = (target: { x: number; y: number }) => onFramingChange(resizeCrop(size.width, size.height, framing, corner, target));
                return (
                  <button key={corner} type="button" aria-label={t.crop.corner(t.crop.corners[corner])} title={t.crop.cornerTitle}
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
              {outputSize && size && fit > 0 && cropRect && (['top', 'bottom', 'left', 'right'] as CropEdge[])
                // Only where there is room between the corner handles.
                .filter((edge) => (edge === 'top' || edge === 'bottom' ? cropRect.width : cropRect.height) >= 132)
                .map((edge) => {
                  const across = edge === 'top' || edge === 'bottom';
                  const point = {
                    x: outputSize.x + (edge === 'right' ? outputSize.width : edge === 'left' ? 0 : outputSize.width / 2),
                    y: outputSize.y + (edge === 'bottom' ? outputSize.height : edge === 'top' ? 0 : outputSize.height / 2),
                  };
                  const apply = (target: { x: number; y: number }) => onFramingChange(resizeCropEdge(size.width, size.height, framing, edge, target));
                  return (
                    <button key={edge} type="button" aria-label={t.crop.edge(t.crop.edges[edge])} title={t.crop.edgeTitle}
                      className="pointer-events-auto absolute grid h-11 w-11 touch-none place-items-center focus-visible:outline-none"
                      style={{
                        ...(across ? { left: '50%', marginLeft: -22, [edge]: -22 } : { top: '50%', marginTop: -22, [edge]: -22 }),
                        cursor: across ? 'ns-resize' : 'ew-resize',
                      }}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        edgeDrag.current = { edge, x: event.clientX, y: event.clientY, point };
                      }}
                      onPointerMove={(event) => {
                        const start = edgeDrag.current;
                        if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                        const scale = fit * transform.zoom;
                        apply({ x: start.point.x + (event.clientX - start.x) / scale, y: start.point.y + (event.clientY - start.y) / scale });
                      }}
                      onLostPointerCapture={() => { edgeDrag.current = null; }}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        const step = size.width * (event.shiftKey ? 0.05 : 0.01);
                        const delta = across
                          ? { ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key as 'ArrowUp' | 'ArrowDown']
                          : { ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[event.key as 'ArrowLeft' | 'ArrowRight'];
                        if (!delta) return;
                        event.preventDefault();
                        event.stopPropagation();
                        apply({ x: point.x + delta[0], y: point.y + delta[1] });
                      }}>
                      <span className={`${across ? 'h-1.5 w-5' : 'h-5 w-1.5'} border border-white bg-white/90 shadow-[0_0_0_1.5px_#000]`} />
                    </button>
                  );
                })}
            </div>}
          </>}
          overlay={<>
            <canvas ref={originalCanvas} aria-label={t.editor.beforePhoto(beforeLabel)} role="img"
              className={position ? "absolute" : "absolute inset-0 h-full w-full object-contain"} style={position} />
            {detail && displayCompare && <canvas ref={originalDetail} aria-hidden="true" hidden={!showDetail}
              className="absolute" style={detail.style} />}
          </>}
        />
        {sourceState !== 'ready' && (
          <p role="status" className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-zinc-300">
            {sourceState === 'loading' ? t.editor.opening : needsAccess ? t.editor.reconnect : t.editor.noPreview}
          </p>
        )}
      </div>
      {!toolsHidden && <PanelResizer width={panelWidth} side={panelSide} onChange={setPanelWidth} />}
      <div ref={panelScroll} onInput={(event) => {
        if (tab !== 'masks' || !(event.target instanceof HTMLInputElement) || event.target.type !== 'range') return;
        setSliderBusy(true);
        window.clearTimeout(sliderTimer.current);
        sliderTimer.current = window.setTimeout(() => setSliderBusy(false), 700);
      }} style={{ '--panel-w': `${panelWidth}px` } as React.CSSProperties} className={`${toolsHidden ? 'hidden ' : ''}scroll-pt-14 max-h-[46%] shrink-0 space-y-2 overflow-y-auto border-t border-white/10 bg-kestrel-panel p-3 pt-0 workspace:relative workspace:z-10 workspace:max-h-none workspace:w-[var(--panel-w)] workspace:border-t-0 workspace:p-4 workspace:pt-0 ${panelSide === 'left' ? 'workspace:order-[-9999] workspace:border-r' : 'workspace:border-l'}`}>
        {!isPhone && <div className="sticky top-0 z-20 -mx-3 flex items-stretch bg-kestrel-panel workspace:-mx-4">
          {onFoldTools && <button type="button" onClick={onFoldTools} aria-label={t.editor.fold} title={t.editor.foldTitle}
            className={`grid w-9 shrink-0 place-items-center border-b border-white/10 text-zinc-400 hover:bg-white/8 hover:text-white focus-visible:outline-2 focus-visible:outline-sky-300 ${panelSide === 'left' ? 'order-last' : ''}`}>
            {panelSide === 'left' ? <ChevronLeft className="h-5 w-5" aria-hidden="true" /> : <ChevronRight className="h-5 w-5" aria-hidden="true" />}
          </button>}
          <div className="min-w-0 flex-1 [&>[role=tablist]]:mx-0 [&>[role=tablist]]:static">{tabList}</div>
        </div>}
        {tab === 'auto' && !can('autoTab') && (
          <div role="tabpanel" id="panel-auto" aria-labelledby="tab-auto"><PaidNotice title={t.auto.paidTitle}>{t.auto.paidBody}</PaidNotice></div>
        )}
        {tab === 'auto' && can('autoTab') && (
          <div role="tabpanel" id="panel-auto" aria-labelledby="tab-auto" className="space-y-2">
        <div className="space-y-2 px-1">
          <button type="button" title={t.auto.suggestTitle} disabled={sourceState !== 'ready' || autoAnalysing}
            className={`${button} inline-flex w-full items-center justify-center gap-2 border border-white/10 font-semibold`}
            onClick={() => void previewAutoSuggestion()}>
            <Lightbulb className="h-4 w-4 stroke-[1.75]" aria-hidden="true" />{autoAnalysing ? t.auto.analysingButton : t.auto.suggest}
          </button>
          <p className="text-xs text-zinc-400">{t.auto.intro}</p>
          {pendingAuto && (
            <div role="group" aria-label={t.auto.previewGroup} className="space-y-2 rounded-lg border border-white/15 bg-white/5 p-3">
              <p role="status" className="text-sm text-zinc-100">{t.auto.previewing}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" aria-pressed={displayCompare} className={`${button} border border-white/15 aria-pressed:bg-sky-300/15`}
                  onClick={() => setCompare((current) => !current)}>{displayCompare ? t.auto.hideComparison : t.auto.compare}</button>
                <button type="button" className={`${button} bg-kestrel-copper font-semibold !text-zinc-950 hover:bg-kestrel-copper-hover!`}
                  onClick={() => {
                    if (savedEdit !== pendingAuto.base || cropKey !== pendingAuto.cropKey || sourceImage.current !== pendingAuto.source) {
                      setAutoNotes([t.auto.photoChanged]);
                    } else {
                      onEdit(pendingAuto.edit);
                      setAutoNotes([t.auto.applied]);
                    }
                    autoRun.current += 1;
                    setPendingAuto(null);
                    setPreviewRecipe(null);
                  }}>{t.auto.apply}</button>
                <button type="button" className={`${button} border border-white/15`} onClick={() => {
                  autoRun.current += 1;
                  setAutoAnalysing(false);
                  setPendingAuto(null);
                  setPreviewRecipe(null);
                  setOpinions(null);
                  setAutoNotes([t.auto.dismissed]);
                }}>{t.auto.keepCurrent}</button>
              </div>
            </div>
          )}
        </div>
          {autoNotes.length > 0 && <ul role="status" className="list-disc space-y-0.5 pl-4 pt-1 text-xs text-zinc-300">
            {autoNotes.map((note) => <li key={note}>{note}</li>)}
          </ul>}
          {autoNotes.length > 0 && !pendingAuto && <p className="px-1 text-xs text-zinc-400">{t.auto.saveAsRecipe}</p>}
          {opinions && (
            <section aria-label={t.critique.region} className="space-y-2 rounded-md border border-white/10 p-2">
              {opinions.length === 0 && <p role="status" className="text-sm text-zinc-300">{t.critique.none}</p>}
              {opinions.map((opinion) => {
                const words = opinionWords(opinion);
                return (
                <div key={opinion.id} className="space-y-1 text-sm">
                  <p className="font-semibold text-zinc-100">{opinion.severity === 'warning' ? t.critique.warning(words.title) : t.critique.tip(words.title)}</p>
                  <p className="text-xs text-zinc-300">{words.detail}</p>
                  {opinion.fix && !pendingAuto && (
                    <button type="button" className={`${button} border border-white/15 text-xs`}
                      onClick={() => onEdit(applyFix(edit, opinion.fix!))}>{words.fix}</button>
                  )}
                </div>
                );
              })}
              <button type="button" className="min-h-9 text-xs text-zinc-400 underline hover:text-white" onClick={() => setOpinions(null)}>{t.critique.hide}</button>
            </section>
          )}
        <section aria-label={t.auto.recipesRegion} className="space-y-1 border-t border-white/10 pt-2">
          <h3 className="text-sm font-medium text-zinc-100">{t.auto.recipes}</h3>
          <PresetPanel edit={edit} disabled={sourceState !== 'ready'} previewSource={lookPreviewSource} onApply={(next) => (onApplyLook ?? onEdit)({ ...next, ...(edit.masks ? { masks: edit.masks } : {}) })} />
        </section>
        <Histogram data={histogram} teach />

          </div>
        )}
        {tab === 'export' && (
          <div role="tabpanel" id="panel-export" aria-labelledby="tab-export" className="space-y-2 px-1 pt-2">
            <p className="text-sm text-zinc-300">{t.exportTab.intro}</p>
            <button type="button" disabled={sourceState !== 'ready'} className={`${button} w-full border border-white/10 font-semibold`} onClick={openExport}>
              {t.exportTab.choose}
            </button>
          </div>
        )}
        {tab === 'edit' && (
          <div role="tabpanel" id="panel-edit" aria-labelledby="tab-edit" className="space-y-2">
        {isPhone && (allControls ? (
          <button type="button" className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-white/12 px-3 text-xs text-zinc-200 hover:bg-white/10" onClick={() => setAllControls(false)}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />{t.edit.backToQuick}
          </button>
        ) : (
          <QuickAdjust edit={edit} disabled={sourceState !== 'ready'} onEdit={onEdit}
            canStepBack={Boolean(frame.editHistory?.cursor)} canStepForward={Boolean(frame.editHistory && frame.editHistory.cursor < frame.editHistory.steps.length)}
            onStepBack={() => onHistoryStep(-1)} onStepForward={() => onHistoryStep(1)} peeking={displayCompare} onPeek={() => setCompare(!compare)} onShowAll={() => setAllControls(true)} />
        ))}
        <div className={isPhone && !allControls ? 'hidden' : 'space-y-2'}>
        <div className="space-y-2 px-1 py-2">
          {EDIT_CHOICES.map(({ key }, index) => (
            <fieldset key={key} disabled={sourceState !== 'ready'} className="min-w-0 disabled:opacity-45">
              <AdjustmentSlider label={t.controls[key]} value={edit[key]}
                min={key === 'exposure' ? -12.5 : -2} max={key === 'exposure' ? 12.5 : 2} step={0.1}
                disabled={sourceState !== 'ready'} onFocus={() => setDial(index)}
                hint={dialUsed && dial === index ? t.slider.dial : undefined}
                displayValue={key === 'exposure' ? `${signedAdjustment(edit[key] * 0.4)} EV`
                  : key === 'colour' && edit.colour === -2 ? t.slider.monochrome
                  : `${signedAdjustment(Math.round(edit[key] * (key === 'warmth' ? 8 : 20)), 0)}%`}
                onChange={(value) => onEdit({ ...edit, [key]: value })} />
              {quickChoices && <div className="flex gap-1">
                {CHOICE_WORDS[key].map((name, index) => (
                  <button type="button" key={name} aria-pressed={edit[key] === index - 1}
                    onClick={() => onEdit({ ...edit, [key]: index - 1 })}
                    className="min-h-11 rounded px-2 text-xs hover:bg-white/8 aria-pressed:bg-sky-300/15 desk:min-h-7">{name}</button>
                ))}
              </div>}
            </fieldset>
          ))}
          <button type="button" aria-expanded={quickChoices} onClick={() => setQuickChoices(!quickChoices)}
            className="min-h-10 rounded-md px-1 text-xs text-zinc-400 hover:text-white desk:min-h-7">{t.edit.quickChoices}</button>
        </div>
        <ColourCheckPanel edit={edit} readPreview={colourPreview} version={[edit, framing, source]} onEdit={onEdit} disabled={sourceState !== 'ready'} readJpeg={reviewJpeg} />
        <details open className="border-t border-white/10">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm text-zinc-300 [&::-webkit-details-marker]:hidden">
            {t.edit.tone} <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </summary>
          <div className="space-y-1 px-1 pb-2">
            {TONE_CONTROLS.map(({ key }) => (
              <AdjustmentSlider key={key} label={t.controls[key]} value={edit[key] ?? 0}
                min={-2} max={2} step={0.05} disabled={sourceState !== 'ready'}
                hint={dialUsed && DIAL_KEYS[dial] === key ? t.slider.dial : undefined}
                title={key === 'brightness' ? t.edit.brightnessTitle : undefined}
                onChange={(value) => onEdit({ ...edit, [key]: value })} />
            ))}
          </div>
        </details>
        <details open className="border-t border-white/10">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm text-zinc-300 [&::-webkit-details-marker]:hidden">
            {t.edit.detail} <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </summary>
          <div className="space-y-1 px-1 pb-2">
            {DETAIL_CONTROLS.map(({ key }) => (
              <AdjustmentSlider key={key} label={t.controls[key]} value={edit[key] ?? 0}
                min={key === 'sharpen' ? 0 : -2} max={2} step={0.05}
                disabled={sourceState !== 'ready'} hint={dialUsed && DIAL_KEYS[dial] === key ? t.slider.dial : undefined}
                onChange={(value) => onEdit({ ...edit, [key]: value })} />
            ))}
            <div className="space-y-0.5">
              <AdjustmentSlider label={t.controls[NOISE_CONTROL.key]} value={edit.denoise ?? 0}
                min={0} max={2} step={0.05} disabled={sourceState !== 'ready'}
                describedBy="denoise-help"
                title={t.edit.denoiseTitle}
                onChange={(value) => onEdit({ ...edit, denoise: value })} />
              <p id="denoise-help" className="text-xs text-zinc-400">{t.edit.denoiseHelp}</p>
            </div>
          </div>
        </details>
        <details className="border-b border-white/10 pb-1" onToggle={(event) => setExportFocusOpen(event.currentTarget.open)}>
          <summary className="min-h-11 cursor-pointer py-3 text-sm">{t.edit.exportFocus}</summary>
          <button type="button" className={button} disabled={!position || guide} aria-pressed={markFocus} onClick={() => {
            setCompare(false);
            setTransform(FIT_VIEW);
            setMarkFocus(!markFocus);
          }}>{markFocus ? t.edit.cancelPlacement : frame.focusPoint ? t.edit.moveFocus : t.edit.markFocus}</button>
          {frame.focusPoint && <button type="button" className={button} onClick={() => onFocusPoint(undefined)}>{t.edit.clear}</button>}
          <p className="px-1 pb-2 text-xs text-zinc-400">{markFocus ? t.edit.placeHelp :
            t.edit.focusHelp}</p>
        </details>
        {isRaw && (
          <div className="border-t border-white/10 pt-2">
            <p role={developing ? 'status' : undefined} className="px-1 text-xs text-zinc-300">{provider.isDeveloped(frame.stableKey)
              ? t.raw.developed
              : developing ? t.raw.gettingFullQuality : t.raw.quickPreview}</p>
            {/* Always visible, not tucked behind the disclosure: when the automatic attempt fails the person needs
                to see why without first hunting through RAW options. */}
            {developNote && <p role="status" className="px-1 text-xs text-amber-200">{developNote}</p>}
            {/* Explicit RAW development while camera-matching remains unverified. */}
            {canDevelopRaw() && !provider.isDeveloped(frame.stableKey) && (
              <p className="px-1 text-xs text-zinc-300">
                You are viewing the camera preview. Developing the sensor data may change colour or contrast while camera-matching is being improved.
              </p>
            )}
            {canDevelopRaw() && !provider.isDeveloped(frame.stableKey) && (
              <button type="button" className={`${button} w-full border border-white/10`} disabled={developing || sourceState !== 'ready'} onClick={() => void developFromRaw()}>
                {developing ? t.raw.developing : t.raw.develop}
              </button>
            )}
            {/* Offered once the RAW has developed: a file the decoder cannot read has no sensor data to export. */}
            {canDevelopRaw() && (provider.isDeveloped(frame.stableKey) || canExportRawMaster()) && (
              <div className="space-y-1 border-t border-white/10 pt-2">
                {provider.isDeveloped(frame.stableKey) && <button type="button" className={button + ' w-full border border-white/15'}
                  disabled={masterBusy || sourceState !== 'ready'} onClick={() => void exportHighPrecisionMaster()}>
                  {masterBusy ? t.raw.masterBusy : t.raw.master}
                </button>}
                {provider.isDeveloped(frame.stableKey) && <p className="text-xs text-zinc-400">{t.raw.masterHelp}</p>}
                {masterNote && <p role="status" className="text-xs text-zinc-300">{masterNote}</p>}
                {canExportRawMaster() && sensorMode !== 'other' && (
                  <>
                    <button type="button" className={button + ' w-full border border-white/15'}
                      disabled={dngBusy} onClick={() => void saveDngCopy()}>
                      {dngBusy ? t.raw.dngBusy : t.raw.dng}
                    </button>
                    <p className="text-xs text-zinc-400">{t.raw.dngHelp}</p>
                    {dngNote && <p role="status" className="text-xs text-zinc-300">{dngNote}</p>}
                  </>
                )}
              </div>
            )}
          </div>
        )}
        <details className="border-t border-white/10">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm text-zinc-300 [&::-webkit-details-marker]:hidden">
            {t.edit.options} <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </summary>
          <div className="flex flex-wrap gap-1">
            <button type="button" disabled={isEmptyEdit(edit)} className={button} onClick={() => {
              onEdit(DEFAULT_EDIT);

              setEditNotice(t.edit.resetNotice);
            }}>{t.edit.reset}</button>
          </div>
          <div className="flex flex-wrap gap-1 border-t border-white/10 pt-1">
            <button type="button" disabled={keeperCount < 2 || isNeutralEdit(edit) || sourceState !== 'ready'}
              className={button} aria-expanded={confirmApply} onClick={() => setConfirmApply(!confirmApply)}>
              {t.edit.applyToKeepers(keeperCount)}
            </button>
            {onUndoKeeperEdits && <button type="button" className={button} onClick={() => {
              onUndoKeeperEdits();
              setEditNotice(t.edit.batchUndone);
            }}>{t.edit.undoBatch}</button>}
          </div>
          {confirmApply && !isNeutralEdit(edit) && sourceState === 'ready' && (
            <div className="rounded-md bg-black/25 p-2 text-sm">
              <p>{t.edit.confirmApply(keeperCount)}</p>
              <button type="button" className={button} onClick={() => setConfirmApply(false)}>{t.common.cancel}</button>
              <button type="button" className={`${button} font-semibold`} onClick={() => {
                onApplyToKeepers(edit);
                setConfirmApply(false);
  
                setEditNotice(t.edit.updated(keeperCount));
              }}>{t.edit.applyAdjustments}</button>
            </div>
          )}
          <p role="status" className="text-xs text-zinc-400">{editNotice}</p>
          <div className="flex flex-wrap gap-1 border-t border-white/10 pt-1">
            <button type="button" className={button} onClick={() => onCreateVirtualCopy()}>{t.edit.createCopy}</button>
            {onRemoveVirtualCopy && <button type="button" className={button} aria-expanded={confirmRemove} onClick={() => setConfirmRemove(!confirmRemove)}>{t.edit.removeCopy}</button>}
          </div>
          {confirmRemove && onRemoveVirtualCopy && (
            <div className="rounded-md bg-black/25 p-2 text-sm">
              <p>{t.edit.confirmRemove}</p>
              <button type="button" className={button} onClick={() => setConfirmRemove(false)}>{t.common.cancel}</button>
              <button type="button" className={button} onClick={onRemoveVirtualCopy}>{t.edit.removeCopyButton}</button>
            </div>
          )}

          {!frame.isDemo && <button type="button" className={button} disabled={!provider.hasBlob(frame.stableKey)}
            onClick={async () => {
              const original = await provider.ensureOriginal(frame.stableKey);
              if (original) downloadExport(original, original instanceof File ? original.name : frame.filename);
            }}>{t.edit.downloadOriginal}</button>}
          {outputSize && <p className="mt-2 text-xs text-zinc-400">{t.edit.output(outputSize.width.toLocaleString(), outputSize.height.toLocaleString())}</p>}
        </details>
        </div>
          </div>
        )}
        {tab === 'crop' && (
          <div role="tabpanel" id="panel-crop" aria-labelledby="tab-crop" className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={sourceState !== 'ready'} className={`${button} bg-kestrel-copper font-semibold !text-zinc-950 hover:bg-kestrel-copper-hover!`}
                onClick={() => setTab('edit')}>{t.crop.apply}</button>
              <button type="button" disabled={sourceState !== 'ready'} className={`${button} border border-white/15`}
                onClick={() => { if (cropEntry.current) onFramingChange(cropEntry.current); setTab('edit'); }}>{t.common.cancel}</button>
            </div>
            <p className="px-1 text-xs text-zinc-400">{t.crop.help}</p>
          <fieldset disabled={sourceState !== 'ready'} className="space-y-2">
            <div className="flex flex-wrap">
              <button type="button" className={`${button} inline-flex items-center gap-1.5`} onClick={createCropCopy}>
                <Copy className="h-4 w-4" aria-hidden="true" />{t.crop.autoCopy}</button>
              <button type="button" className={`${button} inline-flex items-center gap-1.5`} onClick={() => onFramingChange({
                ...framing, turns: (framing.turns + 1) % 4, x: 1 - framing.y, y: framing.x,
              })}>
                <RotateCw className="h-4 w-4" aria-hidden="true" />{t.crop.rotate}</button>
              <button type="button" className={`${button} inline-flex items-center gap-1.5`} onClick={autoLevel}>
                <Wand2 className="h-4 w-4" aria-hidden="true" />{t.crop.autoLevel}</button>
              <button type="button" className={`${button} inline-flex items-center gap-1.5`} onClick={() => { onFramingChange(DEFAULT_FRAMING); setCropNotice(''); }}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />{t.crop.reset}</button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button type="button" className={button} aria-pressed={previewCrop} onClick={() => {
                setPreviewCrop(!previewCrop);
                setTransform(FIT_VIEW);
              }}>{previewCrop ? t.crop.editCrop : t.crop.previewCrop}</button>
              <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={gridLines} onChange={(event) => setGridLines(event.target.checked)} />{t.crop.gridlines}</label>
            </div>
            {cropNotice && <p role="status" className="text-xs text-zinc-300">{cropNotice}</p>}
            <label className="flex min-h-11 items-center justify-between gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5">
                {framing.ratio === null ? <Crop className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                  : framing.ratio === 1 ? <Square className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                  : framing.ratio > 1 ? <RectangleHorizontal className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                  : <RectangleVertical className="h-4 w-4 text-zinc-400" aria-hidden="true" />}
                {t.crop.aspectRatio}
              </span>
              <span className="relative inline-flex min-w-0 max-w-[60%] shrink-0 items-center">
                <select aria-label={t.crop.aspectRatioLabel} value={framing.ratio === null ? '' : fixedShape(framing) ? String(framing.ratio) : 'free'}
                  onChange={(event) => {
                    const { free: _free, ...rest } = framing;
                    const value = event.target.value;
                    if (value === 'free') onFramingChange({ ...rest, ratio: framing.ratio ?? (size ? size.width / size.height : null), free: true });
                    else onFramingChange({ ...rest, ratio: Number(value) || null });
                  }}
                  className="min-h-11 w-full min-w-0 appearance-none truncate rounded-md border border-white/10 bg-[#252830] py-2 pl-3 pr-10 text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300">
                  <option value="">{t.common.original}</option>
                  <option value="free">{t.crop.free}</option>
                  {CROP_RATIOS.map((choice) => <option key={choice.label} value={String(choice.ratio)}>{choice.label === 'Square' ? t.crop.square : choice.label}</option>)}
                </select>
                <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 h-4 w-4 shrink-0 stroke-[1.75] text-zinc-300" />
              </span>
            </label>
            <AdjustmentSlider label={t.crop.size} min={MIN_CROP_SIZE} max={1} step={0.01}
              value={framing.size ?? 1} neutral={1} displayValue={`${Math.round((framing.size ?? 1) * 100)}%`}
              disabled={!size} onChange={(value) => size && onFramingChange({
                ...framing, ratio: framing.ratio ?? size.width / size.height, size: value,
              })} />
            <AdjustmentSlider label={t.crop.straighten} min={-12} max={12} step={0.1}
              value={framing.straighten} displayValue={`${framing.straighten.toFixed(1)}°`}
              onChange={(value) => onFramingChange({ ...framing, straighten: value })} />
            {framing.ratio && (['x', 'y'] as const).map((axis) => (
              <AdjustmentSlider key={axis}
                label={axis === 'x' ? t.crop.horizontal : t.crop.vertical}
                min={0} max={1} step={0.01} neutral={0.5}
                value={framing[axis]} displayValue={`${Math.round(framing[axis] * 100)}%`}
                onChange={(value) => onFramingChange({ ...framing, [axis]: value })} />
            ))}
          </fieldset>

          </div>
        )}
        {tab === 'masks' && !can('masks') && (
          <div role="tabpanel" id="panel-masks" aria-labelledby="tab-masks"><PaidNotice title={t.masks.paidTitle}>{t.masks.paidBody}</PaidNotice></div>
        )}
        {tab === 'masks' && can('masks') && (
          <div role="tabpanel" id="panel-masks" aria-labelledby="tab-masks">
            <MaskPanel masks={edit.masks ?? []} selectedId={selectedMaskId} disabled={sourceState !== 'ready'}
              brushRadius={brushRadius} paintOn={paintOn} onPaintOn={setPaintOn} erase={erase} showOverlay={showMaskOverlay}
              onSelect={setSelectedMaskId} onChange={(masks) => { if (onlyAdjustmentsChanged(edit.masks ?? [], masks)) pauseMaskHighlight(); onEdit({ ...edit, masks }); }}
              onBrushRadius={setBrushRadius} onErase={setErase} onShowOverlay={setShowMaskOverlay}
              onFindSubject={(background) => void findSubject(background)} onRefind={(id) => void findSubject(false, id)} selectingArea={selectingArea} onSelectArea={setSelectingArea}
              detecting={detecting} detectNotice={detectNotice} currentFramingKey={framingKey(framing)} />

          </div>
        )}
        {tab === 'history' && (
          <div role="tabpanel" id="panel-history" aria-labelledby="tab-history">
            <div className="space-y-2" aria-label={m.editHistory}>
              <p className="px-1 text-xs text-zinc-400">{t.history.help}</p>
              <ol className="space-y-1">
                {[{ label: t.common.original, at: 0 }, ...(frame.editHistory?.steps ?? []).map((step) => ({ label: m.historyStep[step.kind], at: step.at }))].map((entry, index) => {
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
                        <span>{current ? '● ' : ''}{index > cursor ? t.history.undone(entry.label) : entry.label}</span>
                        <time className="tabular-nums text-xs text-zinc-400" dateTime={entry.at ? new Date(entry.at).toISOString() : undefined}>{entry.at ? formatClock(entry.at) : t.history.start}</time>
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
      {isPhone && !focusPhoto && tabList}
      </div>
      {orientationNotice && <p role="status" className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-2 right-2 z-40 rounded-md bg-kestrel-panel p-3 text-center text-xs text-zinc-100">{orientationNotice}</p>}
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
    <div role="separator" aria-orientation="vertical" aria-label={t.editor.resizePanel} aria-valuenow={width} tabIndex={0}
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
