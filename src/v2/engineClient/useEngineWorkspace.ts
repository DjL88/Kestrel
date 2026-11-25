import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { applyDecisionWithHistory, assignBurstGroups, redoDecision, regroupBurstsWithEmbeddings, removedFrames, removeFromLibrary, restoreRemoved, undoDecision } from '../../core/cullingEngine';
import { recordEdit, stepEdit, type EditWhy } from '../../core/editHistory';
import { forkEditCheckpoint, switchEditVersion as switchVersionInCatalogue } from '../../core/editBranches';
import { isEmptyEdit, DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import { sameRecipe } from '../../core/naturalAuto';
import { newId } from '../../core/ids';
import { exportCollage } from './exportCollage';
import { createCollage, MAX_COLLAGE_SELECTION, readCollage } from '../../core/collage';
import { PHOTO_ACCEPT } from '../../core/rawFormats';
import { appendProjectPhotos, applyImportBursts, createEmptyProject, setArchived } from '../../core/projects';
import { tasks } from '../../core/taskStore';
import { createSaveGuard, type SaveGuard } from '../../core/saveGuard';
import { engineScheduler } from '../../core/engineScheduler';
import type { CullDecision, CullingState, PhotoFrame, ShootDescriptor } from '../../core/types';
import { eraseDeviceData } from './eraseDeviceData';
import { BrowserCatalogueStore } from '../../providers/browserCatalogueStore';
import { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { projectPreviewBlobs } from './projectCover';
import { scanForCulling } from '../../providers/browserAutoCull';
import { useAccess } from '../../providers/useAccess';
import { useBackgroundDevelop } from '../../useBackgroundDevelop';
import { useSpeciesScan } from '../../useSpeciesScan';
import { carryVehicleReadings, correctVehicle } from '../../core/vehicleBursts';
import { VEHICLE_LABELS } from '../../core/vehicleLabels';
import { vehicleText } from '../../i18n/areas/vehicles';
import { useVisualGrouping } from './useVisualGrouping';
import { isDesktopApp, isMobileShell } from '../../providers/desktopShell';
import { photoParallelism } from '../../core/photoParallelism';
import { canDevelopRaw, canExportRawMaster } from '../../providers/rawDevelop';
import { developFullSizeOf, fullDevelopPossible } from './fullDevelop';
import { buildDngCopyFile, dngCopyOffered } from './rawDngCopy';
import { pickedFromFile, pickedKey, pickPhotosNatively, type PickedPhoto } from '../../providers/linkedOriginals';
import { getLocalFileKey, loadLocalFileListShoot, rehydrateLocalFramesFromStore } from '../../providers/localShootLoader';
import { hashOriginalBytes, isSameOriginalBytes } from '../../core/originalFileIdentity';
import type { EditRecipe, HubViewState, OverlaySettings, PhotoHistogram, WatermarkPreset, Project, TaskInfo, WorkspaceActions, WorkspaceStore } from '../ui/contract';
import { useWorkspace } from '../ui/stub';
import { EngineSurface } from './EngineSurface';
import { featureAccess, featurePlan } from './featureMap';
import { hasDeviceFont, listDeviceFonts, loadSavedDeviceFonts, mergeFonts, saveDeviceFonts } from './fonts';
import { addVersion, assetUrl, cutOut, importWatermark, loadStored, makeVariant, moveToSlot, saveStored, textWatermark, toPresets, type StoredWatermark } from './watermarkLibrary';
import { replaceWatermarkIfUnchanged } from './watermarkMutation';
import { watermarkToneForPixels } from '../../core/watermark';
import { createDefaultSizes } from '../ui/stub';
import { toPhotoHistogram } from './histogram';
import { fullResolutionRasterFormat, isHeifFile, isRawPreviewFile } from '../../core/rawFormats';
import { rawSensorSize } from '../../core/rawSensorSize';
import { loadUi, mergeSettings, saveUi, type SavedUi } from './uiSettings';
import { dropSourcePreview, dropSourceUrls } from './previewInvalidation';
import { applyCanvasExportEdit, applyCanvasPhotoEdit } from '../../core/canvasEdit';
import { applyFrameLayers, LAYER_COPY_EDGE, saveLayerAsset } from '../../core/layerAssetVault';
import { MAX_LAYERS } from '../../core/layers';
import { DEFAULT_EDIT as EMPTY_EDIT } from '../../core/photoEdits';
import { DEFAULT_CROP, flipCrop, patchCrop, rotateCrop } from './cropOps';
import { readCrops } from './cropOps';
import { recordFormatCrop, recordFormatSetChange, recordFormatLink } from './formatHistory';
import { addLayer, addRow, alignOverlays, moveLayer, moveRow, newLayer, patchOverlay, readOverlay, removeLayer, removeRow, updateLayer, updateRow } from './overlayOps';
import { frameToPhoto, matchesAutoSource, originalFormatSize, shootToProject, taskToInfo, visibleTasks, type AssistState, type FrameUrls } from './frameToPhoto';
import { runAuto } from './runAuto';
import { commitAutoEdit } from './commitAutoEdit';
import { commitAutoCull } from './commitAutoCull';
import { runV2Denoise } from './runDenoise';
import { moveArtboard } from './boardOps';
import { accountConnection } from '../../providers/licenceStore';
import { runDeepVisionReview } from './deepVisionReview';
import { planExport } from './exportOps';
import { verifyExactOriginalCopy } from './verifiedOriginalCopy';
import { buildRawMasterFile } from './rawMasterExport';
import { TEMPLATES_KEY, addTemplate, deleteTemplate, readTemplates, renameTemplate, type OverlayTemplate } from './overlayTemplates';
import { applyOverlayTemplateToProject, changePhotoOverlay } from './overlayHistory';
import { type FormatSet, addFormat, applyFormats, ORIGINAL_FORMAT_ID, removeFormat, toggleFormat, toggleSizeLinked as toggleSizeLinkedRaw, validCustomSize, setOriginalOutputSize, resetOriginalOutputSize } from './formatOps';
import { patchVideoZoom } from './videoZoomOps';
import { isSplitFrameCount, setFormatSplitOffset, setSplitFrameCount as writeSplitFrameCount, toggleFormatSplit, type SplitFrameCount } from './formatSplitOps';
import { readSplitPanOffset } from './splitFrameOps';
import { canAddMask, removeMask, setMaskEdit, setMaskFeather, setMaskGeometry, setMaskLimit, toggleMask } from './maskOps';
import { verifyFrameMasks } from './maskVerify';
import { maskVerificationKey, commitVerifiedMasks } from './maskVerificationCommit';
import { commitSubjectMask, subjectMaskTarget } from './subjectMaskCommit';
import { createMask, createSubjectMask, framingKey, hasActiveMasks } from '../../core/maskTypes';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize, lensCentre } from '../../core/photoFraming';
import { GUIDED_RENDER_EDGE } from '../../core/subjectGuide';
import { detectSubjectGuided } from '../../providers/subjectDetector';
import { judgeSubject } from '../../core/autoCull';
import { archiveExports, saveExportFile, loadExportSource, loadVerifiedRasterOriginalForExport } from '../../providers/browserExport';
import { toProfile } from '../../core/exportFormats';
import { renderV2Export, type OverlayDraw } from './renderV2Export';
import { renderGalleryPreview } from './galleryPreview';
import { readSharedEdit } from '../../core/sharedSync';
import { createVirtualCopy } from '../../core/virtualCopies';
import { formatOverlayRowText } from '../ui/utils/studioMath';
import { loadImage } from '../../providers/loadImage';
import { deliverExport, describeExport } from './exportDelivery';
import { rawJpegPairs, withPartners } from '../../core/rawJpegPairs';
import { recountBursts, withPairedJpeg } from './pairedPhotos';
import { backUpProjectNow, useAutoBackup, useBackupStatus } from '../../providers/autoBackup';
import { saveProjectBackupFile } from '../../providers/projectBackupFile';
import { restoreProjectBackup } from '../../core/projectBackup';
import { backupStatusText } from './backupWords';
import { applySidecarImports, planXmpImports, saveSidecars, sidecarFailureText, xmpScope } from './xmpOps';
import { applyLightroomImport, lightroomNotice } from './lightroomOps';
import { saveCatalogueExport } from './catalogueExport';
import { CatalogueReadError, readLightroomCatalogue } from '../../core/lightroomCatalogue';
import { catalogueFilesInFolder, catalogueOnlyPhotos, commonFolder, planLightroomImport } from '../../core/lightroomImport';
import type { LightroomPhoto } from '../../core/lightroomCatalogue';
import { STRINGS as V2_STRINGS } from '../ui/strings';
import { scheduleV2PhotoExports, photoExportUnits } from './scheduledPhotoExport';
import { uniqueExportFilename } from '../../core/exportNaming';
import { exportMayContinue } from '../../core/exportCancellation';
import type { ExportRequest } from '../ui/contract';
import { applyRecipePatch, editToRecipe } from './recipeMap';
import { canvasLensCentre, detectLateralCa } from '../../core/fringe';
import { surfaceBridge } from './surfaceBridge';
import { addSavedEditGroup, renameSavedEditGroup, selectSavedEditGroup, syncEditGroup } from './editGroupState';
import { engineText } from '../../i18n/areas/engine';
import { loadSpeciesNames, onSpeciesNamesLoaded } from '../../providers/speciesNames';
import { language } from '../../i18n/messages';

/** Actions that change a photo's edit, sizes, overlay, masks or assist state. They are not connected to the real
 * recipe yet, so they say so instead of silently changing sample data. */
const NOT_CONNECTED = [] as const satisfies readonly (keyof WorkspaceActions)[];

/** What the export needs to draw the overlay exactly as the canvas does, read from the latest render. */
interface ExportEnv { fonts: ReturnType<typeof mergeFonts>; presets: WatermarkPreset[]; auto: Record<string, 'light-on-dark' | 'dark-on-light'>; textAllowed: boolean; markAllowed: boolean }

async function buildOverlayDraw(frame: PhotoFrame, request: ExportRequest, env: ExportEnv): Promise<OverlayDraw | null> {
  const overlay = readOverlay(frame.overlay);
  const text = request.includeOverlay && overlay.textEnabled && env.textAllowed && overlay.rows.length > 0;
  const preset = env.presets.find((candidate) => candidate.id === overlay.watermarkPresetId) ?? env.presets[0];
  const mark = request.includeWatermark && overlay.watermarkEnabled && env.markAllowed && !!preset;
  if (!text && !mark) return null;
  const photo = frameToPhoto(frame, undefined, {});
  const contrast = overlay.watermarkContrast === 'auto' ? env.auto[frame.id] ?? 'light-on-dark' : overlay.watermarkContrast;
  const fallbackFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif';
  const imageUrl = preset?.kind === 'image'
    ? (contrast === 'light-on-dark' ? preset.forDarkUrl ?? preset.forLightUrl : preset.forLightUrl ?? preset.forDarkUrl)
    : undefined;
  return {
    overlay, text, watermark: mark, contrast,
    rows: overlay.rows.map((row) => ({ text: formatOverlayRowText(row, photo), family: env.fonts.find((font) => font.id === row.fontId)?.family ?? fallbackFamily, weight: row.weight, sizePx: row.sizePx, letterSpacing: row.letterSpacing })),
    mark: !mark || !preset ? null : imageUrl ? { kind: 'image', image: await loadImage(imageUrl) } : { kind: 'text', text: preset.text, ...(preset.subtext ? { subtext: preset.subtext } : {}) },
  };
}

const THUMBNAIL_WORKERS = 4;

async function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.hidden = true;
    input.setAttribute('data-testid', 'v2-watermark-input');
    document.body.appendChild(input);
    const done = (file: File | null) => { input.remove(); resolve(file); };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

/** Pick a local folder through the webview's directory input. Import uses the same verified catalogue loader. */
async function pickFolderFiles(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.accept = PHOTO_ACCEPT;
    input.setAttribute('webkitdirectory', '');
    input.hidden = true;
    input.setAttribute('data-testid', 'v2-folder-input');
    document.body.appendChild(input);
    const done = (files: File[] | null) => { input.remove(); resolve(files); };
    input.addEventListener('change', () => done(input.files?.length ? Array.from(input.files) : null));
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

async function pickFiles(): Promise<Array<File | PickedPhoto> | null> {
  if (isDesktopApp()) {
    const chosen = await pickPhotosNatively();
    return chosen === 'cancelled' ? null : chosen;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.accept = PHOTO_ACCEPT; input.hidden = true;
    input.setAttribute('data-testid', 'v2-file-input');
    document.body.appendChild(input);
    const done = (files: File[] | null) => { input.remove(); resolve(files); };
    input.addEventListener('change', () => done(input.files?.length ? Array.from(input.files) : null));
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

/** Pick replacement files for originals the catalogue can no longer read (moved, renamed, or the browser session
 * lost its blob). Browser-only: desktop's own folder-relink is a separate, not-yet-wired path (see reconnectOriginal). */
async function pickReselectFiles(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.accept = PHOTO_ACCEPT; input.hidden = true;
    input.setAttribute('data-testid', 'v2-relink-input');
    document.body.appendChild(input);
    const done = (files: File[] | null) => { input.remove(); resolve(files); };
    input.addEventListener('change', () => done(input.files?.length ? Array.from(input.files) : null));
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

/**
 * The V2 store backed by the real catalogue. Connected now: projects (create, open, back), importing photos with the
 * real loader and Task Manager, thumbnails and previews from the preview provider, flag (= keep), reject, rating,
 * selection, the Adjust recipe (sliders, Looks, reset, copy and paste, with edit undo and redo) and the canvas renderer,
 * and the deep vision review (real subject detection + trust gate + Look suggestion from src/engine/*, reported as a
 * plain-text notice; see deepVisionReview.ts). Everything else keeps the UI's own layout state; edit-type actions say
 * they are not connected yet (NOT_CONNECTED). Originals are never written.
 */
export function useEngineWorkspace(): { store: WorkspaceStore; actions: WorkspaceActions } {
  const stub = useWorkspace();
  const { can: canByPlan, capabilities } = useAccess();
  // Photos at once (owner decision 25 Nov): the plan's ceiling, held to this device's memory and cores. The
  // scheduler still runs one heavy job at a time where free memory cannot be measured.
  useEffect(() => {
    const nav = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { deviceMemory?: number };
    engineScheduler.setCpuLimit(photoParallelism({
      desktop: isDesktopApp() && !isMobileShell(), paid: capabilities.fullEditor, cloud: canByPlan('cloudAssist'),
      cores: nav?.hardwareConcurrency, memoryGB: nav?.deviceMemory,
    }).local);
  }, [capabilities.fullEditor, canByPlan]);
  // One gate for the whole adapter: the plan's answer, or the developer-only Pro preview (see featureMap.ts).
  const can = useCallback((feature: Parameters<typeof canByPlan>[0]) => featureAccess(canByPlan)[feature as keyof ReturnType<typeof featureAccess>] ?? canByPlan(feature), [canByPlan]);
  const catalogue = useRef<BrowserCatalogueStore | null>(null);
  if (!catalogue.current) catalogue.current = new BrowserCatalogueStore();
  const provider = useRef<BrowserPreviewProvider | null>(null);
  if (!provider.current) provider.current = new BrowserPreviewProvider();

  const [screen, setScreen] = useState<'hub' | 'editor'>('hub');
  const [hubState, setHubState] = useState<HubViewState>('loading');
  const [projects, setProjects] = useState<Project[]>([]);
  const [state, setState] = useState<CullingState | null>(null);
  const [urls, setUrls] = useState<Record<string, FrameUrls>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<EditRecipe | null>(null);
  const [deviceFonts, setDeviceFonts] = useState<string[]>(loadSavedDeviceFonts);
  const [watermarkStore, setWatermarkStore] = useState<StoredWatermark[]>(loadStored);
  const watermarkStoreRef = useRef(watermarkStore);
  const [watermarkLibrary, setWatermarkLibrary] = useState<WatermarkPreset[]>([]);
  const [templates, setTemplates] = useState<OverlayTemplate[]>(() => { try { return readTemplates(localStorage.getItem(TEMPLATES_KEY)); } catch { return []; } });
  const updateTemplates = useCallback((next: OverlayTemplate[]) => { setTemplates(next); try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(next)); } catch { setNotice(engineText.workspace.templateNotSaved); } }, []);
  const [savedUi, setSavedUi] = useState<SavedUi>(loadUi);
  /** Originals (stable keys) whose full-size develop is being made, so the canvas can say so. */
  const [fullDeveloping, setFullDeveloping] = useState<Record<string, true>>({});
  const fullDevelopRunning = useRef(new Set<string>());
  const [pixelSizes, setPixelSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [verifiedRasterSizes, setVerifiedRasterSizes] = useState<Record<string, { width: number; height: number }>>({});
  const verifiedRasterRef = useRef(verifiedRasterSizes);
  verifiedRasterRef.current = verifiedRasterSizes;
  const pixelSizesRef = useRef(pixelSizes);
  pixelSizesRef.current = pixelSizes;
  /** The formats this photo has, worked out exactly as the canvas shows them (decoded size first, then EXIF). */
  const liveFormatsOf = (frame: PhotoFrame | undefined) => applyFormats(createDefaultSizes(), frame?.formats,
    frame ? originalFormatSize(frame, verifiedRasterRef.current[`${frame.stableKey}|${frame.originalSha256 ?? ''}`], pixelSizesRef.current[frame.id]) : null);
  const [histograms, setHistograms] = useState<Record<string, PhotoHistogram>>({});
  const [watermarkAuto, setWatermarkAuto] = useState<Record<string, 'light-on-dark' | 'dark-on-light'>>({});
  useEffect(() => { let live = true; void toPresets(watermarkStore).then((presets) => { if (live) setWatermarkLibrary(presets); }); return () => { live = false; }; }, [watermarkStore]);
  const updateWatermarks = useCallback((change: (current: StoredWatermark[]) => StoredWatermark[]) => {
    const current = watermarkStoreRef.current;
    const next = change(current);
    if (next === current) return;
    watermarkStoreRef.current = next;
    setWatermarkStore(next);
    saveStored(next);
  }, []);
  const [assists, setAssists] = useState<Record<string, AssistState>>({});
  const [autoRequest, setAutoRequest] = useState<{ photoId: string; sequence: number } | null>(null);
  const lastAutoRequest = useRef(0);
  const cullController = useRef<AbortController | null>(null);
  const [importing, setImporting] = useState(false);
  const [removedOpen, setRemovedOpen] = useState(false);
  const stateRef = useRef<CullingState | null>(null);
  stateRef.current = state;
  const maskInFlight = useRef(new Set<string>());
  const exportEnv = useRef<ExportEnv>({ fonts: [], presets: [], auto: {}, textAllowed: false, markAllowed: false });
  useEffect(() => { surfaceBridge.set(state?.frames ?? [], provider.current); }, [state?.frames]);
  const importController = useRef<AbortController | null>(null);
  const relinking = useRef(false);
  const taskList = useSyncExternalStore(tasks.subscribe, tasks.list, tasks.list);
  // The core task store keeps only the last few finished tasks. V2 keeps them in a Completed tab for 4 hours.
  const [taskHistory, setTaskHistory] = useState<Record<string, TaskInfo>>({});
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const finished = taskList.filter((task) => task.state === 'done' || task.state === 'failed' || task.state === 'cancelled');
    if (!finished.length) return;
    setTaskHistory((current) => {
      let changed = false;
      const next = { ...current };
      for (const task of finished) {
        const info = taskToInfo({ ...task, endedAt: task.endedAt ?? Date.now() });
        if (JSON.stringify(next[info.id]) !== JSON.stringify(info)) { next[info.id] = info; changed = true; }
      }
      return changed ? next : current;
    });
  }, [taskList]);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);

  const hubCoverUrls = useRef<string[]>([]);
  useEffect(() => () => { hubCoverUrls.current.forEach((url) => URL.revokeObjectURL(url)); hubCoverUrls.current = []; }, []);
  const loadHub = useCallback(async () => {
    setHubState('loading');
    const nextUrls: string[] = [];
    try {
      const store = catalogue.current!;
      const shoots = (await store.listProjects()).filter((shoot: ShootDescriptor) => !shoot.inbox);
      const loaded = await Promise.all(shoots.map(async (shoot) => {
        const frames = (await store.loadProject(shoot.id))?.frames ?? [];
        // The best favourites at review size, developed from the RAW where that is cached. Never the original itself.
        const previews = await projectPreviewBlobs(frames);
        const url = previews.cover ? URL.createObjectURL(previews.cover) : '';
        const samples = previews.samples.map((blob) => URL.createObjectURL(blob));
        nextUrls.push(...(url ? [url] : []), ...samples);
        return shootToProject(shoot, frames, url, samples);
      }));
      hubCoverUrls.current.forEach((url) => URL.revokeObjectURL(url));
      hubCoverUrls.current = nextUrls;
      setProjects(loaded);
      setHubState(loaded.length ? 'ready' : 'empty');
    } catch {
      nextUrls.forEach((url) => URL.revokeObjectURL(url));
      setHubState('error');
    }
  }, []);
  useEffect(() => { void loadHub(); }, [loadHub]);

  // Save the open project whenever it changes. A failed save is never dropped (G07): the latest state of each project is
  // kept and retried until it is stored, and closing InFlight asks first while a failed change is still unsaved.
  const saveGuard = useRef<SaveGuard<CullingState> | null>(null);
  if (!saveGuard.current) {
    saveGuard.current = createSaveGuard<CullingState>({
      save: (next) => catalogue.current!.saveProject(next),
      onStatus: (status, { failures }) => {
        if (status === 'failed' && failures === 1) setNotice(engineText.workspace.projectSaveRetrying);
        else if (status === 'saved' && failures > 0) setNotice(engineText.workspace.projectSavedAfterRetry);
      },
    });
  }
  useEffect(() => {
    if (!state || screen !== 'editor') return;
    saveGuard.current!.submit(state.shoot.id, state);
  }, [state, screen]);
  useEffect(() => {
    const guard = saveGuard.current!;
    const retry = () => { if (document.visibilityState !== 'hidden') guard.retryNow(); };
    const warn = (event: BeforeUnloadEvent) => {
      if (!guard.hasFailedUnsaved()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
      window.removeEventListener('beforeunload', warn);
    };
  }, []);
  // Not disposed on unmount: a pending retry must still store the change (and React's development double-mount would
  // otherwise switch the guard off).

  const openRequest = useRef(0);
  useEffect(() => () => { openRequest.current += 1; }, []);

  const enterProject = useCallback((next: CullingState, restored?: BrowserPreviewProvider) => {
    openRequest.current += 1;
    provider.current!.clear();
    if (restored) provider.current = restored;
    thumbs.current.ticket?.cancel();
    thumbs.current = { generation: thumbs.current.generation + 1, requested: new Set<string>(), queue: [] as PhotoFrame[], active: 0, ticket: null };
    setUrls({});
    setAssists({});
    setSelected(next.selectedFrameId ? [next.selectedFrameId] : []);
    setState(next);
    setScreen('editor');
  }, []);

  const openProject = useCallback(async (id: string) => {
    const request = ++openRequest.current;
    const store = catalogue.current!;
    const restored = new BrowserPreviewProvider();
    setHubState('loading');
    try {
      const project = await store.loadProject(id);
      if (request !== openRequest.current) return;
      if (!project) throw new Error('Missing project');
      // Restore stored Blobs and register native path readers. Opening the
      // catalogue does not require a connected drive or a full RAW decode.
      await rehydrateLocalFramesFromStore(project.frames, restored, store, { checkPaths: false });
      if (request !== openRequest.current) return;
      enterProject(project, restored);
    } catch {
      if (request === openRequest.current) {
        setHubState('ready');
        setNotice(engineText.workspace.projectNotOpened);
      }
    } finally {
      if (provider.current !== restored) restored.clear();
    }
  }, [enterProject]);

  // Thumbnails: a few at a time, so a large project does not start thousands of reads at once. Each photo is asked for
  // once; a read in flight is never thrown away when more photos arrive, only when the project changes (generation).
  const thumbs = useRef({
    generation: 0, requested: new Set<string>(), queue: [] as PhotoFrame[],
    active: 0, ticket: null as import('../../core/engineScheduler').SchedulerTicket | null,
  });
  const pumpThumbnails = useCallback(() => {
    const book = thumbs.current;
    if (book.active || !book.queue.length) return;
    const frames = book.queue.splice(0);
    const generation = book.generation;
    book.active = 1;
    const sourceProvider = provider.current!;
    void engineScheduler.submit({
      title: engineText.workspace.thumbnailsTask(frames.length), kind: 'thumbnail', resource: 'io',
      priority: 1, pauseable: frames.length > 1, items: frames,
      snapshot: { generation, keys: frames.map(frame => frame.stableKey) },
      itemId: frame => frame.id, itemLabel: frame => frame.filename,
      runItem: async (frame, _, ctx) => {
        ctx.stage(engineText.workspace.thumbnailStage);
        const thumb = await sourceProvider.getThumbnailUrl(frame, 'visible');
        ctx.checkCancelled();
        if (generation !== thumbs.current.generation) return;
        if (!thumb) {
          ctx.commitIfCurrent(() => setUrls(current =>
            ({ ...current, [frame.id]: { ...current[frame.id], failed: true } })));
          throw new Error(engineText.workspace.thumbnailFailed(frame.filename));
        }
        ctx.commitIfCurrent(() => setUrls(current => current[frame.id]?.thumb ? current
          : { ...current, [frame.id]: { ...current[frame.id], thumb } }));
      },
    }).then(ticket => {
      book.ticket = ticket;
      return ticket.finished;
    }).catch(() => {
      // Individual file failures are shown in the task and unavailable tile.
    }).finally(() => {
      if (generation !== thumbs.current.generation) return;
      book.active = 0;
      book.ticket = null;
      pumpThumbnails();
    });
  }, []);
  const projectId = state?.shoot.id;
  const frameCount = state?.frames.length ?? 0;
  useEffect(() => {
    if (!projectId) return;
    const book = thumbs.current;
    for (const frame of stateRef.current?.frames ?? []) {
      if (frame.removedAt || book.requested.has(frame.id)) continue;
      book.requested.add(frame.id);
      book.queue.push(frame);
    }
    pumpThumbnails();
  }, [projectId, frameCount, pumpThumbnails]);

  // The photo on the canvas gets the larger preview, ahead of the queue.
  const activeId = state?.selectedFrameId ?? state?.frames.find((frame) => !frame.removedAt)?.id ?? null;
  useEffect(() => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === activeId);
    if (!frame || urls[frame.id]?.preview) return;
    let live = true;
    provider.current!.getFullPreviewUrl(frame, 'selected').then(
      (preview) => { if (live) setUrls((current) => ({ ...current, [frame.id]: { ...current[frame.id], preview } })); },
      () => { /* the thumbnail stays; the tile already says if the original is unavailable */ },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Developing, relinking or replacing an original revokes the provider's blob URLs. Forget them for every photo of
  // that original and ask again, so views that draw `previewUrl` directly (the All formats board) never show a dead link.
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const listenedProvider = useRef<{ source: BrowserPreviewProvider; detach: () => void } | null>(null);
  useEffect(() => {
    const source = provider.current;
    if (!source || listenedProvider.current?.source === source) return;
    listenedProvider.current?.detach();
    const onSourceChanged = (event: Event) => {
      const stableKey = (event as CustomEvent<string>).detail;
      if (provider.current !== source || typeof stableKey !== 'string') return;
      const frames = stateRef.current?.frames ?? [];
      setUrls((current) => dropSourceUrls(current, frames, stableKey).urls);
      const affected = frames.filter((frame) => frame.stableKey === stableKey && !frame.removedAt);
      for (const frame of affected) {
        thumbs.current.requested.add(frame.id);
        thumbs.current.queue.push(frame);
      }
      pumpThumbnails();
      const active = affected.find((frame) => frame.id === activeIdRef.current);
      if (active) source.getFullPreviewUrl(active, 'selected').then(
        (preview) => { if (provider.current === source && preview) setUrls((current) => ({ ...current, [active.id]: { ...current[active.id], preview } })); },
        () => { /* the refreshed thumbnail stays */ },
      );
    };
    // The full-preview cache made room: only the large preview was revoked. A photo revisited later asks again.
    const onPreviewReleased = (event: Event) => {
      const stableKey = (event as CustomEvent<string>).detail;
      if (provider.current !== source || typeof stableKey !== 'string') return;
      const frames = stateRef.current?.frames ?? [];
      setUrls((current) => dropSourcePreview(current, frames, stableKey).urls);
      const active = frames.find((frame) => frame.stableKey === stableKey && !frame.removedAt && frame.id === activeIdRef.current);
      if (active) source.getFullPreviewUrl(active, 'selected').then(
        (preview) => { if (provider.current === source && preview) setUrls((current) => ({ ...current, [active.id]: { ...current[active.id], preview } })); },
        () => { /* the thumbnail stays */ },
      );
    };
    source.events.addEventListener('developed', onSourceChanged);
    source.events.addEventListener('preview-invalidated', onSourceChanged);
    source.events.addEventListener('full-preview-released', onPreviewReleased);
    listenedProvider.current = {
      source,
      detach: () => {
        source.events.removeEventListener('developed', onSourceChanged);
        source.events.removeEventListener('preview-invalidated', onSourceChanged);
        source.events.removeEventListener('full-preview-released', onPreviewReleased);
      },
    };
  });
  useEffect(() => () => { listenedProvider.current?.detach(); listenedProvider.current = null; }, []);

  // Automatic backups of the open project, shared with V1: soon after a change, every so often, and on leaving.
  useAutoBackup(state && !state.shoot.collage ? state : null, Boolean(state));
  const backupStatus = useBackupStatus(state?.shoot.id ?? '');
  // First run: pick photos, and InFlight makes a project, adds them and runs Auto on the first one.
  const [quickStart, setQuickStart] = useState<{ projectId: string; photoId: string | null; phase: 'working' | 'ready' | 'unchanged' | 'failed' } | null>(null);
  const lightroomPending = useRef<{ projectId: string; photos: LightroomPhoto[]; toAdd: LightroomPhoto[] } | null>(null);
  const [lightroomOffer, setLightroomOffer] = useState<{ missing: number; folder: string } | null>(null);
  const mutate = useCallback((change: (current: CullingState) => CullingState) => setState((current) => (current ? change(current) : current)), []);

  // RAW + JPEG of one shot are one photo: the JPEG is kept but not listed, and decisions and ratings cover both.
  const pairs = useMemo(() => rawJpegPairs(state?.frames ?? []), [state?.frames]);
  const pairsRef = useRef(pairs);
  pairsRef.current = pairs;
  const decide = useCallback((given: string[], decision: CullDecision) => {
    const ids = withPartners(given, pairsRef.current);
    mutate((current) => ids.reduce((next, id) => applyDecisionWithHistory(next, id, decision, { allowAdvance: false }), current));
  }, [mutate]);

  // Moves already set-aside (rejected) photos to Trash. removeFromLibrary (shared with V1) ignores any id that
  // is not currently rejected, so this never deletes a kept or unreviewed photo by mistake. The removal itself is
  // written to the same undoStack that per-photo Undo already reads, so Cmd/Ctrl+Z brings it straight back.
  // RAWs imported before the sensor-size reader (or whose EXIF had no size) landed as a 1x1 Original: read the
  // recorded size from the original's own IFDs in the background, once per photo, and record it.
  const rawSizeTried = useRef(new Set<string>());
  const rawSizeWaiting = (state?.frames ?? []).filter((frame) => !frame.removedAt && !frame.isDemo && isRawPreviewFile(frame.filename)
    && !(frame.exif.width && frame.exif.height) && !rawSizeTried.current.has(frame.id)).map((frame) => frame.id).join(',');
  useEffect(() => {
    if (!rawSizeWaiting || !provider.current) return;
    let live = true;
    void (async () => {
      for (const id of rawSizeWaiting.split(',')) {
        if (!live) return;
        rawSizeTried.current.add(id);
        const frame = stateRef.current?.frames.find((candidate) => candidate.id === id);
        if (!frame) continue;
        const original = await provider.current!.ensureOriginal(frame.stableKey, 'background').catch(() => undefined);
        if (!original || !live) continue;
        const size = await original.slice(0, 2 << 20).arrayBuffer().then((buffer) => rawSensorSize(new Uint8Array(buffer))).catch(() => null);
        if (!size || !live) continue;
        mutate((current) => ({ ...current, frames: current.frames.map((item) => item.id === id && !(item.exif.width && item.exif.height)
          ? { ...item, exif: { ...item.exif, width: size.width, height: size.height } } : item) }));
      }
    })();
    return () => { live = false; };
  }, [rawSizeWaiting, mutate]);

  const removePhotos = useCallback((given: string[]) => {
    const ids = withPartners(given, pairsRef.current);
    mutate((current) => removeFromLibrary(current, ids));
    setSelected((current) => current.filter((id) => !ids.includes(id)));
  }, [mutate]);

  const activeFrame = state?.frames.find((frame) => frame.id === activeId) ?? null;
  // Measure the original only when the user opens an ordinary JPEG/PNG photo.
  // Do NOT promote a RAW embedded JPEG, EXIF or a cached review preview to native.
  const activeRasterKey = activeFrame ? `${activeFrame.stableKey}|${activeFrame.originalSha256 ?? ''}` : null;
  useEffect(() => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === activeId);
    if (!frame || !activeRasterKey || frame.isDemo || !fullResolutionRasterFormat(frame.filename) ||
        verifiedRasterSizes[activeRasterKey]) return;
    const controller = new AbortController();
    void loadVerifiedRasterOriginalForExport(frame, provider.current!, controller.signal).then(
      (image) => {
        if (!controller.signal.aborted) setVerifiedRasterSizes((current) => ({
          ...current, [activeRasterKey]: { width: image.naturalWidth, height: image.naturalHeight },
        }));
      },
      () => { /* Remain at an unverified preview size; never invent native pixels. */ },
    );
    return () => controller.abort();
    // Depends on source identity, not editing controls or unstable frame objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeRasterKey]);
  const editTargets = (photoId: string) => (selected.includes(photoId) ? selected : [photoId]);
  const editFrames = useCallback((ids: string[], change: (frame: PhotoFrame) => PhotoEdit | undefined, why?: EditWhy) => {
    const at = Date.now();
    mutate((current) => ({
      ...current,
      shoot: { ...current.shoot, lastUpdatedAt: at },
      frames: current.frames.map((frame) => {
        if (!ids.includes(frame.id)) return frame;
        const edit = change(frame);
        return syncEditGroup(recordEdit(frame, { edit: edit && !isEmptyEdit(edit) ? edit : undefined }, at, why));
      }),
    }));
  }, [mutate]);
  const applyPatch = useCallback((ids: string[], patch: Partial<EditRecipe>) => {
    const { unmapped } = applyRecipePatch(undefined, patch);
    if (unmapped.length) setNotice(engineText.workspace.notConnected(unmapped.join(', ')));
    editFrames(ids, (frame) => applyRecipePatch(frame.edit, patch).edit);
  }, [editFrames]);

  // RAW photos are developed from their sensor data in the background, so V2 shows InFlight's develop, not the camera's
  // JPEG. The photo on the canvas goes first. Paused while photos are being imported.
  useBackgroundDevelop({
    projectId: state?.shoot.id ?? '', frames: state?.frames ?? [], provider: provider.current,
    active: screen === 'editor' && Boolean(state) && !importing, onScreen: activeId,
    // Keep the camera's as-shot white with the photo, so Temperature can show kelvin. Never changes an edit.
    onAsShotWhite: (stableKey, white) => setState((current) => (current ? { ...current, frames: current.frames.map((frame) =>
      frame.stableKey === stableKey && (frame.asShotWhite?.kelvin !== white.kelvin || frame.asShotWhite?.duv !== white.duv)
        ? { ...frame, asShotWhite: white } : frame) } : current)),
    // Lets the picture label name Nikon HE/HE*. Never changes an edit.
    onRawCodec: (stableKey, codec) => setState((current) => (current ? { ...current, frames: current.frames.map((frame) =>
      frame.stableKey === stableKey && frame.rawCodec !== codec ? { ...frame, rawCodec: codec } : frame) } : current)),
  });

  // Subject and species are named quietly on this device after photos are added (the species name is a suggestion the
  // person can change, and it never changes a decision). The species check is the Pro feature `speciesId`.
  useSpeciesScan({
    projectId: state?.shoot.id ?? '', frames: state?.frames ?? [], provider: provider.current,
    active: screen === 'editor' && Boolean(state) && can('speciesId'),
    // A vehicle reading is carried across its burst: the same aircraft, read once, shown on every frame.
    onResult: (frameId, patch) => setState((current) => (current ? { ...current, frames: carryVehicleReadings(current.frames.map((frame) =>
      frame.id === frameId && !frame.removedAt && !frame.speciesChecked && !frame.tags?.length && !frame.subjectNames?.length
        ? { ...frame, ...patch, ...(frame.subjectKind && patch.subjectKind ? { subjectKind: frame.subjectKind } : {}) } : frame), VEHICLE_LABELS) } : current)),
  });

  // Bursts are refined quietly on this device from image embeddings (DINOv2): a real scene change splits a burst, and
  // look-alike frames without capture times group. Never changes a decision; paused while photos are being imported.
  useVisualGrouping({
    projectId: state?.shoot.id ?? '', frames: state?.frames ?? [], provider: provider.current,
    active: screen === 'editor' && Boolean(state) && !importing, onScreen: activeId,
    onEmbedded: (frameId, embedding) => setState((current) => (current ? { ...current, frames: current.frames.map((frame) =>
      frame.id === frameId ? { ...frame, visualEmbedding: embedding } : frame) } : current)),
    onBatchDone: () => setState((current) => {
      const regrouped = current ? regroupBurstsWithEmbeddings(current.frames) : null;
      return current && regrouped ? { ...current, frames: regrouped } : current;
    }),
  });

  const activePhotoExport = useRef<number | null>(null);
  useEffect(() => () => {
    if (activePhotoExport.current !== null) {
      tasks.cancel(activePhotoExport.current);
      activePhotoExport.current = null;
    }
  }, [projectId]);
  const runExportAction = useCallback(async (request: ExportRequest) => {
    const current = stateRef.current;
    if (!current) return;
    if (activePhotoExport.current !== null && request.destination !== 'local-individual' && request.destination !== 'local-folder') {
      setNotice(engineText.workspace.exportRunning); return;
    }
    const sourceProvider = provider.current!;
    const env = exportEnv.current;
    if (request.rawMaster) {
      const masterFormat = request.rawMasterFormat === 'png' ? 'png' : 'tiff';
      const png = masterFormat === 'png';
      const matches = current.frames.filter((frame) => frame.id === request.photoIds[0] && frame.removedAt == null);
      if (request.photoIds.length !== 1 || matches.length !== 1) { setNotice(png ? engineText.workspace.selectOneRawPng : engineText.workspace.selectOneRaw); return; }
      try {
        const frame = structuredClone(matches[0]);
        const ticket = await engineScheduler.submit({
          title: png ? engineText.workspace.rawPngTask : engineText.workspace.rawTiffTask, kind: 'raw', resource: 'gpu', priority: 10,
          pauseable: false, items: [{ id: frame.id, name: frame.filename }],
          snapshot: { frameId: frame.id, originalSha256: frame.originalSha256 },
          itemId: item => item.id, itemLabel: item => item.name,
          runItem: async (_, __, ctx) => {
            ctx.stage(engineText.workspace.rawTiffDevelop);
            const file = await buildRawMasterFile(frame, sourceProvider, ctx.signal, masterFormat);
            ctx.checkCancelled();
            ctx.stage(png ? engineText.workspace.rawPngSave : engineText.workspace.rawTiffSave);
            if (!await saveExportFile(file, file.name, ctx.signal))
              throw new DOMException(engineText.workspace.saveCancelled, 'AbortError');
            ctx.acknowledgeCommitted();
            ctx.commitIfCurrent(() => setNotice(png ? engineText.workspace.rawPngSaved : engineText.workspace.rawTiffSaved));
          },
        });
        const result = await ticket.finished;
        if (result === 'failed') setNotice(png ? engineText.workspace.rawPngFailed : engineText.workspace.rawTiffFailed);
        else if (result === 'cancelled') setNotice(png ? engineText.workspace.rawPngCancelled : engineText.workspace.rawTiffCancelled);
      } catch (reason) {
        setNotice(reason instanceof Error ? reason.message : (png ? engineText.workspace.rawPngNotQueued : engineText.workspace.rawTiffNotQueued));
      }
      return;
    }
    const plan = planExport(request, current.frames, createDefaultSizes());
    if ('error' in plan) { setNotice(plan.error); return; }
    // One photograph / output variant per scheduler item. Unlike a ZIP, local
    // individual and exclusive-folder saves have safe, confirmed file boundaries.
    // The snapshot survives edits made while the batch is waiting in the queue.
    if (request.destination === 'local-zip' || request.destination === 'local-individual' || request.destination === 'local-folder') {
      const count = photoExportUnits(plan, current.frames).length;
      const submittedEnv = structuredClone(env);
      try {
        const ticket = await scheduleV2PhotoExports({
          request, plan, frames: current.frames, provider: sourceProvider,
          buildOverlay: (frame, submittedRequest) => buildOverlayDraw(frame, submittedRequest, submittedEnv),
        });
        if (!ticket) { setNotice(engineText.workspace.noFolder); return; }
        setNotice(engineText.workspace.exportQueued(count));
        void ticket.finished.then(result => {
          if (result === 'done') setNotice(engineText.workspace.exportDone(count));
          else if (result === 'failed') setNotice(engineText.workspace.exportSomeFailed);
          else setNotice(engineText.workspace.exportStopped);
        });
      } catch (error) {
        setNotice(error instanceof Error ? error.message : engineText.workspace.exportNotQueued);
      }
      return;
    }
    setNotice(engineText.workspace.destinationUnavailable);
  }, []);

  const runAutoCull = useCallback(async () => {
    const current = stateRef.current;
    if (!current) return;
    if (!can('smartCulling')) { setNotice(engineText.workspace.cullPro); return; }
    if (cullController.current) { setNotice(engineText.workspace.cullRunning); return; }
    const candidates = current.frames.filter(frame =>
      frame.removedAt == null && frame.decision === 'unreviewed' && !frame.isDemo && !frame.virtualCopy);
    if (!candidates.length) { setNotice(engineText.workspace.cullNothing); return; }
    const controller = new AbortController();
    cullController.current = controller;
    const projectKey = current.shoot.id;
    const requestId = openRequest.current;
    try {
      // Keeper selection requires all shoot-wide evidence, so it is one
      // non-pauseable unit. Per-photo progress is real; cancellation prevents
      // a late scan-wide decision from changing the catalogue.
      const ticket = await engineScheduler.submit({
        title: engineText.workspace.cullTask,
        kind: 'cull', resource: 'cpu', priority: 5, pauseable: false,
        items: [{ id: projectKey, label: candidates.length + ' photos' }],
        snapshot: { projectKey, requestId, candidates: candidates.map(frame => frame.id) },
        itemId: item => item.id, itemLabel: item => item.label,
        runItem: async (_, __, ctx) => {
          ctx.stage(engineText.workspace.cullScan);
          ctx.setSubitems(candidates.map(frame => ({ id: frame.id, label: frame.filename })));
          const results = await scanForCulling(candidates, current.frames, provider.current!, null,
            ctx.signal, count => ctx.reportProgress(count, candidates.length, `${count} of ${candidates.length} analysed`),
            () => ctx.commitIfCurrent(() => setNotice(engineText.workspace.cullNoDetector)),
            (frameId, stage) => ctx.updateSubitem(frameId,
              stage === 'analysing' ? 'running' : 'done',
              stage === 'unavailable' ? engineText.workspace.cullDetectorStage : stage));
          ctx.checkCancelled();
          if (requestId !== openRequest.current || stateRef.current?.shoot.id !== projectKey) return;
          ctx.stage(engineText.workspace.cullApply);
          ctx.commitIfCurrent(() => setState(latest => {
            if (!latest || latest.shoot.id !== projectKey || requestId !== openRequest.current || ctx.signal.aborted) return latest;
            return commitAutoCull(latest, candidates, results);
          }));
          const summary = `Auto-cull checked ${candidates.length} photo${candidates.length === 1 ? '' : 's'}. Review the flags in the filmstrip. You can undo the whole pass in one step.`;
          ctx.commitIfCurrent(() => setNotice(summary));
        },
      });
      controller.signal.addEventListener('abort', () => ticket.cancel(), { once: true });
      if (controller.signal.aborted) ticket.cancel();
      const result = await ticket.finished;
      if (result === 'failed') setNotice(engineText.workspace.cullFailed);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : engineText.workspace.cullNotQueued);
    } finally {
      controller.abort();
      if (cullController.current === controller) cullController.current = null;
    }
  }, [can]);

  /** Text and watermark overlays stay with the photograph and are reversible in its saved history. */
  const changeOverlay = useCallback((photoId: string, change: (overlay: OverlaySettings) => OverlaySettings) => {
    const at = Date.now();
    mutate((current) => {
      let changed = false;
      const frames = current.frames.map((frame) => {
        if (frame.id !== photoId) return frame;
        const next = changePhotoOverlay(frame, change, at);
        if (next !== frame) changed = true;
        return next;
      });
      return changed ? { ...current, shoot: { ...current.shoot, lastUpdatedAt: at }, frames } : current;
    });
  }, [mutate]);

  /** Add an image layer on top of the photo's stack, sized to fit its frame. */
  const addLayerTo = useCallback((photoId: string, assetId: string, label: string, aspect: number, widthShare = 0.5) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    if (!frame) return;
    if (readOverlay(frame.overlay).layers?.length === MAX_LAYERS) { setNotice(`A photo can have up to ${MAX_LAYERS} layers. Remove one to add another.`); return; }
    const w = frame.exif.width || 3, h = frame.exif.height || 2;
    const framed = framedSize(w, h, frame.framing ?? DEFAULT_FRAMING);
    changeOverlay(photoId, (overlay) => addLayer(overlay, newLayer(`layer-${newId().slice(0, 8)}`, assetId, label, aspect, framed.height / framed.width, widthShare)));
  }, [changeOverlay]);

  // 'auto' watermark: light or dark from the pixels behind it, using the same measure as the export (src/core/watermark.ts).
  const activeOverlay = activeFrame ? readOverlay(activeFrame.overlay) : null;
  const detectKey = activeFrame && activeOverlay?.watermarkEnabled && activeOverlay.watermarkContrast === 'auto'
    ? `${activeFrame.id}|${activeOverlay.watermarkX}|${activeOverlay.watermarkY}|${activeOverlay.watermarkScale}` : null;
  useEffect(() => {
    if (!detectKey || !activeFrame || !activeOverlay) return;
    let live = true;
    const frame = activeFrame, overlay = activeOverlay;
    provider.current!.getFullPreviewUrl(frame, 'selected').then(async (url) => {
      if (!url || !live) return;
      const image = await new Promise<HTMLImageElement>((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = reject; element.src = url; });
      const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      // The patch the watermark covers: about 22% by 12% of the frame, scaled with the watermark, centred on its position.
      const w = Math.max(8, Math.round(canvas.width * 0.22 * (overlay.watermarkScale / 100))), h = Math.max(8, Math.round(canvas.height * 0.12 * (overlay.watermarkScale / 100)));
      const x = Math.min(canvas.width - w, Math.max(0, Math.round((overlay.watermarkX / 100) * canvas.width - w / 2)));
      const y = Math.min(canvas.height - h, Math.max(0, Math.round((overlay.watermarkY / 100) * canvas.height - h / 2)));
      const patch = context.getImageData(x, y, w, h);
      const tone = watermarkToneForPixels(patch.data, patch.width, patch.height);
      if (live) setWatermarkAuto((current) => ({ ...current, [frame.id]: tone === 'light' ? 'light-on-dark' : 'dark-on-light' }));
    }).catch(() => { /* no measurement: the watermark falls back to light on dark */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectKey]);

  // The histogram is measured from the picture as it is now: the preview with this photo's edit applied, small and debounced.
  const histogramKey = activeFrame ? `${activeFrame.id}|${JSON.stringify(activeFrame.edit ?? null)}|${JSON.stringify(activeFrame.framing ?? null)}` : null;
  useEffect(() => {
    if (!histogramKey || !activeFrame) return;
    let live = true;
    const frame = activeFrame;
    const timer = window.setTimeout(() => {
      provider.current!.getFullPreviewUrl(frame, 'selected').then(async (url) => {
        if (!url || !live) return;
        const image = await new Promise<HTMLImageElement>((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = reject; element.src = url; });
        // When the file records no size, the shown picture gives the photo its shape. For a plain picture file that is
        // the original size; for RAW and HEIF it is the preview's size, which the export renderer never enlarges past.
        if (live && !(frame.exif.width && frame.exif.height)) setPixelSizes((current) => (current[frame.id]?.width === image.naturalWidth && current[frame.id]?.height === image.naturalHeight ? current : { ...current, [frame.id]: { width: image.naturalWidth, height: image.naturalHeight } }));
        const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        applyCanvasPhotoEdit(canvas, frame.edit ?? EMPTY_EDIT);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        if (live) setHistograms((current) => ({ ...current, [frame.id]: toPhotoHistogram(pixels) }));
      }).catch(() => { /* no measurement: the panel says it is still measuring, never a made-up curve */ });
    }, 160);
    return () => { live = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [histogramKey]);

  // Once the active photo's masks settle (debounced, same idea as the histogram above but a real pixel
  // render so it waits for a pause rather than running on every drag tick), run them through the real
  // verified-and-retried engine action (maskVerify.ts's verifyFrameMasks -> engine/maskAction.ts) instead
  // of trusting whatever a slider was left at. Scoped to the one open photo, same boundary the histogram
  // and watermark-tone checks already draw. A mask whose effect held up changes nothing here (attempts
  // === 1, the common case); one that did not is written back at the strength that actually passed, with
  // a plain notice - never left silently at a value the check could not confirm.
  const maskVerifyKey = activeFrame && projectId && hasActiveMasks(activeFrame.edit?.masks)
    ? maskVerificationKey(projectId, activeFrame) : null;
  useEffect(() => {
    if (!maskVerifyKey || !activeFrame || !projectId) return;
    const controller = new AbortController();
    const frame = activeFrame;
    const capturedProject = projectId;
    const sourceProvider = provider.current!;
    const timer = window.setTimeout(() => {
      (async () => {
        try {
          const image = await loadExportSource(frame, sourceProvider);
          if (controller.signal.aborted) return;
          const outcome = await verifyFrameMasks(image, frame, controller.signal);
          if (controller.signal.aborted || !outcome || outcome.attempts <= 1) return;
          const currentState = stateRef.current;
          const latest = currentState?.frames.find(candidate => candidate.id === frame.id);
          if (!latest || currentState?.shoot.id !== capturedProject ||
              maskVerificationKey(capturedProject, latest) !== maskVerifyKey) return;
          const at = Date.now();
          mutate(current => controller.signal.aborted ? current :
            commitVerifiedMasks(current, capturedProject, frame, outcome.masks, at));
          setNotice(outcome.verification.ok
            ? `A mask's strength was reduced to keep its effect plausible.`
            : `A mask's effect still looked too strong after retrying, so it was left at the gentlest version tried${outcome.verification.reasons.length ? ': ' + outcome.verification.reasons.join(' ') : '.'}`);
        } catch {
          // A failed safety check must not block the manual editor.
        }
      })();
    }, 500);
    return () => { controller.abort(); window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskVerifyKey]);

  /** Each format's crop lives with the photo (saved, backed up, used by the export). It is not an edit, so it is not in edit history. */
  const changeCrops = useCallback((photoId: string, sizeIds: string[], change: (crop: ReturnType<typeof readCrops>[string] | undefined) => ReturnType<typeof readCrops>[string]) => {
    const at = Date.now();
    mutate((current) => ({
      ...current,
      shoot: { ...current.shoot, lastUpdatedAt: at },
      frames: current.frames.map((frame) => {
        if (frame.id !== photoId) return frame;
        const crops = readCrops(frame.sizeCrops);
        let formatHistory = frame.formatHistory;
        for (const id of sizeIds) {
          const before = crops[id] ?? DEFAULT_CROP;
          const after = change(crops[id]);
          crops[id] = after;
          formatHistory = recordFormatCrop(formatHistory, id, before, after, at);
        }
        return { ...frame, sizeCrops: crops, formatHistory };
      }),
    }));
  }, [mutate]);

  /** Change a photo's format set. Returns false when the change was refused (nothing is saved). `crops` may also rewrite the saved crops. */
  const changeFormats = useCallback((photoId: string, change: (raw: unknown) => FormatSet | undefined, crops?: (raw: unknown) => unknown): boolean => {
    const current = stateRef.current;
    const frame = current?.frames.find((candidate) => candidate.id === photoId);
    if (!current || !frame) return false;
    const next = change(frame.formats);
    if (!next) return false;
    const at = Date.now();
    mutate((state) => ({ ...state, shoot: { ...state.shoot, lastUpdatedAt: at }, frames: state.frames.map((entry) => (entry.id === photoId ? { ...entry, formats: next,
      formatHistory: recordFormatSetChange(entry.formatHistory, entry.formats, next, at, entry.editHistory?.cursor ?? 0),
      ...(crops ? { sizeCrops: crops(entry.sizeCrops) } : {}) } : entry)) }));
    return true;
  }, [mutate]);

  /** Flip a format between paper-clipped to the active edit group and independent. Only that one photo's choice changes. */
  const toggleSizeLinked = useCallback((photoId: string, sizeId: string) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    if (!frame) return;
    const next = toggleSizeLinkedRaw(frame.sizeLinked, sizeId);
    const at = Date.now();
    mutate((state) => ({ ...state, shoot: { ...state.shoot, lastUpdatedAt: at }, frames: state.frames.map((entry) => (entry.id === photoId ? { ...entry, sizeLinked: next, formatHistory: recordFormatLink(entry.formatHistory, sizeId, next[sizeId] ?? true, at) } : entry)) }));
  }, [mutate]);

  /** Change a photo's video pan/zoom (Ken Burns) settings. Only the given fields change; the rest are kept. */
  const updateVideoZoom = useCallback((photoId: string, patch: Parameters<typeof patchVideoZoom>[1]) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    if (!frame) return;
    const next = patchVideoZoom(frame.videoZoom, patch);
    const at = Date.now();
    mutate((state) => ({ ...state, shoot: { ...state.shoot, lastUpdatedAt: at }, frames: state.frames.map((entry) => (entry.id === photoId ? { ...entry, videoZoom: next } : entry)) }));
  }, [mutate]);

  /** Save each split/rejoin or pan-offset as a genuinely undoable edit. Older
   * projects used a photo-wide splitFrames flag with no per-format record:
   * capture its effective two-frame state before changing it, so Undo restores
   * that layout rather than an invented empty baseline. */
  const recordSplitChange = (entry: PhotoFrame, next: ReturnType<typeof writeSplitFrameCount>, at: number): PhotoFrame => {
    const legacy = entry.splitFrames === true
      ? { 'orig-3x2': { enabled: true, offset: readSplitPanOffset(entry.splitPanOffset) } }
      : {};
    const before = entry.formatSplits ?? legacy;
    return recordEdit({ ...entry, formatSplits: before }, { formatSplits: next }, at);
  };

  /** Split only the active FORMAT; other outputs of the photo are unaffected. */
  const toggleSplitFrames = useCallback((photoId: string) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    const sizeId = stub.store.activeSizeId;
    if (!frame || !sizeId) return;
    const next = toggleFormatSplit(frame.formatSplits ?? (frame.splitFrames === true ? { 'orig-3x2': { enabled: true, offset: readSplitPanOffset(frame.splitPanOffset) } } : undefined), sizeId);
    const at = Date.now();
    mutate((state) => ({ ...state, shoot: { ...state.shoot, lastUpdatedAt: at }, frames: state.frames.map((entry) => (entry.id === photoId ? recordSplitChange(entry, next, at) : entry)) }));
  }, [mutate, stub.store.activeSizeId]);

  /** One format's persisted 1/2/3 continuous split, used by both V2 canvas and export planner. */
  const setSplitFrameCount = useCallback((photoId: string, sizeId: string, count: SplitFrameCount) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId && candidate.removedAt == null);
    if (!frame || !isSplitFrameCount(count)) return;
    const sizes = applyFormats(createDefaultSizes(), frame.formats);
    if (!sizes.some((size) => size.id === sizeId && size.kind === 'photo')) {
      setNotice(engineText.workspace.formatFirst);
      return;
    }
    const current = frame.formatSplits ?? (frame.splitFrames === true
      ? { 'orig-3x2': { enabled: true, offset: readSplitPanOffset(frame.splitPanOffset) } } : undefined);
    const next = writeSplitFrameCount(current, sizeId, count);
    const at = Date.now();
    mutate((state) => ({ ...state, shoot: { ...state.shoot, lastUpdatedAt: at },
      frames: state.frames.map((entry) => entry.id === photoId ? recordSplitChange(entry, next, at) : entry) }));
    setNotice(count === 1 ? engineText.workspace.formatRejoined : engineText.workspace.formatSplit(count));
  }, [mutate]);

  /** Move both halves together inside this format's two-section composition. */
  const setSplitPanOffset = useCallback((photoId: string, offset: number) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    const sizeId = stub.store.activeSizeId;
    if (!frame || !sizeId) return;
    const next = setFormatSplitOffset(frame.formatSplits ?? (frame.splitFrames === true ? { 'orig-3x2': { enabled: true, offset: readSplitPanOffset(frame.splitPanOffset) } } : undefined), sizeId, offset);
    const at = Date.now();
    mutate((state) => ({ ...state, shoot: { ...state.shoot, lastUpdatedAt: at }, frames: state.frames.map((entry) => (entry.id === photoId ? recordSplitChange(entry, next, at) : entry)) }));
  }, [mutate, stub.store.activeSizeId]);

  /** Reuse actual area/gradient masks from the shared engine. Sky detection and brush painting are intentionally gated. */
  const addMask = useCallback(async (photoId: string, type: 'subject' | 'sky' | 'background' | 'brush' | 'area' | 'gradient') => {
    if (type === 'sky') { setNotice(engineText.workspace.skyUnavailable); return; }
    if (type === 'brush') { setNotice(engineText.workspace.brushUnavailable); return; }
    const project = stateRef.current;
    const frame = project?.frames.find((candidate) => candidate.id === photoId && !candidate.removedAt);
    if (!project || !frame) return;
    if (!canAddMask(frame.edit?.masks)) { setNotice(engineText.workspace.masksFull); return; }
    if (type === 'area' || type === 'gradient') {
      const shape = createMask(type === 'area' ? 'radial' : 'linear', newId());
      editFrames([photoId], (latest) => canAddMask(latest.edit?.masks)
        ? ({ ...(latest.edit ?? DEFAULT_EDIT), masks: [...(latest.edit?.masks ?? []), shape] }) : latest.edit);
      setNotice(type === 'area' ? engineText.workspace.ovalAdded : engineText.workspace.gradientAdded);
      return;
    }
    const jobKey = JSON.stringify([project.shoot.id, photoId]);
    if (maskInFlight.current.has(jobKey)) return;
    maskInFlight.current.add(jobKey);
    // Subject and background detection share the GPU queue with export and
    // denoise. This one-photo job cannot pause mid-model; Cancel prevents its
    // eventual result from changing the current photograph.
    void engineScheduler.submit({
      title: type === 'subject' ? engineText.workspace.findSubjectTask : engineText.workspace.findBackgroundTask,
      kind: 'mask', resource: 'gpu', priority: 18,
      pauseable: false, items: [{ id: photoId, name: frame.filename }],
      snapshot: { projectId: project.shoot.id, photoId, framing: frame.framing },
      itemId: item => item.id, itemLabel: item => item.name,
      runItem: async (_, __, ctx) => {
        ctx.stage(engineText.workspace.findEdgesStage);
        // A mask needs the photo's shape and content, not export-grade pixels. A RAW this device cannot develop (for
        // example Nikon HE*) made the export loader throw, so subject detection always failed on such files; it now
        // falls back to the preview shown on the canvas, which has the same framing.
        const image = await loadExportSource(frame, provider.current!).catch(async (reason) => {
          const shown = isRawPreviewFile(frame.filename) || isHeifFile(frame.filename)
            ? await provider.current!.getFullPreviewUrl(frame, 'selected').catch(() => '') : '';
          if (!shown) throw reason;
          return loadImage(shown);
        });
        ctx.checkCancelled();
        const framing = frame.framing ?? DEFAULT_FRAMING;
        const { width, height } = framedSize(image.naturalWidth, image.naturalHeight, framing);
        const framed = document.createElement('canvas');
        drawFramedPhoto(image, framed, framing, { scale: Math.min(1, GUIDED_RENDER_EDGE / Math.max(width, height)) });
        const { grid, assessment, detail, boxFinding } = await detectSubjectGuided(framed);
        ctx.checkCancelled();
        if (!assessment.usable) {
          ctx.commitIfCurrent(() => setNotice(assessment.reason));
          return;
        }
        const mask = {
          ...createSubjectMask(newId(), grid, framingKey(framing), assessment.confidence, detail),
          invert: type === 'background', feather: 0.5,
        };
        const latest = stateRef.current;
        if (!latest || !subjectMaskTarget(latest, project.shoot.id, frame)) {
          ctx.commitIfCurrent(() => setNotice(engineText.workspace.maskDiscarded));
          return;
        }
        const at = Date.now();
        ctx.stage(engineText.workspace.saveMaskStage);
        ctx.commitIfCurrent(() => mutate(current =>
          ctx.signal.aborted ? current : commitSubjectMask(current, project.shoot.id, frame, mask, at)));
        const confidence = boxFinding
          ? (engineText.workspace.confidence as Record<string, string>)[judgeSubject({ label: boxFinding.detection.label, score: boxFinding.detection.score,
              size: Math.max(boxFinding.detection.box.w, boxFinding.detection.box.h),
              sharpness: boxFinding.sharpness }).confidence] ?? ''
          : '';
        ctx.commitIfCurrent(() => setNotice(type === 'subject' ? engineText.workspace.subjectMaskAdded(confidence) : engineText.workspace.backgroundMaskAdded(confidence)));
      },
    }).then(ticket => ticket.finished).then(result => {
      if (result === 'failed') setNotice(engineText.workspace.subjectFailed);
    }).catch(reason => setNotice(reason instanceof Error ? reason.message : engineText.workspace.subjectNotQueued))
      .finally(() => { maskInFlight.current.delete(jobKey); });
  }, [editFrames, mutate]);
  const editMasks = useCallback((photoId: string, change: (masks: ReturnType<typeof removeMask>) => ReturnType<typeof removeMask>) =>
    editFrames([photoId], (frame) => ({ ...(frame.edit ?? DEFAULT_EDIT), masks: change(frame.edit?.masks ?? []) })), [editFrames]);

  // The person pressed "Denoise this photo". Signed in, online and with the cloud feature on, that press is the consent to
  // upload a working-size copy for this one job; otherwise, or if the cloud fails or does not verify, it runs on this device.
  const denoiseInFlight = useRef(new Set<string>());
  const denoisePhoto = useCallback((photoId: string) => {
    const frame = stateRef.current?.frames.find(candidate => candidate.id === photoId);
    if (!frame || denoiseInFlight.current.has(photoId)) return;
    denoiseInFlight.current.add(photoId);
    // Existing explicit cloud opt-in is preserved. A local fallback is labelled
    // with the runner that actually returned, never as a successful cloud job.
    const connection = can('cloudAssist') ? accountConnection() : null;
    void engineScheduler.submit({
      title: engineText.workspace.denoiseTask(frame.filename),
      kind: 'denoise', resource: 'gpu', priority: 12, location: 'local',
      pauseable: false, items: [{ id: photoId, name: frame.filename }],
      snapshot: { photoId, edit: frame.edit ?? DEFAULT_EDIT },
      itemId: item => item.id, itemLabel: item => item.name,
      runItem: async (_, __, ctx) => {
        ctx.stage(engineText.workspace.denoiseStage);
        const outcome = await runV2Denoise(frame, provider.current!,
          connection ? { connection, online: navigator.onLine !== false } : null, ctx.signal);
        ctx.checkCancelled();
        if (!outcome) throw new Error(engineText.workspace.denoiseNoSource);
        ctx.setLocation(outcome.runner === 'cloud-processing' ? 'cloud' : 'local');
        const valid = (current: PhotoFrame) => sameRecipe(current.edit ?? DEFAULT_EDIT, frame.edit ?? DEFAULT_EDIT) &&
          framingKey(current.framing) === framingKey(frame.framing);
        const latest = stateRef.current?.frames.find(candidate => candidate.id === photoId);
        if (!latest || !valid(latest)) {
          ctx.commitIfCurrent(() => setNotice(engineText.workspace.denoisePhotoChanged));
          return;
        }
        if (outcome.verified) {
          ctx.stage(engineText.workspace.denoiseApplyStage);
          ctx.commitIfCurrent(() => editFrames([photoId], current => {
            if (!valid(current)) return current.edit;
            const edit = current.edit ?? DEFAULT_EDIT;
            const id = `auto-denoise-${photoId}`;
            const masks = (edit.masks ?? []).filter(mask => mask.id !== id && mask.id !== `${id}-background`);
            return { ...edit, denoise: outcome.strength, ...(outcome.luminance > 0 ? { denoiseLuminance: outcome.luminance } : {}), masks: [...masks, ...outcome.masks] };
          }));
        }
        ctx.commitIfCurrent(() => setNotice(outcome.verified ? outcome.notes[0] : engineText.denoise.leftAsItWas(outcome.notes.join(' '))));
      },
    }).then(ticket => ticket.finished).then(result => {
      if (result === 'failed') setNotice(engineText.workspace.denoiseFailed);
    }).catch(reason => setNotice(reason instanceof Error ? reason.message : engineText.workspace.denoiseNotQueued))
      .finally(() => { denoiseInFlight.current.delete(photoId); });
  }, [can, editFrames]);

  const applyAuto = useCallback((frameId: string, candidateId?: string) => {
    const assist = assists[frameId];
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === frameId);
    if (!assist || !frame) return;
    const candidate = candidateId ? assist.run.candidates.find((item) => item.id === candidateId) : assist.run.candidates[0];
    if (!candidate || assist.dismissed.includes(candidate.id)) return;
    const valid = (latest: PhotoFrame) => matchesAutoSource(assist.run, latest) && sameRecipe(latest.edit ?? DEFAULT_EDIT, assist.run.plan.base);
    if (!valid(frame)) { setNotice(engineText.workspace.suggestionStale); return; }
    editFrames([frameId], (latest) => valid(latest) ? candidate.edit : latest.edit, { by: 'auto', notes: assist.run.detail });
  }, [assists, editFrames]);

  // First run: once Auto has looked at the first photo, apply its suggestion (one undoable step), or say plainly that
  // the photo already looked natural and was left alone.
  useEffect(() => {
    if (!quickStart || quickStart.phase !== 'working' || !quickStart.photoId) return;
    const assist = assists[quickStart.photoId];
    if (!assist) return;
    const improved = assist.run.improved && assist.run.candidates.length > 0;
    if (improved) applyAuto(quickStart.photoId);
    setQuickStart({ ...quickStart, phase: improved ? 'ready' : 'unchanged' });
  }, [assists, quickStart, applyAuto]);
  useEffect(() => {
    if (!quickStart || quickStart.phase !== 'working' || !quickStart.photoId) return;
    // Auto normally answers in a few seconds; if it cannot check the photo, say so instead of waiting forever.
    const timer = window.setTimeout(() => setQuickStart((current) => current === quickStart ? { ...current, phase: 'failed' } : current), 45_000);
    return () => window.clearTimeout(timer);
  }, [quickStart]);

  // Co-pilot and Auto-pilot look at the photo on the canvas, on this device, one at a time. Solo never does.
  const assistMode = savedUi.assistMode ?? stub.store.assistMode;
  const assistProjectId = state?.shoot.id;
  const ongoingLocalReview = savedUi.settings.ongoingCritique ?? stub.store.settings.ongoingCritique;
  useEffect(() => {
    if (screen !== 'editor' || !assistProjectId || !activeFrame || activeFrame.removedAt != null) return;
    const frame = activeFrame;
    const manual = autoRequest?.photoId === frame.id && autoRequest.sequence > lastAutoRequest.current;
    if (!manual && assistMode === 'solo') return;
    const previous = assists[frame.id];
    if (!manual && previous && matchesAutoSource(previous.run, frame) &&
        (sameRecipe(previous.run.plan.base, frame.edit ?? DEFAULT_EDIT) ||
         previous.run.candidates.some((candidate) => candidate.edit === frame.edit))) return;
    if (!manual && previous && !ongoingLocalReview) return;
    const request = openRequest.current;
    const controller = new AbortController();
    const isCurrent = () => !controller.signal.aborted && request === openRequest.current;
    let taskId: number | undefined;
    const timer = window.setTimeout(() => {
      if (!isCurrent()) return;
      if (manual) lastAutoRequest.current = autoRequest.sequence;
      void engineScheduler.submit({
        title: engineText.workspace.checkTask(frame.filename),
        kind: 'auto-edit', resource: 'cpu', priority: manual ? 20 : 8, pauseable: false,
        items: [{ id: frame.id, name: frame.filename }],
        snapshot: { projectId: assistProjectId, frameId: frame.id, edit: frame.edit ?? DEFAULT_EDIT },
        itemId: item => item.id, itemLabel: item => item.name,
        runItem: async (_, __, ctx) => {
          ctx.stage(engineText.workspace.checkStage);
          const run = await runAuto(frame, provider.current!, ctx.signal);
          ctx.checkCancelled();
          if (!isCurrent()) return;
          if (!run) return;
          ctx.commitIfCurrent(() => setAssists(current => {
            if (!isCurrent()) return current;
            const recent = Object.entries(current).filter(([id]) => id !== frame.id).slice(-11);
            return { ...Object.fromEntries(recent), [frame.id]: { run, dismissed: [] } };
          }));
          if (!manual && assistMode === 'autopilot' && run.improved) {
            const at = Date.now();
            ctx.commitIfCurrent(() => mutate(current =>
              isCurrent() && !ctx.signal.aborted
                ? commitAutoEdit(current, assistProjectId, frame, run.plan.proposal, at, { by: 'auto', notes: run.detail }) : current));
          }
        },
      }).then(ticket => {
        taskId = ticket.taskId;
        controller.signal.addEventListener('abort', () => ticket.cancel(), { once: true });
        if (controller.signal.aborted) ticket.cancel();
        return ticket.finished;
      }).catch(() => {
        if (isCurrent()) setNotice(engineText.workspace.checkFailed);
      });
    }, manual ? 0 : 550);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (taskId !== undefined) tasks.cancel(taskId);
    };
    // Recheck a settled recipe, source or framing change without rerunning a completed matching analysis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, assistMode, assistProjectId, activeFrame?.id, activeFrame?.edit, activeFrame?.framing,
    activeFrame?.stableKey, activeFrame?.originalSha256, activeFrame?.removedAt, ongoingLocalReview, autoRequest, mutate]);

  // The person asked for this (Co-pilot/Assist "deep review" or refresh button); it is not the automatic
  // per-photo pass above. Wired to the real engine (src/engine/subjectDetectAction.ts, lookSuggestions.ts)
  // via deepVisionReview.ts. Result is shown as a plain-text notice for now, not yet an AssistSuggestion.
  const deepVisionInFlight = useRef(new Set<string>());
  const [reviewingIds, setReviewingIds] = useState<string[]>([]);
  const runDeepVisionReviewAction = useCallback((photoId: string) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    if (!frame || deepVisionInFlight.current.has(photoId)) return;
    deepVisionInFlight.current.add(photoId);
    setReviewingIds((current) => [...current, photoId]);
    void engineScheduler.submit({
      title: engineText.workspace.deepTask,
      kind: 'vision', resource: 'gpu', priority: 15, pauseable: false,
      items: [{ id: photoId, name: frame.filename }],
      snapshot: { frameId: frame.id, stableKey: frame.stableKey },
      itemId: item => item.id, itemLabel: item => item.name,
      runItem: async (_, __, ctx) => {
        ctx.stage(engineText.workspace.deepStage);
        // The batch's own signal: the subject finder then runs inside this task, not queued behind it.
        const result = await runDeepVisionReview(frame, provider.current!, ctx.signal);
        ctx.checkCancelled();
        if (!result) throw new Error(engineText.workspace.deepNoResult);
        // The review is advisory. Do not publish stale observations after
        // deletion, a project switch or a source relink.
        const current = stateRef.current?.frames.find(item => item.id === photoId);
        if (current?.stableKey !== frame.stableKey || current?.removedAt != null) return;
        ctx.commitIfCurrent(() => setNotice(result.summary));
      },
    }).then(ticket => ticket.finished).then(result => {
      if (result === 'failed') setNotice(engineText.workspace.deepFailed);
    }).catch(error => setNotice(error instanceof Error ? error.message : engineText.workspace.deepNotQueued))
      .finally(() => {
        deepVisionInFlight.current.delete(photoId);
        setReviewingIds(current => current.filter(id => id !== photoId));
      });
  }, []);

  const cloudImports = useRef(new Map<string, { projectId: string; photoKey: string }>());
  const importPhotos = useCallback(async (suppliedPicks?: Array<File | PickedPhoto> | null) => {
    const target = stateRef.current;
    if (!target) return;
    if (importController.current) { setNotice(engineText.workspace.importRunning); return; }
    const picks = suppliedPicks === undefined ? await pickFiles() : suppliedPicks;
    if (!picks?.length) return;
    const files = picks.map((pick) => (pick instanceof File ? pickedFromFile(pick) : pick));
    const existing = new Set(target.frames.filter((frame) => !frame.removedAt).map((frame) => frame.stableKey));
    const additions = files.filter((file) => { const key = pickedKey(file); if (existing.has(key)) return false; existing.add(key); return true; });
    if (!additions.length) { setNotice(engineText.workspace.importNothingNew); return; }
    const projectKey = target.shoot.id;
    const controller = new AbortController();
    importController.current = controller;
    setImporting(true);
    const importId = newId().slice(0, 8);
    const sequenceBase = target.frames.reduce((max, frame) => Math.max(max, frame.sequenceIndex), 0);
    const importedFrames: PhotoFrame[] = [];
    let initialImportFinished = false;
    const warnings: string[] = [];
    const sourceProvider = provider.current!;
    const sourceCatalogue = catalogue.current!;
    try {
      // An actual scheduler item for each photograph: complete the original
      // fingerprint, preview and catalogue registration before advancing.
      // Unlike a visibility-only bulk task, this releases the CPU slot at each
      // boundary so someone can continue editing while 300 files import.
      const ticket = await engineScheduler.submit({
        title: engineText.workspace.importTask(additions.length),
        kind: 'import', resource: 'cpu', priority: 4, pauseable: additions.length > 1,
        items: additions.map((file, index) => ({ file, index })),
        // Source file handles are intentionally NOT copied into the journal or
        // snapshot; a picker token cannot be persisted as a verified original.
        snapshot: { projectKey, importId },
        itemId: item => pickedKey(item.file), itemLabel: item => item.file.name,
        runItem: async (item, _, ctx) => {
          ctx.stage(engineText.workspace.importReadStage);
          const result = await loadLocalFileListShoot([item.file], sourceProvider, sourceCatalogue,
            undefined, { allowPartial: true, signal: ctx.signal });
          ctx.checkCancelled();
          if (!result.frames.length) throw new Error(engineText.workspace.importOneFailed(item.file.name));
          if (result.failedNames.length) throw new Error(engineText.workspace.importUnreadable(result.failedNames.join(', ')));
          // A one-photo loader has index one. Give each imported frame its
          // distinct stable project index before inserting it into React.
          const cloudPhoto = cloudImports.current.get(pickedKey(item.file));
          const frames = result.frames.map(frame => ({
            ...frame, id: `file-${item.index + 1}-${frame.filename}`,
            sequenceIndex: item.index + 1,
            ...(cloudPhoto ? { cloudPhoto } : {}),
          }));
          if (result.unstoredKeys.length) warnings.push(`${item.file.name} could not be stored for reopening. Relink it when needed.`);
          ctx.stage(engineText.workspace.importSaveStage);
          ctx.commitIfCurrent(() => {
            if (stateRef.current?.shoot.id !== projectKey || ctx.signal.aborted) return;
            importedFrames.push(...frames);
            setState(current => {
              if (!current || current.shoot.id !== projectKey || ctx.signal.aborted) return current;
              const updated = appendProjectPhotos(current, frames, importId, { sequenceBase });
              // Failed-only retry can happen long after the initial batch
              // finished; recompute burst relationships for that newly added
              // photograph, but not for every file in a 300-photo import.
              return initialImportFinished
                ? applyImportBursts(updated, assignBurstGroups([...importedFrames].sort((a, b) => a.sequenceIndex - b.sequenceIndex)), importId)
                : updated;
            });
          });
        },
      });
      controller.signal.addEventListener('abort', () => ticket.cancel(), { once: true });
      if (controller.signal.aborted) ticket.cancel();
      const outcome = await ticket.finished;
      initialImportFinished = true;
      if (importedFrames.length && stateRef.current?.shoot.id === projectKey) {
        const grouped = assignBurstGroups([...importedFrames].sort((a, b) => a.sequenceIndex - b.sequenceIndex));
        setState(current => current && current.shoot.id === projectKey
          ? applyImportBursts(current, grouped, importId) : current);
      }
      if (outcome === 'failed') setNotice(engineText.workspace.importSomeFailed(importedFrames.length));
      else if (outcome === 'cancelled') setNotice(engineText.workspace.importStopped(importedFrames.length));
      else if (warnings.length) setNotice(warnings.slice(0, 3).join(' '));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : engineText.workspace.importFailed);
    } finally {
      controller.abort();
      if (importController.current === controller) importController.current = null;
      setImporting(false);
    }
  }, []);

  /**
   * Reconnect originals the catalogue can no longer read (moved, renamed, or a browser session that lost its blob),
   * reusing the same verified primitives App.tsx's reconnectFileSelection already uses: getLocalFileKey to identify a
   * picked file, BrowserPreviewProvider.hasBlob/registerBlob and BrowserCatalogueStore.saveLocalFileBlob to store it.
   * Browser/web, sourceKind 'file' originals only: matches every picked file against every frame still missing its
   * original (not just the one clicked), exactly as App.tsx's whole-project reselect does. Desktop's own folder
   * relink (Tauri fs, path-based) is a separate flow and is not wired here; this says so rather than doing nothing.
   */
  const reconnectOriginal = useCallback(() => {
    if (relinking.current) return;
    if (isDesktopApp()) {
      setNotice('Desktop folder relinking is not connected to V2 yet. Your original files are unchanged.');
      return;
    }
    relinking.current = true;
    void (async () => {
      try {
        const files = await pickReselectFiles();
        if (!files?.length) return;
        const target = stateRef.current;
        const projectId = target?.shoot.id;
        if (!target || !projectId) return;
        const missing = target.frames.filter((frame) =>
          !frame.removedAt && frame.sourceKind === 'file' && !provider.current!.hasBlob(frame.stableKey)
        );
        const recoveredIds: string[] = [];
        let wrongBytes = 0;
        let legacyWithoutHash = 0;
        let temporarilyHeld = 0;
        for (const file of files) {
          if (stateRef.current?.shoot.id !== projectId) return;
          const key = getLocalFileKey(file);
          const candidates = missing.filter((frame) => frame.stableKey === key);
          if (!candidates.length || provider.current!.hasBlob(key)) continue;
          // File name, size and mtime only identify which catalogue entry to check.
          // The original's saved full-content fingerprint MUST match before registration or storage.
          const digests = [...new Set(candidates.map((frame) => frame.originalSha256))];
          if (digests.length !== 1 || typeof digests[0] !== 'string') {
            legacyWithoutHash += candidates.length;
            continue;
          }
          const actual = await hashOriginalBytes(file);
          if (stateRef.current?.shoot.id !== projectId) return;
          if (!isSameOriginalBytes(digests[0], actual)) {
            wrongBytes += candidates.length;
            continue;
          }
          let stored = false;
          try { stored = await catalogue.current!.saveLocalFileBlob(key, file); }
          catch { /* A quota failure may still allow using the verified file in this session. */ }
          if (stateRef.current?.shoot.id !== projectId) return;
          provider.current!.registerBlob(key, file);
          recoveredIds.push(...candidates.map((frame) => frame.id));
          if (!stored) temporarilyHeld += candidates.length;
        }
        if (!recoveredIds.length) {
          if (wrongBytes) setNotice('Refused the selected file: its contents do not match the original, even though the filename and size may match. Nothing was replaced.');
          else if (legacyWithoutHash) setNotice('This older project has no recorded original fingerprint, so InFlight cannot safely reconnect it. Import the file as a new photo instead; nothing was replaced.');
          else setNotice('Those files did not match a missing original in this project.');
          return;
        }
        setUrls((current) => {
          const updated = { ...current };
          for (const id of recoveredIds) delete updated[id];
          return updated;
        });
        for (const id of recoveredIds) {
          thumbs.current.requested.delete(id);
          const frame = target.frames.find((candidate) => candidate.id === id);
          if (frame) thumbs.current.queue.push(frame);
        }
        pumpThumbnails();
        if (activeId && recoveredIds.includes(activeId)) {
          const frame = target.frames.find((candidate) => candidate.id === activeId);
          if (frame) provider.current!.getFullPreviewUrl(frame, 'selected').then(
            (preview) => setUrls((current) => ({ ...current, [frame.id]: { ...current[frame.id], preview } })),
            () => { /* thumbnail reload shows failures without replacing original bytes */ },
          );
        }
        const stillMissing = missing.filter((frame) => !provider.current!.hasBlob(frame.stableKey)).length;
        setNotice([
          `Reconnected ${recoveredIds.length} photo${recoveredIds.length === 1 ? '' : 's'} using matching original bytes.`,
          temporarilyHeld ? `${temporarilyHeld} original${temporarilyHeld === 1 ? ' is' : 's are'} available this session only: device storage could not save ${temporarilyHeld === 1 ? 'it' : 'them'}.` : '',
          wrongBytes ? `${wrongBytes} mismatched file${wrongBytes === 1 ? ' was' : 's were'} refused.` : '',
          legacyWithoutHash ? `${legacyWithoutHash} legacy original${legacyWithoutHash === 1 ? ' has' : 's have'} no fingerprint and cannot be verified.` : '',
          stillMissing ? `${stillMissing} more original${stillMissing === 1 ? ' still needs' : 's still need'} reconnecting.` : '',
        ].filter(Boolean).join(' '));
      } catch {
        setNotice('InFlight could not verify those files. Nothing was replaced.');
      } finally {
        relinking.current = false;
      }
    })();
  }, [pumpThumbnails, activeId]);

  const backToProjects = useCallback(async () => {
    const current = stateRef.current;
    if (current) {
      try { await catalogue.current!.saveProject(current); }
      catch {
        // A failed final save must not discard edits that only exist in memory.
        setNotice('This project could not be saved. You are still in the editor with your changes. Check device storage and try again.');
        return;
      }
    }
    setState(null); setScreen('hub'); setSelected([]);
    await loadHub();
  }, [loadHub]);

  const collageExportRunning = useRef(false);
  const real: Partial<WorkspaceActions> = {
    exportCollage: async (request) => {
      const current = stateRef.current;
      if (!current) throw new Error('Open a collage before exporting its pages.');
      if (collageExportRunning.current) throw new Error('A collage export is already running.');
      collageExportRunning.current = true;
      // The same document, photo edit recipes and page settings are retained
      // throughout the queued job; later edits cannot silently alter the output.
      const source = structuredClone(current);
      const submitted = structuredClone(request);
      const sourceProjectId = current.shoot.id;
      const requestGeneration = openRequest.current;
      try {
        const ticket = await engineScheduler.submit({
          title: 'Exporting collage', kind: 'collage', resource: 'gpu', priority: 2,
          pauseable: false, items: [{ id: sourceProjectId, label: 'Collage pages and destination' }],
          snapshot: { projectId: sourceProjectId, request: submitted },
          itemId: item => item.id, itemLabel: item => item.label,
          runItem: async (_, __, ctx) => {
            ctx.stage('Rendering all selected pages at print or social resolution');
            const result = await exportCollage(source, provider.current!, submitted, ctx.signal, (done, total) => {
              if (openRequest.current !== requestGeneration || stateRef.current?.shoot.id !== sourceProjectId)
                throw new Error('The project changed during collage export. Nothing was downloaded.');
              ctx.reportProgress(done, total, `${done} of ${total} pages rendered`);
            });
            ctx.checkCancelled();
            if (openRequest.current !== requestGeneration || stateRef.current?.shoot.id !== sourceProjectId)
              throw new Error('The project changed during collage export. Nothing was downloaded.');
            ctx.stage('Confirming the native collage save');
            if (!await saveExportFile(result.blob, result.name, ctx.signal))
              throw new DOMException('The collage save was cancelled.', 'AbortError');
            ctx.acknowledgeCommitted();
            ctx.commitIfCurrent(() => setNotice('Collage export prepared. Your originals are unchanged.'));
          },
        });
        const outcome = await ticket.finished;
        if (outcome === 'failed') throw new Error('Collage export failed. Open Tasks to view the error.');
        if (outcome === 'cancelled') throw new Error('Collage export cancelled. Previously delivered files remain unchanged.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Collage export failed.';
        setNotice(message);
        throw new Error(message);
      } finally { collageExportRunning.current = false; }
    },
    addEditGroup: (photoId) => {
      const id = `group-${newId().replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 24)}`;
      const frame = stateRef.current?.frames.find((item) => item.id === photoId);
      if (!frame || !addSavedEditGroup(frame, id)) { setNotice('Could not add another edit group.'); return; }
      mutate((current) => ({ ...current, shoot: { ...current.shoot, lastUpdatedAt: Date.now() },
        frames: current.frames.map((item) => item.id === photoId ? addSavedEditGroup(item, id) ?? item : item) }));
    },
    setActiveGroup: (photoId, groupId) => {
      const frame = stateRef.current?.frames.find((item) => item.id === photoId);
      if (!frame || !selectSavedEditGroup(frame, groupId)) { setNotice('That edit group is unavailable.'); return; }
      mutate((current) => ({ ...current, shoot: { ...current.shoot, lastUpdatedAt: Date.now() },
        frames: current.frames.map((item) => item.id === photoId ? selectSavedEditGroup(item, groupId) ?? item : item) }));
    },
    renameEditGroup: (photoId, groupId, name) => {
      const frame = stateRef.current?.frames.find((item) => item.id === photoId);
      if (!frame || !renameSavedEditGroup(frame, groupId, name)) { setNotice('Choose a group name between 1 and 80 characters.'); return; }
      mutate((current) => ({ ...current, shoot: { ...current.shoot, lastUpdatedAt: Date.now() },
        frames: current.frames.map((item) => item.id === photoId ? renameSavedEditGroup(item, groupId, name) ?? item : item) }));
    },
    reconnectOriginal: () => reconnectOriginal(),
    developFullSize: (photoId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId && candidate.removedAt == null);
      if (!frame || !fullDevelopPossible(frame, canDevelopRaw(), true)) {
        setNotice('Only a RAW photo can be developed at full size, on a device with InFlight’s RAW decoder.');
        return;
      }
      const key = frame.stableKey;
      const sourceProvider = provider.current!;
      if (fullDevelopRunning.current.has(key)) return;
      fullDevelopRunning.current.add(key);
      setFullDeveloping((current) => ({ ...current, [key]: true }));
      const target = structuredClone(frame);
      void (async () => {
        try {
          const ticket = await engineScheduler.submit({
            title: 'Developing full size from RAW', kind: 'raw', resource: 'cpu', priority: 9,
            pauseable: false, items: [{ id: target.id, name: target.filename }],
            snapshot: { frameId: target.id, stableKey: key },
            itemId: (item) => item.id, itemLabel: (item) => item.name,
            runItem: async (_, __, ctx) => {
              ctx.stage('Developing the sensor data at full size');
              await developFullSizeOf(target, sourceProvider);
              ctx.checkCancelled();
            },
          });
          const result = await ticket.finished;
          if (result === 'failed') setNotice(`${target.filename} could not be developed at full size. Open Tasks for the reason. Your original is unchanged.`);
        } catch (reason) {
          setNotice(reason instanceof Error ? reason.message : 'Could not start the full-size develop.');
        } finally {
          fullDevelopRunning.current.delete(key);
          setFullDeveloping((current) => { const { [key]: _done, ...rest } = current; return rest; });
        }
      })();
    },
    saveDngCopy: (photoId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId && candidate.removedAt == null);
      if (!frame || !dngCopyOffered(frame, canExportRawMaster())) {
        setNotice('A DNG copy is made only for Nikon High Efficiency NEFs, in the desktop app. Your original is unchanged.');
        return;
      }
      const sourceProvider = provider.current!;
      const target = structuredClone(frame);
      void (async () => {
        try {
          const ticket = await engineScheduler.submit({
            title: 'Saving a lossless DNG copy', kind: 'raw', resource: 'cpu', priority: 10,
            pauseable: false, items: [{ id: target.id, name: target.filename }],
            snapshot: { frameId: target.id, originalSha256: target.originalSha256 },
            itemId: (item) => item.id, itemLabel: (item) => item.name,
            runItem: async (_, __, ctx) => {
              ctx.stage('Reading the sensor data into a DNG');
              const file = await buildDngCopyFile(target, sourceProvider, ctx.signal);
              ctx.checkCancelled();
              ctx.stage('Saving the DNG copy');
              if (!await saveExportFile(file, file.name, ctx.signal)) throw new DOMException('Save cancelled.', 'AbortError');
              ctx.acknowledgeCommitted();
              ctx.commitIfCurrent(() => setNotice(`Saved ${file.name}. Your original NEF is unchanged.`));
            },
          });
          const result = await ticket.finished;
          if (result === 'failed') setNotice('The DNG copy failed. Open Tasks for the reason. Your original is unchanged.');
          else if (result === 'cancelled') setNotice('DNG copy cancelled.');
        } catch (reason) {
          setNotice(reason instanceof Error ? reason.message : 'Could not start the DNG copy.');
        }
      })();
    },
    openProject: (id) => { void openProject(id); },
    createProject: (name, kind = 'photography') => {
      const empty = createEmptyProject(`project-${newId()}`, name.trim() || 'Untitled project');
      const created = kind === 'collage' ? { ...empty, shoot: { ...empty.shoot, collage: createCollage() } } : empty;
      void catalogue.current!.saveProject(created).then(() => enterProject(created), () => setNotice('InFlight could not create the project.'));
    },
    createCollageFromSelection: (photoIds) => {
      const source = stateRef.current;
      if (!source) return;
      const chosen = new Set(photoIds);
      const selectedFrames = source.frames.filter((frame) => chosen.has(frame.id) && frame.removedAt == null);
      if (!selectedFrames.length) { setNotice('Select at least one photograph to make a collage.'); return; }
      if (selectedFrames.length > MAX_COLLAGE_SELECTION) { setNotice(`Choose up to ${MAX_COLLAGE_SELECTION} photographs per collage.`); return; }
      // A new project references the same verified original keys but has independent saved recipes.
      // Keep source frames and edits untouched; do not move or delete source photographs.
      const projectId = `project-${newId()}`;
      const idMap = new Map(selectedFrames.map((frame) => [frame.id, `${projectId}-${frame.id}`]));
      const frames = selectedFrames.map((frame, index) => ({
        ...frame, id: idMap.get(frame.id)!, sequenceIndex: index + 1,
        virtualCopy: frame.virtualCopy && idMap.has(frame.virtualCopy.originalFrameId)
          ? { ...frame.virtualCopy, originalFrameId: idMap.get(frame.virtualCopy.originalFrameId)! } : undefined,
      }));
      const blank = createEmptyProject(projectId, `Collage from ${source.shoot.title}`);
      const created = {
        ...blank, frames, selectedFrameId: frames[0].id,
        shoot: { ...blank.shoot, totalFrames: frames.length,
          collage: createCollage(frames.map((frame) => frame.id)) },
      };
      void catalogue.current!.saveProject(created)
        .then(() => openProject(created.shoot.id))
        .catch(() => setNotice('InFlight could not save this collage. The source project is unchanged.'));
    },
    browseCollageProjectPhotos: async (sourceProjectId) => {
      const source = await catalogue.current!.loadProject(sourceProjectId);
      if (!source) throw new Error('Could not open the source project.');
      return source.frames.filter((frame) => frame.removedAt == null)
        .map((frame) => ({ id: frame.id, filename: frame.filename }));
    },
    addCollageProjectPhotos: async (sourceProjectId, photoIds) => {
      const target = stateRef.current;
      if (!target?.shoot.collage || sourceProjectId === target.shoot.id) return;
      const source = await catalogue.current!.loadProject(sourceProjectId);
      if (!source) throw new Error('Could not open the source project.');
      const chosen = new Set(photoIds);
      const already = new Set(target.frames.filter((frame) => frame.removedAt == null).map((frame) => frame.stableKey));
      const incoming = source.frames.filter((frame) => frame.removedAt == null && chosen.has(frame.id) && !already.has(frame.stableKey));
      if (!incoming.length) throw new Error('Those photographs are already in the collage, or could not be found.');
      const currentId = target.shoot.id;
      const idMap = new Map(incoming.map((frame) => [frame.id, `${currentId}-${newId()}`]));
      const frames = incoming.map((frame, i) => ({
        ...frame, id: idMap.get(frame.id)!, sequenceIndex: target.frames.length + i + 1,
        virtualCopy: frame.virtualCopy && idMap.has(frame.virtualCopy.originalFrameId)
          ? { ...frame.virtualCopy, originalFrameId: idMap.get(frame.virtualCopy.originalFrameId)! } : undefined,
      }));
      if (stateRef.current?.shoot.id !== currentId) return;
      await rehydrateLocalFramesFromStore(frames, provider.current!, catalogue.current!, { checkPaths: false });
      // Merge with the latest project. An edit, import or page change can complete during either read.
      mutate((current) => {
        if (current.shoot.id !== currentId) return current;
        const present = new Set(current.frames.filter(frame => frame.removedAt == null).map(frame => frame.stableKey));
        const added = frames.filter(frame => !present.has(frame.stableKey)).map((frame, i) =>
          ({ ...frame, sequenceIndex: current.frames.length + i + 1 }));
        if (!added.length) return current;
        const combined = [...current.frames, ...added];
        return { ...current, frames: combined, shoot: { ...current.shoot, totalFrames: combined.length, lastUpdatedAt: Date.now() } };
      });
    },
    updateCollage: (document) => {
      if (!readCollage(document)) { setNotice('That collage layout could not be saved.'); return; }
      mutate((current) => current.shoot.collage ? {
        ...current, shoot: { ...current.shoot, collage: document, lastUpdatedAt: Date.now() },
      } : current);
    },
    eraseDeviceData: () => {
      void (async () => {
        const result = await eraseDeviceData({
          clearCatalogue: () => catalogue.current!.clearAll(),
          storages: [window.localStorage, window.sessionStorage],
        });
        if (result.problems.length) { setNotice(`Some data could not be erased: ${result.problems.join(' ')}`); return; }
        window.location.reload();
      })().catch(() => setNotice('InFlight could not erase this device. Nothing else was changed.'));
    },
    createProjectFromFolder: () => {
      void pickFolderFiles().then(async (files) => {
        if (!files?.length) return;
        const folder = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/')[0];
        const created = createEmptyProject(`project-${newId()}`, folder?.trim() || 'Untitled project');
        try { await catalogue.current!.saveProject(created); } catch { setNotice('InFlight could not create the project.'); return; }
        enterProject(created);
        // The editor state lands on the next render; wait for it before adding the photos.
        for (let wait = 0; wait < 40 && stateRef.current?.shoot.id !== created.shoot.id; wait += 1) await new Promise((resolve) => setTimeout(resolve, 50));
        void importPhotos(files);
      });
    },
    renameProject: (id, name) => {
      const clean = name.trim();
      if (!clean) return;
      void (async () => {
        const store = catalogue.current!;
        const found = await store.loadProject(id);
        if (!found) { setNotice('That project could not be found.'); return; }
        await store.saveProject({ ...found, shoot: { ...found.shoot, title: clean } });
        await loadHub();
      })().catch(() => setNotice('InFlight could not rename the project.'));
    },
    archiveProject: (id, archived) => {
      void (async () => {
        const store = catalogue.current!;
        const found = await store.loadProject(id);
        if (!found) { setNotice('That project could not be found.'); return; }
        await store.saveProject(setArchived(found, archived ? Date.now() : undefined));
        await loadHub();
      })().catch(() => setNotice('InFlight could not update the project.'));
    },
    deleteProject: (id) => {
      void catalogue.current!.deleteProject(id).then(() => loadHub(), () => setNotice('InFlight could not delete the project. Your original photos are unchanged.'));
    },
    backToProjects: () => { void backToProjects(); },
    setHubState: (next) => setHubState(next),
    selectPhoto: (id, modifiers) => {
      const list = (stateRef.current?.frames ?? []).filter((frame) => !frame.removedAt && !pairsRef.current.rawOf.has(frame.id)).map((frame) => frame.id);
      if (modifiers?.shift && activeId) {
        const a = list.indexOf(activeId), b = list.indexOf(id);
        if (a >= 0 && b >= 0) setSelected(list.slice(Math.min(a, b), Math.max(a, b) + 1));
      } else if (modifiers?.ctrl) {
        setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
      } else setSelected([id]);
      mutate((current) => ({ ...current, selectedFrameId: id }));
    },
    selectAllPhotos: () => setSelected((stateRef.current?.frames ?? []).filter((frame) => !frame.removedAt && !pairsRef.current.rawOf.has(frame.id)).map((frame) => frame.id)),
    clearSelection: () => setSelected(activeId ? [activeId] : []),
    setDecision: (ids, decision) => decide(ids, decision),
    removePhotos: (ids) => removePhotos(ids),
    setRemovedOpen: (open) => setRemovedOpen(open),
    restorePhotos: (ids) => {
      mutate((current) => restoreRemoved(current, withPartners(ids, rawJpegPairs(current.frames.map((frame) => ({ ...frame, removedAt: undefined }))))));
    },
    toggleFlag: (ids) => mutate((current) => ids.reduce((next, id) => {
      const frame = next.frames.find((candidate) => candidate.id === id);
      if (!frame) return next;
      // The shown photo's flag decides; its paired JPEG follows it.
      const target = frame.decision === 'keep' ? 'unreviewed' : 'keep';
      return withPartners([id], pairsRef.current).reduce((acc, member) => applyDecisionWithHistory(acc, member, target, { allowAdvance: false }), next);
    }, current)),
    correctVehicle: (photoId, choice, wholeBurst) => {
      const before = stateRef.current?.frames ?? [];
      const after = correctVehicle(before, photoId, choice, wholeBurst, VEHICLE_LABELS);
      if (after === before) return;
      const changed = after.filter((frame, index) => frame !== before[index]).length;
      mutate((current) => ({ ...current, shoot: { ...current.shoot, lastUpdatedAt: Date.now() }, frames: correctVehicle(current.frames, photoId, choice, wholeBurst, VEHICLE_LABELS) }));
      setNotice(vehicleText.correct.saved(changed));
    },
    correctSpeciesName: (photoId, proposedName) => {
      const name = proposedName.trim().slice(0, 120);
      if (!name) return;
      mutate((current) => ({
        ...current,
        shoot: { ...current.shoot, lastUpdatedAt: Date.now() },
        frames: current.frames.map((frame) => {
          if (frame.id !== photoId || frame.removedAt) return frame;
          // A correction is the photographer's own label, not an unverified model suggestion.
          // Keep separate tags/evidence, but remove the former automatic name from primary display.
          const autoNames = new Set(frame.autoTags ?? []);
          const manualTags = (frame.tags ?? []).filter((tag) => !autoNames.has(tag));
          return {
            ...frame,
            subjectNames: [name],
            tags: [name, ...manualTags.filter((tag) => tag !== name)],
            autoTags: [],
            speciesChecked: true,
            subjectDisputed: false,
          };
        }),
      }));
      setNotice('Species name saved to this project.');
    },
    setRating: (given, rating) => mutate((current) => {
      const ids = withPartners(given, pairsRef.current);
      return {
      ...current,
      frames: current.frames.map((frame) => (ids.includes(frame.id) ? { ...frame, rating } : frame)),
      shoot: { ...current.shoot, lastUpdatedAt: Date.now() },
    };
    }),
    importPhotos: () => { void importPhotos(); },
    importFolder: () => { void pickFolderFiles().then((files) => { if (files?.length) void importPhotos(files); }); },
    importDroppedPhotos: (files) => { if (files.length) void importPhotos(files); },
    backUpProjectNow: () => {
      const current = stateRef.current;
      if (!current) return;
      void backUpProjectNow(current).then((result) => setNotice(backupStatusText(result)));
    },
    saveProjectBackupFile: () => {
      const current = stateRef.current;
      if (!current) return;
      void saveProjectBackupFile(current).then(
        (result) => { if (result !== 'cancelled') setNotice(result === 'saved' ? V2_STRINGS.backup.fileSaved : V2_STRINGS.backup.fileDownloaded); },
        () => setNotice(V2_STRINGS.backup.fileFailed),
      );
    },
    restoreProjectBackup: (file) => {
      void file.text().then((contents) => {
        // Always a new project id, so restoring can never overwrite the project the backup came from.
        const restored = restoreProjectBackup(contents, `project-${newId()}`);
        return catalogue.current!.saveProject(restored)
          .then(() => openProject(restored.shoot.id))
          .then(() => setNotice(V2_STRINGS.backup.restored(restored.shoot.title)));
      }).catch(() => setNotice(V2_STRINGS.backup.restoreFailed));
    },
    saveXmpSidecars: (photoIds) => {
      const frames = xmpScope(stateRef.current?.frames ?? [], photoIds);
      void saveSidecars(frames).then((message) => { if (message) setNotice(message); });
    },
    readXmpSidecars: (files, photoIds) => {
      const before = stateRef.current;
      if (!before) return;
      // Every file is parsed and matched before any photo changes; a project change meanwhile cancels it.
      void planXmpImports(files, xmpScope(before.frames, photoIds), xmpScope(before.frames, [])).then((planned) => {
        const now = stateRef.current;
        if (!now || now.shoot.id !== before.shoot.id || now.shoot.lastUpdatedAt !== before.shoot.lastUpdatedAt) {
          setNotice(sidecarFailureText(null));
          return;
        }
        mutate((current) => applySidecarImports(current, planned));
        setNotice(V2_STRINGS.xmp.read(planned.length));
      }, (error) => setNotice(sidecarFailureText(error)));
    },
    readLightroomCatalogue: (file) => {
      const before = stateRef.current;
      if (!before) return;
      const words = V2_STRINGS.lightroom;
      setNotice(words.reading);
      // The catalogue is read whole and matched before any photo changes; a project change meanwhile cancels it.
      void readLightroomCatalogue(file).then((photos) => {
        const now = stateRef.current;
        if (!now || now.shoot.id !== before.shoot.id || now.shoot.lastUpdatedAt !== before.shoot.lastUpdatedAt) {
          setNotice(words.failed.changed);
          return;
        }
        const plan = planLightroomImport(photos, now.frames);
        const toAdd = catalogueOnlyPhotos(photos, now.frames);
        // Photos the project does not have yet are offered next: the person chooses the folder they are in.
        lightroomPending.current = toAdd.length ? { projectId: now.shoot.id, photos, toAdd } : null;
        setLightroomOffer(toAdd.length ? { missing: toAdd.length, folder: commonFolder(toAdd) } : null);
        if (!plan.matches.length) {
          if (!toAdd.length) setNotice(words.failed.none);
          else setNotice(null);
          return;
        }
        const catalogued = photos.length - plan.virtualCopies;
        const { state: applied, result } = applyLightroomImport(now, plan, Date.now());
        // Applied only to the exact state that was matched; anything newer keeps the person's change instead.
        mutate((current) => (current === now ? applied : current));
        setNotice(lightroomNotice(words, { ...plan, unmatched: plan.unmatched - toAdd.length }, catalogued, result));
      }, (error) => setNotice(words.failed[error instanceof CatalogueReadError ? error.reason : 'unreadable']));
    },
    exportOpenFormats: () => {
      const current = stateRef.current;
      if (!current) return;
      const words = V2_STRINGS.openExport;
      void saveCatalogueExport(current).then((outcome) => {
        if (outcome !== 'cancelled') setNotice(outcome === 'saved' ? words.saved : outcome === 'nothing' ? words.nothing : words.failed);
      });
    },
    startQuickStart: () => {
      const words = V2_STRINGS.quickStart;
      // The picker opens straight from the person's click; everything after it runs on this device.
      void pickFiles().then(async (picks) => {
        if (!picks?.length) return;
        const created = createEmptyProject(`project-${newId()}`, words.projectName);
        try { await catalogue.current!.saveProject(created); }
        catch { setNotice(V2_STRINGS.quickStart.failed); return; }
        enterProject(created);
        setQuickStart({ projectId: created.shoot.id, photoId: null, phase: 'working' });
        for (let wait = 0; stateRef.current?.shoot.id !== created.shoot.id && wait < 100; wait++) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        if (stateRef.current?.shoot.id !== created.shoot.id) return;
        await importPhotos(picks);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const now = stateRef.current;
        const first = now?.shoot.id === created.shoot.id ? now.frames.find((frame) => frame.removedAt == null) : undefined;
        if (!first) { setQuickStart(null); return; }
        setQuickStart({ projectId: created.shoot.id, photoId: first.id, phase: 'working' });
        setAutoRequest((last) => ({ photoId: first.id, sequence: (last?.sequence ?? 0) + 1 }));
      });
    },
    dismissQuickStart: () => setQuickStart(null),
    dismissLightroomOffer: () => { lightroomPending.current = null; setLightroomOffer(null); },
    chooseLightroomFolder: () => {
      const pending = lightroomPending.current;
      const words = V2_STRINGS.lightroom;
      if (!pending) return;
      // Picked from the person's click, so the browser allows the folder picker.
      void pickFolderFiles().then(async (files) => {
        if (!files?.length) return;
        const { found, missing } = catalogueFilesInFolder(pending.toAdd, files);
        if (!found.length) { setNotice(words.noneInFolder); return; }
        lightroomPending.current = null;
        setLightroomOffer(null);
        const before = new Set((stateRef.current?.frames ?? []).map((frame) => frame.id));
        await importPhotos(found);
        await new Promise((resolve) => setTimeout(resolve, 0)); // let the last added photos reach stateRef
        const now = stateRef.current;
        if (!now || now.shoot.id !== pending.projectId) return;
        const added = now.frames.filter((frame) => !before.has(frame.id)).length;
        const plan = planLightroomImport(pending.photos, now.frames);
        const { state: applied, result } = applyLightroomImport(now, plan, Date.now());
        mutate((current) => (current === now ? applied : current));
        const catalogued = pending.photos.length - plan.virtualCopies;
        const parts = [lightroomNotice(words, { ...plan, unmatched: 0 }, catalogued, result)];
        if (missing) parts.push(words.notInFolder(missing));
        if (added < found.length) parts.push(words.notAdded(found.length - added));
        setNotice(parts.join(' '));
      });
    },
    runAutoCull: () => { void runAutoCull(); },
    addMaskLayer: (photoId, type) => { void addMask(photoId, type); },
    toggleMaskLayer: (photoId, maskId) => editMasks(photoId, (masks) => toggleMask(masks, maskId)),
    removeMaskLayer: (photoId, maskId) => editMasks(photoId, (masks) => removeMask(masks, maskId)),
    setMaskEdit: (photoId, maskId, key, value) => editMasks(photoId, (masks) => setMaskEdit(masks, maskId, key, value)),
    setMaskFeather: (photoId, maskId, percent) => editMasks(photoId, (masks) => setMaskFeather(masks, maskId, percent)),
    setMaskGeometry: (photoId, maskId, field, value) => editMasks(photoId, (masks) => setMaskGeometry(masks, maskId, field, value)),
    setMaskLimit: (photoId, maskId, limit) => editMasks(photoId, masks => setMaskLimit(masks, maskId, limit ?? null)),
    // As in the owner's design: starting an export closes the dialog; progress and the result continue in Tasks.
    runExport: (request) => { stub.actions.setExportOpen(false); void runExportAction(request); },
    applyAssistSuggestion: applyAuto,
    requestLocalAuto: (photoId) => setAutoRequest((last) => ({ photoId, sequence: (last?.sequence ?? 0) + 1 })),
    applyAllAssistSuggestions: (photoId) => applyAuto(photoId),
    sharedEditOf: (photoId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId && candidate.removedAt == null);
      return frame?.edit ? JSON.parse(JSON.stringify(frame.edit)) as Record<string, unknown> : null;
    },
    applySharedEdit: (photoId, edit) => {
      const safe = readSharedEdit(edit);
      if (safe === false) { setNotice('The shared edit for this photo could not be read, so nothing was changed.'); return; }
      editFrames([photoId], () => safe ?? undefined);
    },
    keepBothShared: (photoId, theirs) => {
      const safe = readSharedEdit(theirs);
      const current = stateRef.current;
      const source = current?.frames.find((frame) => frame.id === photoId && frame.removedAt == null);
      if (safe === false || !current || !source) { setNotice('The shared edit for this photo could not be read, so nothing was changed.'); return null; }
      // Mine becomes a virtual copy beside the photo; the photo itself takes the shared edit. Both stay, nothing is lost.
      const copy = createVirtualCopy(source, current.frames, `vc-${newId()}`);
      mutate((state) => {
        const index = state.frames.findIndex((frame) => frame.id === photoId);
        const frames = [...state.frames];
        frames.splice(index + 1, 0, copy);
        return { ...state, frames };
      });
      editFrames([photoId], () => safe ?? undefined);
      return copy.id;
    },
    importCloudPreviews: async (items) => {
      for (const item of items) cloudImports.current.set(pickedKey(pickedFromFile(item.file)), { projectId: item.projectId, photoKey: item.photoKey });
      try { await importPhotos(items.map((item) => item.file)); }
      finally { for (const item of items) cloudImports.current.delete(pickedKey(pickedFromFile(item.file))); }
    },
    attachCloudOriginal: async (photoId, original, sha256) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId && candidate.removedAt == null);
      if (!frame?.cloudPhoto || !provider.current || !catalogue.current || !/^[0-9a-f]{64}$/.test(sha256)) return false;
      const key = getLocalFileKey(original);
      try { await catalogue.current.saveLocalFileBlob(key, original); } catch { /* still usable this session */ }
      provider.current.registerBlob(key, original);
      const next: PhotoFrame = { ...frame, stableKey: key, filename: original.name, originalSha256: sha256, cloudPhoto: { ...frame.cloudPhoto, hasOriginal: true } };
      mutate((current) => ({ ...current, frames: current.frames.map((item) => (item.id === photoId ? { ...item, stableKey: next.stableKey, filename: next.filename, originalSha256: sha256, cloudPhoto: next.cloudPhoto } : item)) }));
      setUrls((current) => { const updated = { ...current }; delete updated[photoId]; return updated; });
      thumbs.current.requested.delete(photoId);
      thumbs.current.queue.push(next); pumpThumbnails();
      provider.current.getFullPreviewUrl(next, 'selected').then(
        (preview) => setUrls((current) => ({ ...current, [photoId]: { ...current[photoId], preview } })),
        () => { /* the thumbnail reload reports failures; the preview stays */ },
      );
      return true;
    },
    readVerifiedOriginal: async (photoId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId && candidate.removedAt == null);
      if (!frame || frame.isDemo || frame.cloudPhoto || !provider.current) return null;
      const bytes = await provider.current.ensureOriginal(frame.stableKey, 'selected');
      if (!bytes) return null;
      try { return await verifyExactOriginalCopy(bytes, frame.originalSha256); } catch { return null; }
    },
    renderGalleryPreview: async (photoId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId && candidate.removedAt == null);
      return frame && provider.current ? renderGalleryPreview(frame, provider.current) : null;
    },
    dismissAssistSuggestion: (photoId, suggestionId) => setAssists((current) => (current[photoId]
      ? { ...current, [photoId]: { ...current[photoId], dismissed: [...current[photoId].dismissed, suggestionId] } } : current)),
    runDeepVisionReview: (photoId) => runDeepVisionReviewAction(photoId),
    saveOverlayTemplate: (photoId, name) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
      if (!frame) return;
      const next = addTemplate(templates, name, readOverlay(frame.overlay), `tpl-${newId().replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12)}`, Date.now());
      if (!next) { setNotice(name.trim() ? 'You have saved the most templates you can. Delete one first.' : 'Give the template a name first.'); return; }
      updateTemplates(next);
      setNotice(`Saved the template "${next[next.length - 1].name}" on this device.`);
    },
    applyOverlayTemplate: (templateId, photoIds) => {
      const template = templates.find((entry) => entry.id === templateId);
      if (!template || !photoIds.length) return;
      const at = Date.now();
      const preview = stateRef.current ? applyOverlayTemplateToProject(stateRef.current, template, photoIds, at) : null;
      if (!preview || !preview.changed) { setNotice('That overlay template is already applied to the selected photographs.'); return; }
      mutate((current) => applyOverlayTemplateToProject(current, template, photoIds, at).state);
      setNotice(`Applied "${template.name}" to ${preview.changed} photograph${preview.changed === 1 ? '' : 's'}. Each has an Undo checkpoint in its own History.`);
    },
    renameOverlayTemplate: (templateId, name) => updateTemplates(renameTemplate(templates, templateId, name)),
    deleteOverlayTemplate: (templateId) => updateTemplates(deleteTemplate(templates, templateId)),
    toggleSizeEnabled: (photoId, sizeId) => changeFormats(photoId, (raw) => toggleFormat(raw, sizeId, createDefaultSizes().find((size) => size.id === sizeId)?.enabled ?? true)),
    toggleSizeLinked,
    updateVideoZoom,
    toggleSplitFrames,
    setSplitFrameCount,
    setSplitPanOffset,
    setOriginalOutputSize: (photoId, width, height) => {
      if (!validCustomSize(width, height)) { setNotice('Use whole pixels between 1 and 20,000 for the Original output canvas.'); return; }
      changeFormats(photoId, (raw) => setOriginalOutputSize(raw, width, height));
    },
    resetOriginalOutputSize: (photoId) => {
      changeFormats(photoId, resetOriginalOutputSize);
    },
    addCustomSize: (photoId, label, width, height) => {
      if (!validCustomSize(width, height)) { setNotice('That size is not usable. Use whole pixels, from 1 to 20,000.'); return; }
      const id = `custom-${newId().replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 10)}`;
      if (!changeFormats(photoId, (raw) => addFormat(raw, label, width, height, id))) { setNotice('This photo already has the most formats it can hold.'); return; }
      stub.actions.setActiveSize(id);
    },
    duplicateSize: (photoId, sizeId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
      const source = liveFormatsOf(frame).find((size) => size.id === sizeId);
      if (!frame || !source) return;
      const id = `custom-${newId().replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 10)}`;
      if (!changeFormats(photoId, (raw) => addFormat(raw, `${source.label} copy`, source.width, source.height, id), (crops) => { const own = readCrops(crops)[sizeId]; return own ? { ...readCrops(crops), [id]: own } : readCrops(crops); })) { setNotice('This photo already has the most formats it can hold.'); return; }
      stub.actions.setActiveSize(id);
    },
    removeSize: (photoId, sizeId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
      const remaining = liveFormatsOf(frame).filter((size) => size.kind === 'photo' && size.enabled && size.id !== sizeId);
      if (!remaining.length) { setNotice('A photo needs at least one format.'); return; }
      changeFormats(photoId, (raw) => removeFormat(raw, sizeId), (crops) => { const next = { ...readCrops(crops) }; if (sizeId.startsWith('custom-')) delete next[sizeId]; return next; });
      if (stub.store.activeSizeId === sizeId) stub.actions.setActiveSize(remaining[0].id);
    },
    updateSizeCrop: (photoId, sizeId, patch) => {
      const selectedSizes = stub.store.selectedSizeIds;
      changeCrops(photoId, selectedSizes.length > 1 && selectedSizes.includes(sizeId) ? selectedSizes : [sizeId], (crop) => patchCrop(crop, patch));
    },
    moveSizeArtboard: (photoId, sizeId, boardX, boardY) => mutate((current) => ({ ...current, frames: current.frames.map((frame) => (frame.id === photoId ? { ...frame, boardPositions: moveArtboard(frame.boardPositions, sizeId, boardX, boardY) } : frame)) })),
    resetArtboardPositions: (photoId) => mutate((current) => ({ ...current, frames: current.frames.map((frame) => (frame.id === photoId ? { ...frame, boardPositions: undefined } : frame)) })),
    resetSizeCrop: (photoId, sizeId) => changeCrops(photoId, [sizeId], () => ({ ...DEFAULT_CROP })),
    flipSelectedSizes: (photoId, axis) => changeCrops(photoId, stub.store.selectedSizeIds, (crop) => flipCrop(crop, axis)),
    rotateSelectedSizes: (photoId) => changeCrops(photoId, stub.store.selectedSizeIds, (crop) => rotateCrop(crop)),
    updateOverlay: (photoId, patch) => changeOverlay(photoId, (overlay) => patchOverlay(overlay, patch)),
    alignOverlaysCleanly: (photoId, layout) => changeOverlay(photoId, (overlay) => alignOverlays(overlay, layout)),
    moveOverlayRow: (photoId, rowId, direction) => changeOverlay(photoId, (overlay) => moveRow(overlay, rowId, direction)),
    addOverlayRow: (photoId) => changeOverlay(photoId, (overlay) => addRow(overlay, `row-${newId().slice(0, 8)}`)),
    updateOverlayRow: (photoId, rowId, patch) => changeOverlay(photoId, (overlay) => updateRow(overlay, rowId, patch)),
    removeOverlayRow: (photoId, rowId) => changeOverlay(photoId, (overlay) => removeRow(overlay, rowId)),
    detectColourEdges: async (photoId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
      if (!frame || !provider.current) return 'unclear';
      // Measured on the unedited framed picture at a bounded size, then stored, so preview and export use the same numbers.
      const image = await loadExportSource(frame, provider.current);
      const framing = frame.framing ?? DEFAULT_FRAMING;
      const { width, height } = framedSize(image.naturalWidth, image.naturalHeight, framing);
      const canvas = document.createElement('canvas');
      drawFramedPhoto(image, canvas, framing, { scale: Math.min(1, 2400 / Math.max(width, height)) });
      const pixels = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height).data;
      const [cx, cy] = canvasLensCentre(canvas.width, canvas.height, { aspect: canvas.height / canvas.width, view: { x: 0, y: 0, w: 1, h: 1 }, lensCentre: lensCentre(image.naturalWidth, image.naturalHeight, framing) });
      const found = detectLateralCa(pixels, canvas.width, canvas.height, 4, cx, cy);
      canvas.width = 0; canvas.height = 0;
      if (!found) return 'unclear';
      applyPatch([photoId], { caRed: Math.round(found.red * 100), caBlue: Math.round(found.blue * 100) });
      return found.red === 0 && found.blue === 0 ? 'clean' : 'corrected';
    },
    addImageLayer: async (photoId) => {
      const picked = await pickImageFile();
      if (!picked) return;
      try {
        const assetId = await saveLayerAsset(picked);
        const image = await createImageBitmap(picked);
        const aspect = image.height / image.width;
        image.close();
        addLayerTo(photoId, assetId, picked.name.replace(/\.[^.]+$/, ''), aspect);
      } catch (error) { setNotice(error instanceof Error ? error.message : 'That image could not be added as a layer.'); }
    },
    addPhotoLayer: async (photoId, sourcePhotoId) => {
      const source = stateRef.current?.frames.find((candidate) => candidate.id === sourcePhotoId);
      if (!source || !provider.current) return;
      try {
        // A copy of the other photo as it looks now (framing, edit and its own layers), kept on this device. Its original is only read.
        const image = await loadExportSource(source, provider.current);
        const framing = source.framing ?? DEFAULT_FRAMING;
        const { width, height } = framedSize(image.naturalWidth, image.naturalHeight, framing);
        const scale = Math.min(1, LAYER_COPY_EDGE / Math.max(width, height));
        const canvas = document.createElement('canvas');
        drawFramedPhoto(image, canvas, framing, { scale });
        await applyCanvasExportEdit(canvas, source.edit ?? DEFAULT_EDIT, undefined, Math.max(width, height) * scale, { aspect: height / width, view: { x: 0, y: 0, w: 1, h: 1 }, lensCentre: lensCentre(image.naturalWidth, image.naturalHeight, framing) });
        await applyFrameLayers(canvas, source.overlay, true);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
        if (!blob) throw new Error('InFlight could not copy that photo.');
        const assetId = await saveLayerAsset(blob);
        addLayerTo(photoId, assetId, source.filename, canvas.height / canvas.width, 1);
        canvas.width = 0; canvas.height = 0;
      } catch (error) { setNotice(error instanceof Error ? error.message : 'That photo could not be added as a layer.'); }
    },
    updateLayer: (photoId, layerId, patch) => changeOverlay(photoId, (overlay) => updateLayer(overlay, layerId, patch)),
    removeLayer: (photoId, layerId) => changeOverlay(photoId, (overlay) => removeLayer(overlay, layerId)),
    moveLayer: (photoId, layerId, direction) => changeOverlay(photoId, (overlay) => moveLayer(overlay, layerId, direction)),
    addCustomFont: (fontName) => {
      const name = fontName.trim();
      if (!name) return;
      if (!hasDeviceFont(name)) { setNotice(`"${name}" is not installed on this device, so it was not added.`); return; }
      setDeviceFonts((current) => { const next = [...new Set([...current, name])]; saveDeviceFonts(next); return next; });
    },
    updateSettings: (patch) => setSavedUi((current) => { const next: SavedUi = { ...current, settings: { ...current.settings, ...patch } }; saveUi(next); return next; }),
    setAssistMode: (mode) => setSavedUi((current) => { const next: SavedUi = { ...current, assistMode: mode, settings: { ...current.settings, defaultAssistMode: mode } }; saveUi(next); return next; }),
    importWatermarkImage: async (usage) => {
      const picked = await pickImageFile();
      if (!picked) return null;
      try {
        const entry = await importWatermark(picked, picked.name.replace(/\.[^.]+$/, ''), `wm-${newId().slice(0, 8)}`, usage);
        updateWatermarks((current) => [...current, entry]);
        return entry.id;
      } catch (error) { setNotice(error instanceof Error ? error.message : 'That image could not be added.'); return null; }
    },
    cutOutWatermark: async (presetId, slot, tolerance, commit) => {
      const entry = watermarkStoreRef.current.find((candidate) => candidate.id === presetId);
      if (!entry) return null;
      const result = await cutOut(entry, slot, tolerance, commit).catch(() => null);
      if (!result) return null;
      if (commit && !result.tooMuch) {
        let applied = false;
        updateWatermarks((current) => {
          const next = replaceWatermarkIfUnchanged(current, entry, result.entry);
          applied = next !== current;
          return next;
        });
        if (!applied) { setNotice('The watermark changed while this edit was processing. Please try again.'); return null; }
      }
      if (result.tooMuch) setNotice('The background is not one flat colour, so it was left as it is. Try a plain background.');
      return { url: result.url, tooMuch: result.tooMuch };
    },
    makeWatermarkVariant: async (presetId, slot) => {
      const entry = watermarkStoreRef.current.find((candidate) => candidate.id === presetId);
      const next = entry ? await makeVariant(entry, slot).catch(() => null) : null;
      if (next && entry) {
        let applied = false;
        updateWatermarks((current) => {
          const replacement = replaceWatermarkIfUnchanged(current, entry, next);
          applied = replacement !== current;
          return replacement;
        });
        if (!applied) setNotice('The watermark changed while this edit was processing. Please try again.');
      }
      else setNotice('That version could not be made.');
    },
    deleteWatermark: (presetId) => {
      updateWatermarks((current) => current.filter((candidate) => candidate.id !== presetId));
      // Photos that used it fall back to the first watermark left in the library (or none); nothing else about them changes.
      const fallback = watermarkStoreRef.current.find((candidate) => candidate.id !== presetId)?.id ?? '';
      mutate((current) => ({ ...current, frames: current.frames.map((frame) => { const overlay = readOverlay(frame.overlay); return overlay.watermarkPresetId === presetId ? { ...frame, overlay: { ...overlay, watermarkPresetId: fallback } } : frame; }) }));
    },
    addTextWatermark: (text, subtext) => {
      const entry = textWatermark(`wm-${newId().slice(0, 8)}`, text, subtext);
      if (!entry) return null;
      updateWatermarks((current) => [...current, entry]);
      return entry.id;
    },
    addWatermarkVersion: async (presetId, slot) => {
      const entry = watermarkStoreRef.current.find((candidate) => candidate.id === presetId);
      if (!entry) return false;
      const picked = await pickImageFile();
      if (!picked) return false;
      try {
        const next = await addVersion(entry, slot, picked);
        updateWatermarks((current) => current.map((candidate) => (candidate.id === presetId ? { ...candidate, forDark: next.forDark, forLight: next.forLight } : candidate)));
        return true;
      } catch { setNotice('That image could not be added.'); return false; }
    },
    setWatermarkSlot: (presetId, slot) => updateWatermarks((current) => current.map((candidate) => (candidate.id === presetId ? moveToSlot(candidate, slot) : candidate))),
    listDeviceFonts: () => listDeviceFonts(),
    hasDeviceFont: (fontName) => hasDeviceFont(fontName),
    updateRecipe: (photoId, patch) => applyPatch(editTargets(photoId), patch),
    denoisePhoto,
    applyLook: (photoId, lookId) => {
      const look = stub.store.looks.find((entry) => entry.id === lookId);
      if (!look) return;
      const targets = editTargets(photoId);
      applyPatch(targets, look.recipeDelta);
      mutate((current) => ({ ...current, frames: current.frames.map((frame) => (targets.includes(frame.id) ? { ...frame, appliedLookId: lookId } : frame)) }));
    },
    resetPhotoEdits: (photoId) => { const targets = editTargets(photoId); editFrames(targets, () => undefined); mutate((current) => ({ ...current, frames: current.frames.map((frame) => (targets.includes(frame.id) ? { ...frame, appliedLookId: undefined } : frame)) })); },
    // With no photo open there is nothing to copy: a neutral recipe here would let Paste silently reset another photo.
    copyRecipe: () => { if (activeFrame) setClipboard(editToRecipe(activeFrame.edit)); },
    pasteRecipe: () => { if (clipboard && activeId) applyPatch(editTargets(activeId), clipboard); },
    setBurstGrouped: (burstGroupId, grouped) => mutate((current) => ({ ...current, frames: current.frames.map((frame) => (frame.burstGroupId === burstGroupId ? { ...frame, burstUngrouped: grouped ? undefined : true } : frame)) })),
    // Clicking an earlier step makes a NEW version; the parent and all its
    // later edit steps remain untouched and can be reopened from History.
    jumpToEditStep: (photoId, cursor) => {
      const versionId = `fork-${newId()}`;
      const at = Date.now();
      mutate((current) => ({
        ...current,
        shoot: { ...current.shoot, lastUpdatedAt: at },
        frames: current.frames.map((frame) =>
          frame.id === photoId ? syncEditGroup(forkEditCheckpoint(frame, cursor, versionId, at)) : frame),
      }));
    },
    switchEditVersion: (photoId, versionId) => {
      const at = Date.now();
      mutate((current) => ({
        ...current,
        shoot: { ...current.shoot, lastUpdatedAt: at },
        frames: current.frames.map((frame) =>
          frame.id === photoId ? syncEditGroup(switchVersionInCatalogue(frame, versionId)) : frame),
      }));
    },
    undo: () => {
      if (activeFrame?.editHistory && activeFrame.editHistory.cursor > 0) mutate((current) => ({ ...current, frames: current.frames.map((frame) => (frame.id === activeFrame.id ? syncEditGroup(stepEdit(frame, -1)) : frame)) }));
      else mutate(undoDecision);
    },
    redo: () => {
      const history = activeFrame?.editHistory;
      if (history && history.cursor < history.steps.length) mutate((current) => ({ ...current, frames: current.frames.map((frame) => (frame.id === activeFrame.id ? syncEditGroup(stepEdit(frame, 1)) : frame)) }));
      else mutate(redoDecision);
    },
    cancelTask: (id) => { tasks.cancel(Number(id)); },
    clearTask: (id) => { tasks.dismissFinished(Number(id)); setTaskHistory((current) => { const { [id]: _removed, ...rest } = current; return rest; }); },
    clearCompletedTasks: () => { tasks.clearFinished(); setTaskHistory({}); },
    clearNotice: () => { setNotice(null); stub.actions.clearNotice(); },
  };
  const unconnected = Object.fromEntries(NOT_CONNECTED.map((name) => [name, () => setNotice('That is not connected to the InFlight engine yet. Your photos and originals are unchanged.')])) as Partial<WorkspaceActions>;
  const actions = useMemo(() => ({ ...stub.actions, ...unconnected, ...real }) as WorkspaceActions,
    // `real` and `unconnected` are rebuilt each render and only close over stable refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stub.actions, stub.store.looks, templates, updateTemplates, applyAuto, changeOverlay, changeCrops, stub.store.selectedSizeIds, addMask, editMasks, runAutoCull, runExportAction, runDeepVisionReviewAction, activeId, activeFrame, clipboard, selected, applyPatch, editFrames, enterProject, openProject, backToProjects, decide, importPhotos, loadHub, reconnectOriginal]);

  exportEnv.current = { fonts: mergeFonts(deviceFonts), presets: watermarkLibrary, auto: watermarkAuto, textAllowed: featureAccess(can).overlayText, markAllowed: featureAccess(can).watermarkCustom };
  // Species names in the person's language arrive once, after start-up; the photo list is redrawn when they do.
  const [speciesNamesVersion, setSpeciesNamesVersion] = useState(0);
  useEffect(() => {
    const stop = onSpeciesNamesLoaded(() => setSpeciesNamesVersion((version) => version + 1));
    void loadSpeciesNames(language);
    return stop;
  }, []);
  const photos = useMemo(() => recountBursts((state?.frames ?? []).filter((frame) => !frame.removedAt && !pairs.rawOf.has(frame.id)).map((frame) => {
    const assist = assists[frame.id];
    const jpegId = pairs.jpegOf.get(frame.id);
    const pairedJpeg = jpegId ? state?.frames.find((candidate) => candidate.id === jpegId)?.filename : undefined;
    return withPairedJpeg(pairedJpeg, frameToPhoto(frame, urls[frame.id], { assist, watermarkAuto: watermarkAuto[frame.id], histogram: histograms[frame.id], pixelSize: pixelSizes[frame.id], verifiedOriginalSize: verifiedRasterSizes[`${frame.stableKey}|${frame.originalSha256 ?? ''}`], originalConnected: frame.sourceKind === 'file' && !isDesktopApp() ? provider.current?.hasBlob(frame.stableKey) === true : !urls[frame.id]?.failed, sources: { preview: provider.current?.pictureSourceOf(urls[frame.id]?.preview), thumb: provider.current?.pictureSourceOf(urls[frame.id]?.thumb) }, dngCopy: dngCopyOffered(frame, canExportRawMaster()), fullDevelop: fullDeveloping[frame.stableKey] ? 'running' : fullDevelopPossible(frame, canDevelopRaw(), Boolean(provider.current?.hasBlob(frame.stableKey)) || frame.sourceKind !== 'file' || isDesktopApp()) ? 'possible' : undefined }));
  })), [state?.frames, pairs, urls, assists, watermarkAuto, histograms, pixelSizes, verifiedRasterSizes, speciesNamesVersion, fullDeveloping]);
  // Photos moved to Trash: browsable and restorable from the Removed panel without walking back through Undo
  // (ROADMAP.md, "Removed photos panel" next item). Thumbnails are not fetched for them; the filename is enough
  // to recognise one in a short list, and restoring returns it to the normal, already-thumbnailed photo list.
  const removedPhotos = useMemo(() => removedFrames(state?.frames ?? []).map((frame) => frameToPhoto(frame, urls[frame.id], {})), [state?.frames, urls]);
  const store: WorkspaceStore = useMemo(() => ({
    ...stub.store,
    fonts: mergeFonts(deviceFonts),
    settings: mergeSettings(stub.store.settings, savedUi.settings),
    assistMode,
    watermarkPresets: watermarkLibrary,
    overlayTemplates: templates.map(({ id, name }) => ({ id, name })),
    features: featureAccess(can),
    featurePlan: featurePlan(),
    screen, hubState, projects,
    activeProjectId: state?.shoot.id ?? null,
    collage: readCollage(state?.shoot.collage),
    photos,
    removedPhotos,
    removedOpen,
    activePhotoId: activeId,
    selectedPhotoIds: selected,
    reviewingPhotoIds: reviewingIds,
    // Finished tasks join the history in an effect, one render after the store marks them done. Merge them here too,
    // so a task that has just finished is never missing from both lists (the Tasks panel would lose its row).
    tasks: visibleTasks(
      taskList.filter((task) => task.state === 'running' || task.state === 'queued' || task.state === 'paused').map(taskToInfo),
      Object.values({
        ...taskHistory,
        ...Object.fromEntries(taskList.filter((task) => task.state === 'done' || task.state === 'failed' || task.state === 'cancelled')
          .filter((task) => !taskHistory[String(task.id)])
          .map((task) => { const info = taskToInfo({ ...task, endedAt: task.endedAt ?? Date.now() }); return [info.id, info]; })),
      }),
      clock,
    ),
    canUndo: Boolean(state?.undoStack.length) || (activeFrame?.editHistory?.cursor ?? 0) > 0,
    canRedo: Boolean(state?.redoStack.length) || (activeFrame?.editHistory ? activeFrame.editHistory.cursor < activeFrame.editHistory.steps.length : false),
    clipboardRecipe: clipboard,
    PhotoSurface: EngineSurface,
    lastActionNotice: notice ?? stub.store.lastActionNotice,
    quickStart: quickStart && quickStart.projectId === state?.shoot.id && screen === 'editor' ? { phase: quickStart.phase, photoId: quickStart.photoId } : null,
    lightroomOffer: lightroomOffer && lightroomPending.current?.projectId === state?.shoot.id ? lightroomOffer : null,
    backup: state ? { state: backupStatus.state, at: backupStatus.at } : null,
  }), [backupStatus.state, backupStatus.at, stub.store, can, savedUi, assistMode, deviceFonts, watermarkLibrary, templates, screen, hubState, projects, state?.shoot.id, state?.shoot.collage, state?.undoStack.length, state?.redoStack.length, activeFrame, clipboard, photos, removedPhotos, removedOpen, activeId, selected, taskList, taskHistory, clock, notice, lightroomOffer, quickStart]);

  return { store, actions };
}
