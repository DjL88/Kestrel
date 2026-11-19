import { newId } from '../core/ids';
import { loadImage } from '../providers/loadImage';
import type { FocusPoint } from '../core/exportFraming';
import { messages as m } from '../i18n/messages';
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
import { applyFix, critique, toneOnlyEdit, type Opinion } from '../core/critique';
import { fullContext } from '../core/masks';
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

import { FIT_VIEW } from '../core/viewportTransform';
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
  frame, provider, needsAccess, bindings, onEdit, initialTab, onTabChange, onApplyLook, onExport, exportCount = 1, onExportRequested, onHistoryStep, onHistoryJump, copiedEdit, onCopyEdit, keeperCount,
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
  const isPhone = useMediaQuery('(max-width: 899px), (max-height: 549px)');
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
  // Drawing a new crop box with a mouse or pen: where it started, in photo pixels and on screen.
  const cropDraw = useRef<{ start: { x: number; y: number }; client: { x: number; y: number }; moved: boolean } | null>(null);
  const edgeDrag = useRef<{ edge: CropEdge; x: number; y: number; point: { x: number; y: number } } | null>(null);
  const [markFocus, setMarkFocus] = useState(false);
  const [transform, setTransform] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
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
    const task = tasks.start(`Developing ${frame.filename} from RAW`);
    try {
      const key = frame.stableKey;
      const result = await provider.developFromOriginal(key, async (original) => {
        const mode = await rawSensorMode(original, frame.filename);
        setSensorModes((modes) => modes[key] === mode ? modes : { ...modes, [key]: mode });
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


  /**
   * MVP proof: export edited RGB16 TIFF directly from the original RAW. No
   * JPEG/HTML canvas intermediary, and never discard an unsupported adjustment.
   * This is intentionally an explicit test export, not the default master.
   */
  async function exportHighPrecisionMaster() {
    if (masterBusy) return;
    setMasterBusy(true);
    setMasterNote(null);
    const task = tasks.start('Making a 16-bit TIFF from the RAW');
    try {
      if (previewRecipe || pendingAuto) {
        throw new Error('Apply or discard the previewed edit before exporting the saved RAW recipe.');
      }
      if (!source) throw new Error('Wait for the photo to open before exporting.');
      const original = await provider.ensureOriginal(frame.stableKey);
      if (!original) throw new Error('Reconnect the original RAW file before exporting.');
      const output = await exportRaw16Tiff(original, source, frame.edit ?? DEFAULT_EDIT, frame.framing);
      const name = frame.filename.replace(/\.[^.]+$/, '') + '_16bit.tif';
      // The browser hands the file to its own downloads; the desktop app asks where to save it.
      const saved = isDesktopApp() ? await saveWithDialog(output, name) : (downloadExport(output, name), true);
      if (saved) {
        setMasterNote('Saved a 16-bit TIFF made from the RAW sensor data, with the same edit as the screen. No colour profile is embedded yet; the colours are sRGB.');
        task.finish('16-bit TIFF saved');
      } else {
        setMasterNote('Export cancelled; no file was written.');
        task.finish('Cancelled');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to produce the high-bit-depth TIFF.';
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
    const task = tasks.start('Making a DNG copy');
    try {
      const original = await provider.ensureOriginal(frame.stableKey);
      if (!original) throw new Error('Reconnect the original RAW file first.');
      const dng = await rawDngCopy(original);
      const saved = await saveWithDialog(dng, frame.filename.replace(/\.[^.]+$/, '') + '.dng');
      setDngNote(saved ? 'Saved a DNG copy of the sensor data. The original is unchanged.' : 'Cancelled; no file was written.');
      task.finish(saved ? 'DNG copy saved' : 'Cancelled');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'A DNG copy could not be made.';
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
      setEyeNote(error instanceof Error ? error.message : 'Could not look for the eye.');
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
    setAutoNotes(['Analysing your photograph on this device…']);
    const stillCurrent = () => run === autoRun.current && detectionContext.current === startedFor &&
      sourceImage.current === originalSource && Boolean(originalSource);
    try {
      if (!originalSource || !outputSize || !startedFor) {
        if (run === autoRun.current) setAutoNotes(['Could not analyse this photo. Your edits have not changed.']);
        return;
      }
      // Analyse exactly the unedited, framed image (crop and rotation applied), not the adjusted editor canvas.
      const analysisCanvas = document.createElement('canvas');
      drawFramedPhoto(originalSource, analysisCanvas, frame.framing ?? DEFAULT_FRAMING, {
        scale: Math.min(1, 640 / Math.max(outputSize.width, outputSize.height)),
      });
      const analysisContext = analysisCanvas.getContext('2d', { willReadFrequently: true });
      if (!analysisContext || analysisCanvas.width < 16 || analysisCanvas.height < 16) {
        if (stillCurrent()) setAutoNotes(['This preview is too small to analyse. Your edits have not changed.']);
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
          else subjectNote = 'Subject edges were uncertain, so only whole-photo adjustments were considered.';
        } catch {
          if (!stillCurrent()) return;
          subjectNote = 'Subject detection was unavailable. Whole-photo suggestions still work offline.';
        }
      } else {
        subjectNote = 'The atmosphere is preserved without an automatic subject mask.';
      }
      const natural = naturalAuto({
        pixels: analysis.data, width: analysis.width, height: analysis.height, segmentation, iso: frame.exif?.iso,
      });
      if (natural.notes.includes('This preview is too small or too large to analyse.')) {
        if (stillCurrent()) setAutoNotes(['This preview could not be analysed. Your edits have not changed.']);
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
        subjectNote = local.usedMask ? local.reason : 'No local subject adjustment was needed. ' + local.reason;
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
            ? 'Previewing a natural look with a gentle subject-only adjustment. Nothing is saved until you apply it.'
            : 'Previewing a natural look. Nothing is saved until you apply it.'
          : staged.outcome === 'declined'
            ? 'No change suggested. Your photo is exactly as it was.'
            : 'Your photo already works. No new edit was suggested.',
        describeOutcome(staged.outcome, staged.reason),
        ...natural.notes.filter((note) => !note.includes('already works')),
        usedMask || subjectNote ? subjectNote : '',
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
      const framed = document.createElement('canvas');
      drawFramedPhoto(source, framed, framing, { scale: Math.min(1, GUIDED_RENDER_EDGE / Math.max(outputSize.width, outputSize.height)) });
      const { grid, assessment, guide, detail } = await detectSubjectGuided(framed);
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
          ? { ...mask, grid, detail: detail ?? undefined, framingKey: key, confidence: assessment.confidence, strokes: [] } : mask) });
      } else {
        const mask = { ...createSubjectMask(newId(), grid, key, assessment.confidence, detail), invert: background };
        onEdit({ ...edit, masks: [...masks, mask] });
        setSelectedMaskId(mask.id);
        setShowMaskOverlay(true);
      }
      setDetectNotice(guide ? `Traced the subject the detector found, at full detail. ${assessment.reason}` : assessment.reason);
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
      const { grid, assessment, detail } = await detectSubjectInArea(piece, bounds, preview.height / preview.width);
      if (detectionContext.current !== startedFor) {
        if (detectionContext.current) setDetectNotice('Photo edits changed. Select the area again.');
        return;
      }
      if (!assessment.usable) { setDetectNotice(assessment.reason); return; }
      const mask = createSubjectMask(newId(), grid, framingKey(framing), assessment.confidence, detail);
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
      {/* On a phone, Quick adjust has Undo, Redo and Before/After within thumb reach, so this row would only repeat them. */}
      {!focusPhoto && !(isPhone && tab === 'edit' && sheetOpen && !(canLockOrientation && fullscreen)) && <div role="toolbar" aria-label="Editor actions" className="mobile-toolbar-scroll flex min-w-0 max-w-full shrink-0 items-center justify-between gap-2 overflow-x-auto border-b border-white/10 bg-kestrel-panel px-2 pt-0.5 sm:px-4">
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
        {/* Zoom lives in the bottom bar with the photo navigation, in the same place as in culling (ZoomControls). */}
        {fit > 0 && (() => {
          const controls = <ZoomControls zoom={transform.zoom} fit={fit} dpr={dpr} maxZoom={maxZoom} onZoom={zoomTo} note={eyeNote}
            eye={{ onClick: () => void zoomToEye(), busy: findingEye, disabled: findingEye || sourceState !== 'ready', title: "Zoom to the subject's eye (only moves the view)" }} />;
          return zoomSlot ? createPortal(controls, zoomSlot) : controls;
        })()}
        {/* Settings is in the top right corner of every page (App). */}
        {canLockOrientation && fullscreen && (
          <button type="button" className={`${button} inline-flex items-center border border-white/15`}
            aria-pressed={landscapeLocked} onClick={() => void toggleLandscape()}
            title="Use landscape for this full-screen photo; return to automatic rotation when finished">
            {landscapeLocked ? 'Auto rotate' : 'Landscape'}
          </button>
        )}
        {/* Full screen lives in one place, the filmstrip bar (FilmstripDock), in the editor and culling alike. */}
        {/* Export sits in the top row, where the library has it. */}
        {headerSlot ? createPortal(<>
        <button type="button" disabled={sourceState !== 'ready'} onClick={openExport} title={exportCount > 1 ? `Export ${exportCount} selected photos` : "Export this photo for social media or full size"}
          className={`${button} hidden items-center gap-1.5 bg-kestrel-copper font-semibold !text-zinc-950 hover:bg-kestrel-copper-hover! workspace:inline-flex`}>
          <Download className="h-4 w-4" aria-hidden="true" />{exportCount > 1 ? `Export ${exportCount}` : "Export"}
        </button>
        </>, headerSlot) : <>
        <button type="button" disabled={sourceState !== 'ready'} onClick={openExport} title={exportCount > 1 ? `Export ${exportCount} selected photos` : "Export this photo for social media or full size"}
          className={`${button} hidden items-center gap-1.5 bg-kestrel-copper font-semibold !text-zinc-950 hover:bg-kestrel-copper-hover! workspace:inline-flex`}>
          <Download className="h-4 w-4" aria-hidden="true" />{exportCount > 1 ? `Export ${exportCount}` : "Export"}
        </button>
        </>}

        </div>
      </div>}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden workspace:flex-row">
      <div ref={stage} data-photo-stage tabIndex={0} aria-label="Photo canvas" className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-black focus-visible:outline-2 focus-visible:outline-sky-300">
        <PhotoViewport zoom={transform.zoom} pan={transform.pan} maxZoom={maxZoom} showZoomButton={false}
          onTransform={(zoom, pan) => setTransform({ zoom, pan })}
          overlayMode={displayCompare ? 'wipe' : 'hidden'}
          labels={displayCompare ? [before.label, 'Now'] : undefined}
          base={<>
            <canvas ref={editedCanvas} aria-label="Edited photo" role="img"
              hidden={sourceState !== 'ready'} className={position ? "absolute" : "absolute inset-0 h-full w-full object-contain"} style={position} />
            {detail && <canvas ref={editedDetail} aria-hidden="true" hidden={!showDetail}
              className="absolute" style={detail.style} />}
            {/* A 3 × 3 thirds grid while the pointer is over the photo (not on touch screens). It follows the Gridlines
                switch in Crop, stays out of the way of Before/After, takes no clicks, and zooms with the photo. Holding
                Shift shows it at any time, Before/After included. */}
            {!guide && position && sourceState === 'ready' && (showGrid || (gridLines && !displayCompare)) && <div aria-hidden="true" data-testid="thirds-grid"
              className={`${showGrid ? '' : 'thirds-hover'} crop-thirds pointer-events-none absolute`} style={position} />}
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
                    <button key={edge} type="button" aria-label={`Crop edge, ${edge}. Arrow keys move it.`} title="Drag to move this edge of the crop"
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
      {!toolsHidden && <PanelResizer width={panelWidth} side={panelSide} onChange={setPanelWidth} />}
      <div ref={panelScroll} onInput={(event) => {
        if (tab !== 'masks' || !(event.target instanceof HTMLInputElement) || event.target.type !== 'range') return;
        setSliderBusy(true);
        window.clearTimeout(sliderTimer.current);
        sliderTimer.current = window.setTimeout(() => setSliderBusy(false), 700);
      }} style={{ '--panel-w': `${panelWidth}px` } as React.CSSProperties} className={`${toolsHidden ? 'hidden ' : ''}scroll-pt-14 max-h-[46%] shrink-0 space-y-2 overflow-y-auto border-t border-white/10 bg-kestrel-panel p-3 pt-0 workspace:relative workspace:z-10 workspace:max-h-none workspace:w-[var(--panel-w)] workspace:border-t-0 workspace:p-4 workspace:pt-0 ${panelSide === 'left' ? 'workspace:order-[-9999] workspace:border-r' : 'workspace:border-l'}`}>
        {!isPhone && <div className="sticky top-0 z-10 -mx-3 flex items-stretch bg-kestrel-panel workspace:-mx-4">
          {onFoldTools && <button type="button" onClick={onFoldTools} aria-label="Fold editing tools" title="Fold the panels away for a bigger photo (Tab)"
            className={`grid w-9 shrink-0 place-items-center border-b border-white/10 text-zinc-400 hover:bg-white/8 hover:text-white focus-visible:outline-2 focus-visible:outline-sky-300 ${panelSide === 'left' ? 'order-last' : ''}`}>
            {panelSide === 'left' ? <ChevronLeft className="h-5 w-5" aria-hidden="true" /> : <ChevronRight className="h-5 w-5" aria-hidden="true" />}
          </button>}
          <div className="min-w-0 flex-1 [&>[role=tablist]]:mx-0 [&>[role=tablist]]:static">{tabList}</div>
        </div>}
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
              <AdjustmentSlider label={label} value={edit[key]}
                min={key === 'exposure' ? -12.5 : -2} max={key === 'exposure' ? 12.5 : 2} step={0.1}
                disabled={sourceState !== 'ready'} onFocus={() => setDial(index)}
                hint={dialUsed && dial === index ? 'Dial' : undefined}
                displayValue={key === 'exposure' ? `${signedAdjustment(edit[key] * 0.4)} EV`
                  : key === 'colour' && edit.colour === -2 ? 'Monochrome'
                  : `${signedAdjustment(Math.round(edit[key] * (key === 'warmth' ? 8 : 20)), 0)}%`}
                onChange={(value) => onEdit({ ...edit, [key]: value })} />
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
              <AdjustmentSlider key={key} label={label} value={edit[key] ?? 0}
                min={-2} max={2} step={0.05} disabled={sourceState !== 'ready'}
                hint={dialUsed && DIAL_KEYS[dial] === key ? 'Dial' : undefined}
                title={key === 'brightness' ? 'Adjust midtone brightness while preserving pure black and white; use Exposure for overall light' : undefined}
                onChange={(value) => onEdit({ ...edit, [key]: value })} />
            ))}
          </div>
        </details>
        <details open className="border-t border-white/10">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm text-zinc-300 [&::-webkit-details-marker]:hidden">
            Detail <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </summary>
          <div className="space-y-1 px-1 pb-2">
            {DETAIL_CONTROLS.map(({ key, label }) => (
              <AdjustmentSlider key={key} label={label} value={edit[key] ?? 0}
                min={key === 'sharpen' ? 0 : -2} max={2} step={0.05}
                disabled={sourceState !== 'ready'} hint={dialUsed && DIAL_KEYS[dial] === key ? 'Dial' : undefined}
                onChange={(value) => onEdit({ ...edit, [key]: value })} />
            ))}
            <div className="space-y-0.5">
              <AdjustmentSlider label={NOISE_CONTROL.label} value={edit.denoise ?? 0}
                min={0} max={2} step={0.05} disabled={sourceState !== 'ready'}
                describedBy="denoise-help"
                title="Smooths coloured speckle in high-ISO photos; not a claim of AI detail restoration"
                onChange={(value) => onEdit({ ...edit, denoise: value })} />
              <p id="denoise-help" className="text-xs text-zinc-400">Smooths colour speckle only. Edges and fine texture stay as they are.</p>
            </div>
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
              ? sensorModeLabel(sensorMode)
                ? `Developed from the RAW sensor data (${sensorModeLabel(sensorMode)}) as an 8-bit JPEG. Edits use that JPEG; the original RAW is unchanged.`
                : 'Developed from the RAW file as an 8-bit JPEG. Edits use that JPEG; the original RAW is unchanged.'
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
            {/* Offered once the RAW has developed: a file the decoder cannot read has no sensor data to export. */}
            {canDevelopRaw() && (provider.isDeveloped(frame.stableKey) || canExportRawMaster()) && (
              <div className="space-y-1 border-t border-white/10 pt-2">
                {provider.isDeveloped(frame.stableKey) && <button type="button" className={button + ' w-full border border-white/15'}
                  disabled={masterBusy || sourceState !== 'ready'} onClick={() => void exportHighPrecisionMaster()}>
                  {masterBusy ? 'Making 16-bit TIFF…' : 'Export 16-bit TIFF'}
                </button>}
                {provider.isDeveloped(frame.stableKey) && <p className="text-xs text-zinc-400">Made from the RAW sensor data, not the screen's JPEG, with the same edit, crop and turns. Masks, straightening and Noise reduction aren't included yet; you're told before anything is saved.</p>}
                {masterNote && <p role="status" className="text-xs text-zinc-300">{masterNote}</p>}
                {canExportRawMaster() && sensorMode !== 'other' && (
                  <>
                    <button type="button" className={button + ' w-full border border-white/15'}
                      disabled={dngBusy} onClick={() => void saveDngCopy()}>
                      {dngBusy ? 'Making DNG copy…' : 'Save a DNG copy'}
                    </button>
                    <p className="text-xs text-zinc-400">For Nikon High Efficiency files, so other apps can open the sensor data too.</p>
                    {dngNote && <p role="status" className="text-xs text-zinc-300">{dngNote}</p>}
                  </>
                )}
              </div>
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
            <p className="px-1 text-xs text-zinc-400">Drag across the photo to draw a crop, or drag its corners, edges or middle. Pick a shape below to keep it while you drag. Changes are saved as you go. Apply returns to the editing view with the crop in place, and Cancel puts back the crop you started with.</p>
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
                <select aria-label="Crop aspect ratio" value={framing.ratio === null ? '' : fixedShape(framing) ? String(framing.ratio) : 'free'}
                  onChange={(event) => {
                    const { free: _free, ...rest } = framing;
                    const value = event.target.value;
                    if (value === 'free') onFramingChange({ ...rest, ratio: framing.ratio ?? (size ? size.width / size.height : null), free: true });
                    else onFramingChange({ ...rest, ratio: Number(value) || null });
                  }}
                  className="min-h-11 w-full min-w-0 appearance-none truncate rounded-md border border-white/10 bg-[#252830] py-2 pl-3 pr-10 text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300">
                  <option value="">Original</option>
                  <option value="free">Free</option>
                  {CROP_RATIOS.map((choice) => <option key={choice.label} value={String(choice.ratio)}>{choice.label}</option>)}
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
              onSelect={setSelectedMaskId} onChange={(masks) => { if (onlyAdjustmentsChanged(edit.masks ?? [], masks)) pauseMaskHighlight(); onEdit({ ...edit, masks }); }}
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
