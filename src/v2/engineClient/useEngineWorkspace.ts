import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { applyCullConfidence, applyDecisionWithHistory, redoDecision, removedFrames, removeFromLibrary, restoreRemoved, undoDecision } from '../../core/cullingEngine';
import { jumpToStep, recordEdit, stepEdit } from '../../core/editHistory';
import { isEmptyEdit, DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import { sameRecipe } from '../../core/naturalAuto';
import { newId } from '../../core/ids';
import { PHOTO_ACCEPT } from '../../core/rawFormats';
import { appendProjectPhotos, applyImportBursts, createEmptyProject, setArchived } from '../../core/projects';
import { tasks } from '../../core/taskStore';
import type { CullDecision, CullingState, PhotoFrame, ShootDescriptor } from '../../core/types';
import { eraseDeviceData } from './eraseDeviceData';
import { BrowserCatalogueStore } from '../../providers/browserCatalogueStore';
import { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { projectCoverBlob } from './projectCover';
import { scanForCulling } from '../../providers/browserAutoCull';
import { useAccess } from '../../providers/useAccess';
import { useBackgroundDevelop } from '../../useBackgroundDevelop';
import { useSpeciesScan } from '../../useSpeciesScan';
import { isDesktopApp } from '../../providers/desktopShell';
import { pickedFromFile, pickedKey, pickPhotosNatively, type PickedPhoto } from '../../providers/linkedOriginals';
import { getLocalFileKey, loadLocalFileListShoot, rehydrateLocalFramesFromStore } from '../../providers/localShootLoader';
import { hashOriginalBytes, isSameOriginalBytes } from '../../core/originalFileIdentity';
import type { EditRecipe, HubViewState, OverlaySettings, PhotoHistogram, WatermarkPreset, Project, TaskInfo, WorkspaceActions, WorkspaceStore } from '../ui/contract';
import { useWorkspace } from '../ui/stub';
import { EngineSurface } from './EngineSurface';
import { featureAccess, featurePlan } from './featureMap';
import { hasDeviceFont, listDeviceFonts, loadSavedDeviceFonts, mergeFonts, saveDeviceFonts } from './fonts';
import { assetUrl, cutOut, importWatermark, loadStored, makeVariant, saveStored, toPresets, type StoredWatermark } from './watermarkLibrary';
import { watermarkToneForPixels } from '../../core/watermark';
import { INITIAL_WATERMARKS, createDefaultSizes } from '../ui/stub';
import { toPhotoHistogram } from './histogram';
import { isHeifFile, isRawPreviewFile } from '../../core/rawFormats';
import { loadUi, mergeSettings, saveUi, type SavedUi } from './uiSettings';
import { applyCanvasPhotoEdit } from '../../core/canvasEdit';
import { DEFAULT_EDIT as EMPTY_EDIT } from '../../core/photoEdits';
import { DEFAULT_CROP, flipCrop, patchCrop, rotateCrop } from './cropOps';
import { readCrops } from './cropOps';
import { addRow, alignOverlays, patchOverlay, readOverlay, removeRow, updateRow } from './overlayOps';
import { frameToPhoto, shootToProject, taskToInfo, visibleTasks, type AssistState, type FrameUrls } from './frameToPhoto';
import { runAuto } from './runAuto';
import { runV2Denoise } from './runDenoise';
import { moveArtboard } from './boardOps';
import { accountConnection } from '../../providers/licenceStore';
import { runDeepVisionReview } from './deepVisionReview';
import { planExport } from './exportOps';
import { TEMPLATES_KEY, addTemplate, deleteTemplate, overlayFromTemplate, readTemplates, renameTemplate, type OverlayTemplate } from './overlayTemplates';
import { addFormat, applyFormats, readFormats, removeFormat, toggleFormat, toggleSizeLinked as toggleSizeLinkedRaw, validCustomSize } from './formatOps';
import { patchVideoZoom } from './videoZoomOps';
import { setFormatSplitOffset, toggleFormatSplit } from './formatSplitOps';
import { readSplitPanOffset } from './splitFrameOps';
import { canAddMask, removeMask, setMaskEdit, setMaskFeather, toggleMask } from './maskOps';
import { verifyFrameMasks } from './maskVerify';
import { createSubjectMask, framingKey, hasActiveMasks } from '../../core/maskTypes';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize } from '../../core/photoFraming';
import { GUIDED_RENDER_EDGE } from '../../core/subjectGuide';
import { detectSubjectGuided } from '../../providers/subjectDetector';
import { judgeSubject } from '../../core/autoCull';
import { archiveExports, downloadExport, loadExportSource, loadVerifiedRasterOriginalForExport } from '../../providers/browserExport';
import { toProfile } from '../../core/exportFormats';
import { renderV2Export, type OverlayDraw } from './renderV2Export';
import { formatOverlayRowText } from '../ui/utils/studioMath';
import { loadImage } from '../../providers/loadImage';
import { deliverExport, describeExport } from './exportDelivery';
import { uniqueExportFilename } from '../../core/exportNaming';
import { exportMayContinue } from '../../core/exportCancellation';
import type { ExportRequest } from '../ui/contract';
import { applyRecipePatch, editToRecipe } from './recipeMap';
import { surfaceBridge } from './surfaceBridge';

/** Actions that change a photo's edit, sizes, overlay, masks or assist state. They are not connected to the real
 * recipe yet, so they say so instead of silently changing sample data. */
const NOT_CONNECTED = [
  'setActiveGroup', 'addEditGroup', 'renameEditGroup',
] as const satisfies readonly (keyof WorkspaceActions)[];

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
    rows: overlay.rows.map((row) => ({ text: formatOverlayRowText(row, photo) || 'Custom caption', family: env.fonts.find((font) => font.id === row.fontId)?.family ?? fallbackFamily, weight: row.weight, sizePx: row.sizePx, letterSpacing: row.letterSpacing })),
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
  const { can: canByPlan } = useAccess();
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
  const [watermarkLibrary, setWatermarkLibrary] = useState<WatermarkPreset[]>([]);
  const [templates, setTemplates] = useState<OverlayTemplate[]>(() => { try { return readTemplates(localStorage.getItem(TEMPLATES_KEY)); } catch { return []; } });
  const updateTemplates = useCallback((next: OverlayTemplate[]) => { setTemplates(next); try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(next)); } catch { setNotice('InFlight could not save the template on this device.'); } }, []);
  const [savedUi, setSavedUi] = useState<SavedUi>(loadUi);
  const [pixelSizes, setPixelSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [verifiedRasterSizes, setVerifiedRasterSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [histograms, setHistograms] = useState<Record<string, PhotoHistogram>>({});
  const [watermarkAuto, setWatermarkAuto] = useState<Record<string, 'light-on-dark' | 'dark-on-light'>>({});
  useEffect(() => { let live = true; void toPresets(watermarkStore).then((presets) => { if (live) setWatermarkLibrary(presets); }); return () => { live = false; }; }, [watermarkStore]);
  const updateWatermarks = useCallback((next: StoredWatermark[]) => { setWatermarkStore(next); saveStored(next); }, []);
  const [assists, setAssists] = useState<Record<string, AssistState>>({});
  const autoInFlight = useRef(new Set<string>());
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
    const finished = taskList.filter((task) => task.state !== 'running');
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
        const cover = await projectCoverBlob(frames);
        const url = cover ? URL.createObjectURL(cover) : '';
        if (url) nextUrls.push(url);
        return shootToProject(shoot, frames, url);
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

  // Save the open project whenever it changes, exactly as the current app does.
  useEffect(() => {
    if (!state || screen !== 'editor') return;
    void catalogue.current!.saveProject(state).catch(() => setNotice('InFlight could not save this project. Your original photos are unchanged.'));
  }, [state, screen]);

  const openRequest = useRef(0);
  useEffect(() => () => { openRequest.current += 1; }, []);

  const enterProject = useCallback((next: CullingState, restored?: BrowserPreviewProvider) => {
    openRequest.current += 1;
    provider.current!.clear();
    if (restored) provider.current = restored;
    thumbs.current = { generation: thumbs.current.generation + 1, requested: new Set(), queue: [], active: 0 };
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
        setNotice('That project could not be opened.');
      }
    } finally {
      if (provider.current !== restored) restored.clear();
    }
  }, [enterProject]);

  // Thumbnails: a few at a time, so a large project does not start thousands of reads at once. Each photo is asked for
  // once; a read in flight is never thrown away when more photos arrive, only when the project changes (generation).
  const thumbs = useRef({ generation: 0, requested: new Set<string>(), queue: [] as PhotoFrame[], active: 0 });
  const pumpThumbnails = useCallback(() => {
    const book = thumbs.current;
    while (book.active < THUMBNAIL_WORKERS && book.queue.length) {
      const frame = book.queue.shift()!;
      const generation = book.generation;
      book.active += 1;
      provider.current!.getThumbnailUrl(frame, 'visible').then(
        (thumb) => {
          if (generation !== thumbs.current.generation) return;
          // An empty address means the original cannot be read (not connected, or not stored): say so, never "Importing".
          setUrls((current) => (current[frame.id]?.thumb ? current : { ...current, [frame.id]: thumb ? { ...current[frame.id], thumb } : { ...current[frame.id], failed: true } }));
        },
        () => { if (generation === thumbs.current.generation) setUrls((current) => ({ ...current, [frame.id]: { ...current[frame.id], failed: true } })); },
      ).finally(() => { if (generation === thumbs.current.generation) { thumbs.current.active -= 1; pumpThumbnails(); } });
    }
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

  const mutate = useCallback((change: (current: CullingState) => CullingState) => setState((current) => (current ? change(current) : current)), []);

  const decide = useCallback((ids: string[], decision: CullDecision) => {
    mutate((current) => ids.reduce((next, id) => applyDecisionWithHistory(next, id, decision, { allowAdvance: false }), current));
  }, [mutate]);

  // Moves already set-aside (rejected) photos to Trash. removeFromLibrary (shared with V1) ignores any id that
  // is not currently rejected, so this never deletes a kept or unreviewed photo by mistake. The removal itself is
  // written to the same undoStack that per-photo Undo already reads, so Cmd/Ctrl+Z brings it straight back.
  const removePhotos = useCallback((ids: string[]) => {
    mutate((current) => removeFromLibrary(current, ids));
    setSelected((current) => current.filter((id) => !ids.includes(id)));
  }, [mutate]);

  const activeFrame = state?.frames.find((frame) => frame.id === activeId) ?? null;
  // Measure the original only when the user opens an ordinary JPEG/PNG photo.
  // Do NOT promote a RAW embedded JPEG, EXIF or a cached review preview to native.
  const activeRasterKey = activeFrame ? `${activeFrame.stableKey}|${activeFrame.originalSha256 ?? ''}` : null;
  useEffect(() => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === activeId);
    if (!frame || !activeRasterKey || frame.isDemo || !/\\.(?:jpe?g|png)$/i.test(frame.filename) ||
        verifiedRasterSizes[activeRasterKey]) return;
    let live = true;
    void loadVerifiedRasterOriginalForExport(frame, provider.current!).then(
      (image) => {
        if (live) setVerifiedRasterSizes((current) => ({
          ...current, [activeRasterKey]: { width: image.naturalWidth, height: image.naturalHeight },
        }));
      },
      () => { /* Remain at an unverified preview size; never invent native pixels. */ },
    );
    return () => { live = false; };
    // Depends on source identity, not editing controls or unstable frame objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeRasterKey]);
  const editTargets = (photoId: string) => (selected.includes(photoId) ? selected : [photoId]);
  const editFrames = useCallback((ids: string[], change: (frame: PhotoFrame) => PhotoEdit | undefined) => {
    const at = Date.now();
    mutate((current) => ({
      ...current,
      shoot: { ...current.shoot, lastUpdatedAt: at },
      frames: current.frames.map((frame) => {
        if (!ids.includes(frame.id)) return frame;
        const edit = change(frame);
        return recordEdit(frame, { edit: edit && !isEmptyEdit(edit) ? edit : undefined }, at);
      }),
    }));
  }, [mutate]);
  const applyPatch = useCallback((ids: string[], patch: Partial<EditRecipe>) => {
    const { unmapped } = applyRecipePatch(undefined, patch);
    if (unmapped.length) setNotice(`Not connected to the InFlight engine yet, so not applied: ${unmapped.join(', ')}.`);
    editFrames(ids, (frame) => applyRecipePatch(frame.edit, patch).edit);
  }, [editFrames]);

  // RAW photos are developed from their sensor data in the background, so V2 shows InFlight's develop, not the camera's
  // JPEG. The photo on the canvas goes first. Paused while photos are being imported.
  useBackgroundDevelop({
    projectId: state?.shoot.id ?? '', frames: state?.frames ?? [], provider: provider.current,
    active: screen === 'editor' && Boolean(state) && !importing, onScreen: activeId,
  });

  // Subject and species are named quietly on this device after photos are added (the species name is a suggestion the
  // person can change, and it never changes a decision). The species check is the Pro feature `speciesId`.
  useSpeciesScan({
    projectId: state?.shoot.id ?? '', frames: state?.frames ?? [], provider: provider.current,
    active: screen === 'editor' && Boolean(state) && can('speciesId'),
    onResult: (frameId, patch) => setState((current) => (current ? { ...current, frames: current.frames.map((frame) =>
      frame.id === frameId && !frame.removedAt && !frame.speciesChecked && !frame.tags?.length && !frame.subjectNames?.length
        ? { ...frame, ...patch, ...(frame.subjectKind && patch.subjectKind ? { subjectKind: frame.subjectKind } : {}) } : frame) } : current)),
  });

  /** Scores every undecided photo on this device. It flags only high-confidence keepers; it never rejects anything, and
   * says how many photos look like rejects or duplicates so the person can look at them. */
  /** Export edited photos at the chosen sizes, as a zip or one file at a time. Overlay, watermark, crops, before images and
   * video are refused by planExport until the renderer honours them, so a file always matches what was asked for. */
  const runExportAction = useCallback(async (request: ExportRequest) => {
    const current = stateRef.current;
    if (!current) return;
    const plan = planExport(request, current.frames, createDefaultSizes());
    if ('error' in plan) { setNotice(plan.error); return; }
    const controller = new AbortController();
    const task = tasks.start(`Exporting ${plan.summary}`, { total: plan.jobs.reduce((sum, job) => sum + job.variants.length * (job.sections ?? 1), 0) + plan.originals.length, cancel: () => controller.abort() });
    const output: File[] = [];
    const used = new Set<string>();
    let cappedCount = 0;
    const started = new Date();
    try {
      for (const job of plan.jobs) {
        if (!exportMayContinue(controller.signal.aborted, task.cancelled, false)) return;
        const frame = current.frames.find((candidate) => candidate.id === job.frameId);
        if (!frame) continue;
        // For JPEG/PNG 'Original', read the verified connected source bytes.
        // A preview (especially a RAW embedded JPEG) cannot establish native size.
        const nativeRaster = job.format.id === 'orig-3x2' && /\\.(?:jpe?g|png)$/i.test(frame.filename) && !frame.isDemo;
        const image = nativeRaster
          ? await loadVerifiedRasterOriginalForExport(frame, provider.current!)
          : await loadExportSource(frame, provider.current!);
        const nativeSize = nativeRaster
          ? framedSize(image.naturalWidth, image.naturalHeight, frame.framing ?? DEFAULT_FRAMING)
          : null;
        // Preserve an explicit export size limit; Original is full decoded size only
        // when the photographer did not ask for a smaller maximum long edge.
        const longEdge = nativeSize ? Math.max(nativeSize.width, nativeSize.height) : 0;
        const scale = nativeSize && request.maxLongestEdgePx && request.maxLongestEdgePx > 0
          ? Math.min(1, request.maxLongestEdgePx / longEdge) : 1;
        const outputSize = nativeSize
          ? { width: Math.max(1, Math.round(nativeSize.width * scale)), height: Math.max(1, Math.round(nativeSize.height * scale)) }
          : job.size;
        const outputFormat = nativeSize
          ? { ...job.format, width: outputSize.width, height: outputSize.height }
          : job.format;
        const env = exportEnv.current;
        for (const variant of job.variants) {
          if (!exportMayContinue(controller.signal.aborted, task.cancelled, false)) return;
          // The unedited copy has no recipe and no overlay: the same framing, developed, and plainly labelled in its name.
          const unedited = variant === 'unedited';
          const overlayDraw = unedited ? null : await buildOverlayDraw(frame, request, env);
          const result = await renderV2Export(image, unedited ? { ...frame, edit: DEFAULT_EDIT } : frame, outputSize, job.crop, toProfile(outputFormat), overlayDraw, started, controller.signal, job.sections ?? 1);
          const renderedFiles = result.sections ?? [result.file];
          if (result.capped) cappedCount += renderedFiles.length;
          for (const rendered of renderedFiles) {
            const base = unedited ? rendered.name.replace(/(\.[^.]+)?$/, '-unedited$1') : rendered.name;
            const name = uniqueExportFilename(base, used);
            output.push(name === rendered.name ? rendered : new File([rendered], name, { type: rendered.type, lastModified: rendered.lastModified }));
            task.progress(output.length);
          }
        }
      }
      // Exact original files: the bytes as shot, never a developed or preview file. A photo whose original is not connected is
      // skipped and named; nothing is substituted.
      const missingOriginals: string[] = [];
      for (const frameId of plan.originals) {
        if (!exportMayContinue(controller.signal.aborted, task.cancelled, false)) return;
        const frame = current.frames.find((candidate) => candidate.id === frameId);
        if (!frame) continue;
        const bytes = frame.isDemo ? undefined : await provider.current!.ensureOriginal(frame.stableKey, 'selected');
        if (!bytes) { missingOriginals.push(frame.filename); continue; }
        output.push(new File([bytes], uniqueExportFilename(frame.filename, used), { type: bytes.type || 'application/octet-stream', lastModified: Date.now() }));
        task.progress(output.length);
      }
      if (!exportMayContinue(controller.signal.aborted, task.cancelled, false)) return;
      const result = describeExport(output.length, missingOriginals);
      if (!output.length) {
        task.fail(result);
        setNotice(result);
        return;
      }
      await deliverExport(output, request.destination, started, controller.signal, archiveExports, downloadExport);
      task.finish(result);
      setNotice(`${result}${cappedCount ? ` ${cappedCount} ${cappedCount === 1 ? 'file is' : 'files are'} smaller than the size asked for, because the photo has fewer pixels.` : ''} Your originals are unchanged.`);
    } catch (reason) {
      if (!controller.signal.aborted && !task.cancelled) { const message = reason instanceof Error ? reason.message : 'Export failed.'; task.fail(message); setNotice(message); }
    } finally {
      task.fail('Stopped'); // does nothing if the task already finished or was cancelled
    }
  }, []);

  const runAutoCull = useCallback(async () => {
    const current = stateRef.current;
    if (!current) return;
    if (!can('smartCulling')) { setNotice('Auto-cull is part of InFlight Pro.'); return; }
    if (cullController.current) { setNotice('Auto-cull is already running.'); return; }
    const candidates = current.frames.filter((frame) => !frame.removedAt && frame.decision === 'unreviewed' && !frame.isDemo && !frame.virtualCopy);
    if (!candidates.length) { setNotice('Every photo already has a decision, so there is nothing to cull.'); return; }
    const controller = new AbortController();
    cullController.current = controller;
    const task = tasks.start('Auto-cull and analyse', { total: candidates.length, cancel: () => controller.abort() });
    const projectKey = current.shoot.id;
    try {
      const results = await scanForCulling(candidates, current.frames, provider.current!, current.keeperTarget, controller.signal,
        (count) => { if (!controller.signal.aborted) task.progress(count); },
        () => { if (!controller.signal.aborted) setNotice('The subject detector is not available, so Auto-cull used sharpness and exposure only and is less certain.'); });
      if (controller.signal.aborted) return;
      const keepers = results.filter((result) => result.confidence === 'high' && result.decision === 'keep').map((result) => result.frameId);
      const lookWorse = results.filter((result) => result.decision === 'reject').length;
      setState((latest) => {
        if (!latest || latest.shoot.id !== projectKey) return latest;
        const scored = applyCullConfidence(latest, results.map((result) => ({ frameId: result.frameId, confidence: result.confidence, score: result.score })));
        return keepers.reduce((next, id) => (next.frames.find((frame) => frame.id === id)?.decision === 'unreviewed'
          ? applyDecisionWithHistory(next, id, 'keep', { allowAdvance: false }) : next), scored);
      });
      const summary = `Auto-cull looked at ${results.length} photo${results.length === 1 ? '' : 's'} and flagged ${keepers.length} likely keeper${keepers.length === 1 ? '' : 's'}. ${lookWorse ? `${lookWorse} look like rejects or duplicates; none were rejected, so look at them yourself. ` : ''}Photos it was unsure about were left for you.`;
      task.finish(summary);
      setNotice(summary);
    } catch {
      if (!controller.signal.aborted) { task.fail('Auto-cull failed.'); setNotice('Auto-cull failed. No photo was changed.'); }
    } finally {
      task.fail('Auto-cull stopped.'); // does nothing once finished or cancelled
      if (cullController.current === controller) cullController.current = null;
    }
  }, [can]);

  /** The text and watermark overlay lives with the photo (saved, backed up and exported with the project). It is not an
   * edit, so it has no place in the edit history. */
  const changeOverlay = useCallback((photoId: string, change: (overlay: OverlaySettings) => OverlaySettings) => {
    const at = Date.now();
    mutate((current) => ({
      ...current,
      shoot: { ...current.shoot, lastUpdatedAt: at },
      frames: current.frames.map((frame) => (frame.id === photoId ? { ...frame, overlay: change(readOverlay(frame.overlay)) } : frame)),
    }));
  }, [mutate]);

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
        // For a plain picture file the shown image IS the original size; for RAW and HEIF it is a preview, so nothing is claimed.
        if (live && !frame.exif.width && !isRawPreviewFile(frame.filename) && !isHeifFile(frame.filename)) setPixelSizes((current) => (current[frame.id] ? current : { ...current, [frame.id]: { width: image.naturalWidth, height: image.naturalHeight } }));
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
  const maskVerifyKey = activeFrame && hasActiveMasks(activeFrame.edit?.masks) ? `${activeFrame.id}|${JSON.stringify(activeFrame.edit!.masks)}` : null;
  const maskVerifyRunning = useRef<string | null>(null);
  useEffect(() => {
    if (!maskVerifyKey || !activeFrame) return;
    let live = true;
    const frame = activeFrame;
    const photoId = frame.id;
    const key = maskVerifyKey;
    const timer = window.setTimeout(() => {
      if (!live || maskVerifyRunning.current === key) return;
      maskVerifyRunning.current = key;
      (async () => {
        try {
          const image = await loadExportSource(frame, provider.current!);
          if (!live) return;
          const outcome = await verifyFrameMasks(image, frame);
          // Only the one case worth acting on: the engine actually had to scale something down. A first-try
          // pass (attempts === 1) is the masks already held up - nothing to write back or tell anyone.
          if (!live || !outcome || outcome.attempts <= 1) return;
          // Re-read: the photo (or its masks) may have changed again while this ran. If so, a newer run
          // will judge the newer masks; this stale result is dropped rather than overwriting it.
          const latest = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
          if (!latest || JSON.stringify(latest.edit?.masks ?? []) !== JSON.stringify(frame.edit?.masks ?? [])) return;
          editFrames([photoId], (current) => ({ ...(current.edit ?? DEFAULT_EDIT), masks: outcome.masks }));
          setNotice(outcome.verification.ok
            ? `A mask's strength was reduced to keep its effect plausible${outcome.verification.reasons.length ? `: ${outcome.verification.reasons.join(' ')}` : '.'}`
            : `A mask's effect still looked too strong after retrying, so it was left at the gentlest version tried${outcome.verification.reasons.length ? `: ${outcome.verification.reasons.join(' ')}` : '.'}`);
        } catch {
          // A safety net, not a blocker: if the check itself fails, editing continues with whatever the
          // sliders already show, same as any other best-effort engine capability.
        } finally {
          if (maskVerifyRunning.current === key) maskVerifyRunning.current = null;
        }
      })();
    }, 500);
    return () => { live = false; window.clearTimeout(timer); };
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
        for (const id of sizeIds) crops[id] = change(crops[id]);
        return { ...frame, sizeCrops: crops };
      }),
    }));
  }, [mutate]);

  /** Change a photo's format set. Returns false when the change was refused (nothing is saved). `crops` may also rewrite the saved crops. */
  const changeFormats = useCallback((photoId: string, change: (raw: unknown) => ReturnType<typeof readFormats> | undefined, crops?: (raw: unknown) => unknown): boolean => {
    const current = stateRef.current;
    const frame = current?.frames.find((candidate) => candidate.id === photoId);
    if (!current || !frame) return false;
    const next = change(frame.formats);
    if (!next) return false;
    const at = Date.now();
    mutate((state) => ({ ...state, shoot: { ...state.shoot, lastUpdatedAt: at }, frames: state.frames.map((entry) => (entry.id === photoId ? { ...entry, formats: next, ...(crops ? { sizeCrops: crops(entry.sizeCrops) } : {}) } : entry)) }));
    return true;
  }, [mutate]);

  /** Flip a format between paper-clipped to the active edit group and independent. Only that one photo's choice changes. */
  const toggleSizeLinked = useCallback((photoId: string, sizeId: string) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    if (!frame) return;
    const next = toggleSizeLinkedRaw(frame.sizeLinked, sizeId);
    const at = Date.now();
    mutate((state) => ({ ...state, shoot: { ...state.shoot, lastUpdatedAt: at }, frames: state.frames.map((entry) => (entry.id === photoId ? { ...entry, sizeLinked: next } : entry)) }));
  }, [mutate]);

  /** Change a photo's video pan/zoom (Ken Burns) settings. Only the given fields change; the rest are kept. */
  const updateVideoZoom = useCallback((photoId: string, patch: Parameters<typeof patchVideoZoom>[1]) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    if (!frame) return;
    const next = patchVideoZoom(frame.videoZoom, patch);
    const at = Date.now();
    mutate((state) => ({ ...state, shoot: { ...state.shoot, lastUpdatedAt: at }, frames: state.frames.map((entry) => (entry.id === photoId ? { ...entry, videoZoom: next } : entry)) }));
  }, [mutate]);

  /** Split only the active FORMAT; other outputs of the photo are unaffected. */
  const toggleSplitFrames = useCallback((photoId: string) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    const sizeId = stub.store.activeSizeId;
    if (!frame || !sizeId) return;
    const next = toggleFormatSplit(frame.formatSplits ?? (frame.splitFrames === true ? { 'orig-3x2': { enabled: true, offset: readSplitPanOffset(frame.splitPanOffset) } } : undefined), sizeId);
    const at = Date.now();
    mutate((state) => ({ ...state, shoot: { ...state.shoot, lastUpdatedAt: at }, frames: state.frames.map((entry) => (entry.id === photoId ? { ...entry, formatSplits: next } : entry)) }));
  }, [mutate, stub.store.activeSizeId]);

  /** Move both halves together inside this format's two-section composition. */
  const setSplitPanOffset = useCallback((photoId: string, offset: number) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    const sizeId = stub.store.activeSizeId;
    if (!frame || !sizeId) return;
    const next = setFormatSplitOffset(frame.formatSplits ?? (frame.splitFrames === true ? { 'orig-3x2': { enabled: true, offset: readSplitPanOffset(frame.splitPanOffset) } } : undefined), sizeId, offset);
    const at = Date.now();
    mutate((state) => ({ ...state, shoot: { ...state.shoot, lastUpdatedAt: at }, frames: state.frames.map((entry) => (entry.id === photoId ? { ...entry, formatSplits: next } : entry)) }));
  }, [mutate, stub.store.activeSizeId]);

  /** Find the subject on this device and add it (or, for the background, its inverse) as a mask with no adjustments yet.
   * Sky, painted and area masks need tools V2 does not have, so they say so instead of adding a layer that does nothing. */
  const addMask = useCallback(async (photoId: string, type: 'subject' | 'sky' | 'background' | 'brush' | 'area') => {
    if (type === 'sky') { setNotice('Sky masks are not available yet: there is no sky detector. Use Subject or Background.'); return; }
    if (type !== 'subject' && type !== 'background') { setNotice('Painted and area masks need drawing tools that V2 does not have yet. Use Subject or Background.'); return; }
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId && !candidate.removedAt);
    if (!frame) return;
    if (!canAddMask(frame.edit?.masks)) { setNotice('This photo has the most masks it can hold. Remove one first.'); return; }
    if (maskInFlight.current.has(photoId)) return;
    maskInFlight.current.add(photoId);
    const task = tasks.start(type === 'subject' ? 'Finding the subject' : 'Finding the background');
    try {
      const image = await loadExportSource(frame, provider.current!);
      const framing = frame.framing ?? DEFAULT_FRAMING;
      const { width, height } = framedSize(image.naturalWidth, image.naturalHeight, framing);
      const framed = document.createElement('canvas');
      drawFramedPhoto(image, framed, framing, { scale: Math.min(1, GUIDED_RENDER_EDGE / Math.max(width, height)) });
      const { grid, assessment, detail, boxFinding } = await detectSubjectGuided(framed);
      if (!assessment.usable) { task.finish('No clear subject'); setNotice(assessment.reason); return; }
      const mask = { ...createSubjectMask(newId(), grid, framingKey(framing), assessment.confidence, detail), invert: type === 'background', feather: 0.5 };
      // Re-read the photo: its edit may have changed while the subject was being found.
      editFrames([photoId], (latest) => ({ ...(latest.edit ?? DEFAULT_EDIT), masks: [...(latest.edit?.masks ?? []), mask] }));
      task.finish(assessment.reason);
      // Advisory only: the segmentation model's own usability check above is the sole gate on creating this
      // mask, same as before - this never blocks or changes the mask. When the guided path actually steered
      // it with a detector box, additionally run that box through this capability's real trust gate
      // (autoCull.ts's judgeSubject, the same score/size/sharpness logic engine/subjectDetectAction.ts uses
      // for exactly this question), and fold its verdict into the notice so a low-confidence find is said
      // plainly rather than only ever reading "Added". `judgeSubject`'s decision is cull vocabulary (keep a
      // photo vs. not), re-read here only for its confidence word, never as a reason to discard a mask.
      // Named "detector" confidence to keep it distinct from `assessment.confidence` above (the outline's
      // own edge-clarity reading, already folded into the stored mask) - the two measure different things.
      const trustNote = boxFinding
        ? `, ${judgeSubject({ label: boxFinding.detection.label, score: boxFinding.detection.score, size: Math.max(boxFinding.detection.box.w, boxFinding.detection.box.h), sharpness: boxFinding.sharpness }).confidence}-confidence detection`
        : '';
      setNotice(`Added the ${type} mask${trustNote}. It changes nothing until you move one of its sliders.`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not find the subject.';
      task.fail(message); setNotice(message);
    } finally {
      maskInFlight.current.delete(photoId);
    }
  }, [editFrames]);
  const editMasks = useCallback((photoId: string, change: (masks: ReturnType<typeof removeMask>) => ReturnType<typeof removeMask>) =>
    editFrames([photoId], (frame) => ({ ...(frame.edit ?? DEFAULT_EDIT), masks: change(frame.edit?.masks ?? []) })), [editFrames]);

  // The person pressed "Denoise this photo". Signed in, online and with the cloud feature on, that press is the consent to
  // upload a working-size copy for this one job; otherwise, or if the cloud fails or does not verify, it runs on this device.
  const denoiseInFlight = useRef(new Set<string>());
  const denoisePhoto = useCallback((photoId: string) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    if (!frame || denoiseInFlight.current.has(photoId)) return;
    denoiseInFlight.current.add(photoId);
    const connection = can('cloudAssist') ? accountConnection() : null;
    const task = tasks.start(connection ? 'Denoising (cloud, with this device as backup)' : 'Denoising on this device');
    runV2Denoise(frame, provider.current!, connection ? { connection, online: navigator.onLine !== false } : null).then((outcome) => {
      if (!outcome) { task.finish('Could not denoise this photo.'); return; }
      if (outcome.verified) editFrames([photoId], (current) => ({ ...(current.edit ?? DEFAULT_EDIT), denoise: outcome.strength }));
      task.finish(outcome.verified ? outcome.notes[0] : outcome.notes.join(' '));
      setNotice(outcome.verified ? outcome.notes[0] : `Left as it was. ${outcome.notes.join(' ')}`);
    }, () => task.fail('Denoise failed.')).finally(() => denoiseInFlight.current.delete(photoId));
  }, [can, editFrames]);

  const applyAuto = useCallback((frameId: string) => {
    const assist = assists[frameId];
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === frameId);
    if (!assist || !frame) return;
    if (!sameRecipe(frame.edit ?? DEFAULT_EDIT, assist.run.plan.base)) { setNotice('This photo changed since Auto looked at it. Open it again to get a fresh suggestion.'); return; }
    editFrames([frameId], () => assist.run.plan.proposal);
    setAssists((current) => ({ ...current, [frameId]: { ...assist, applied: true } }));
  }, [assists, editFrames]);

  // Co-pilot and Auto-pilot look at the photo on the canvas, on this device, one at a time. Solo never does.
  const assistMode = stub.store.assistMode;
  useEffect(() => {
    if (screen !== 'editor' || assistMode === 'solo' || !activeFrame || assists[activeFrame.id] || autoInFlight.current.has(activeFrame.id)) return;
    const frame = activeFrame;
    autoInFlight.current.add(frame.id);
    const task = tasks.start('Checking the photo and colour');
    runAuto(frame, provider.current!).then((run) => {
      if (!run) { task.finish('Could not analyse this photo.'); return; }
      task.finish(run.headline);
      const untouched = !frame.edit && !frame.editHistory?.steps.length;
      const apply = assistMode === 'autopilot' && run.improved && untouched;
      setAssists((current) => ({ ...current, [frame.id]: { run, applied: apply, dismissed: false } }));
      if (apply) editFrames([frame.id], () => run.plan.proposal);
    }, () => task.fail('Checking the photo failed.')).finally(() => autoInFlight.current.delete(frame.id));
    // Runs once per photo and mode; `assists` guards repeats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, assistMode, activeFrame?.id]);

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
    const task = tasks.start('Running a deep vision review');
    runDeepVisionReview(frame, provider.current!).then((result) => {
      if (!result) { task.finish('Could not run a deep review on this photo.'); setNotice('Could not run a deep review on this photo.'); return; }
      task.finish(result.summary);
      setNotice(result.summary);
    }, () => { task.fail('Deep vision review failed.'); setNotice('The deep vision review failed.'); })
      .finally(() => { deepVisionInFlight.current.delete(photoId); setReviewingIds((current) => current.filter((id) => id !== photoId)); });
  }, []);

  const importPhotos = useCallback(async (suppliedPicks?: Array<File | PickedPhoto> | null) => {
    const target = stateRef.current;
    if (!target) return;
    if (importController.current) { setNotice('Photos are already being added. Wait for them to finish, or stop that task first.'); return; }
    const picks = suppliedPicks === undefined ? await pickFiles() : suppliedPicks;
    if (!picks?.length) return;
    const files = picks.map((pick) => (pick instanceof File ? pickedFromFile(pick) : pick));
    const existing = new Set(target.frames.filter((frame) => !frame.removedAt).map((frame) => frame.stableKey));
    const additions = files.filter((file) => { const key = pickedKey(file); if (existing.has(key)) return false; existing.add(key); return true; });
    if (!additions.length) { setNotice('Those photos are already in this project.'); return; }
    const projectKey = target.shoot.id;
    const controller = new AbortController();
    importController.current = controller;
    setImporting(true);
    const task = tasks.start(`Adding ${additions.length} photo${additions.length === 1 ? '' : 's'}`, { total: additions.length, cancel: () => controller.abort() });
    const importId = newId().slice(0, 8);
    const sequenceBase = target.frames.reduce((max, frame) => Math.max(max, frame.sequenceIndex), 0);
    const appended = new Set<string>();
    let waiting: PhotoFrame[] = [];
    let lastShown = 0;
    const show = () => {
      if (!waiting.length) return;
      const batch = waiting; waiting = [];
      for (const frame of batch) appended.add(frame.stableKey);
      lastShown = Date.now();
      setState((current) => (current && current.shoot.id === projectKey ? appendProjectPhotos(current, batch, importId, { sequenceBase }) : current));
    };
    try {
      const result = await loadLocalFileListShoot(additions, provider.current!, catalogue.current!,
        ({ loaded, total }) => task.progress(loaded, total),
        { allowPartial: true, signal: controller.signal, onFrameReady: (frame) => {
          if (controller.signal.aborted) return;
          waiting.push(frame);
          if (waiting.length >= 24 || Date.now() - lastShown > 1200 || appended.size < 8) show();
        } });
      waiting = [];
      if (!result.frames.length) {
        if (result.stopped) task.finish('Stopped before any photo was added.');
        else { task.fail('None of those files could be read as photos.'); setNotice('None of those files could be read as photos. Nothing was changed.'); }
        return;
      }
      setState((current) => (current && current.shoot.id === projectKey
        ? applyImportBursts(appendProjectPhotos(current, result.frames.filter((frame) => !appended.has(frame.stableKey)), importId, { sequenceBase }), result.frames, importId)
        : current));
      task.finish(result.stopped ? `Stopped. ${result.frames.length} added.` : result.failedNames.length ? `${result.frames.length} added, ${result.failedNames.length} could not be read.` : undefined);
      const warnings: string[] = [];
      if (result.failedNames.length) warnings.push(`${result.failedNames.length} file${result.failedNames.length === 1 ? '' : 's'} could not be read: ${result.failedNames.slice(0, 3).join(', ')}.`);
      if (result.unstoredKeys.length) warnings.push('Some originals are held for this session only. Reconnect them next time you open the project.');
      if (warnings.length) setNotice(warnings.join(' '));
    } catch {
      task.fail('Adding photos failed.');
      setNotice('Adding photos failed. Your original files were not changed.');
    } finally {
      task.fail('Stopped before finishing.'); // does nothing once finished
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

  const real: Partial<WorkspaceActions> = {
    reconnectOriginal: () => reconnectOriginal(),
    openProject: (id) => { void openProject(id); },
    createProject: (name) => {
      const created = createEmptyProject(`project-${newId()}`, name.trim() || 'Untitled project');
      void catalogue.current!.saveProject(created).then(() => enterProject(created), () => setNotice('InFlight could not create the project.'));
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
      const list = (stateRef.current?.frames ?? []).filter((frame) => !frame.removedAt).map((frame) => frame.id);
      if (modifiers?.shift && activeId) {
        const a = list.indexOf(activeId), b = list.indexOf(id);
        if (a >= 0 && b >= 0) setSelected(list.slice(Math.min(a, b), Math.max(a, b) + 1));
      } else if (modifiers?.ctrl) {
        setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
      } else setSelected([id]);
      mutate((current) => ({ ...current, selectedFrameId: id }));
    },
    selectAllPhotos: () => setSelected((stateRef.current?.frames ?? []).filter((frame) => !frame.removedAt).map((frame) => frame.id)),
    clearSelection: () => setSelected(activeId ? [activeId] : []),
    setDecision: (ids, decision) => decide(ids, decision),
    removePhotos: (ids) => removePhotos(ids),
    setRemovedOpen: (open) => setRemovedOpen(open),
    restorePhotos: (ids) => {
      mutate((current) => restoreRemoved(current, ids));
    },
    toggleFlag: (ids) => mutate((current) => ids.reduce((next, id) => {
      const frame = next.frames.find((candidate) => candidate.id === id);
      return frame ? applyDecisionWithHistory(next, id, frame.decision === 'keep' ? 'unreviewed' : 'keep', { allowAdvance: false }) : next;
    }, current)),
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
    setRating: (ids, rating) => mutate((current) => ({
      ...current,
      frames: current.frames.map((frame) => (ids.includes(frame.id) ? { ...frame, rating } : frame)),
      shoot: { ...current.shoot, lastUpdatedAt: Date.now() },
    })),
    importPhotos: () => { void importPhotos(); },
    importFolder: () => { void pickFolderFiles().then((files) => { if (files?.length) void importPhotos(files); }); },
    importDroppedPhotos: (files) => { if (files.length) void importPhotos(files); },
    runAutoCull: () => { void runAutoCull(); },
    addMaskLayer: (photoId, type) => { void addMask(photoId, type); },
    toggleMaskLayer: (photoId, maskId) => editMasks(photoId, (masks) => toggleMask(masks, maskId)),
    removeMaskLayer: (photoId, maskId) => editMasks(photoId, (masks) => removeMask(masks, maskId)),
    setMaskEdit: (photoId, maskId, key, value) => editMasks(photoId, (masks) => setMaskEdit(masks, maskId, key, value)),
    setMaskFeather: (photoId, maskId, percent) => editMasks(photoId, (masks) => setMaskFeather(masks, maskId, percent)),
    runExport: (request) => { void runExportAction(request); },
    applyAssistSuggestion: (photoId) => applyAuto(photoId),
    applyAllAssistSuggestions: (photoId) => applyAuto(photoId),
    dismissAssistSuggestion: (photoId) => setAssists((current) => (current[photoId] ? { ...current, [photoId]: { ...current[photoId], dismissed: true } } : current)),
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
      mutate((current) => ({ ...current, shoot: { ...current.shoot, lastUpdatedAt: at }, frames: current.frames.map((frame) => (photoIds.includes(frame.id) ? { ...frame, overlay: overlayFromTemplate(template) } : frame)) }));
      setNotice(`Applied "${template.name}" to ${photoIds.length} photo${photoIds.length === 1 ? '' : 's'}. Undo is not available for this; apply another template or edit the overlay to change it.`);
    },
    renameOverlayTemplate: (templateId, name) => updateTemplates(renameTemplate(templates, templateId, name)),
    deleteOverlayTemplate: (templateId) => updateTemplates(deleteTemplate(templates, templateId)),
    toggleSizeEnabled: (photoId, sizeId) => changeFormats(photoId, (raw) => toggleFormat(raw, sizeId)),
    toggleSizeLinked,
    updateVideoZoom,
    toggleSplitFrames,
    setSplitPanOffset,
    addCustomSize: (photoId, label, width, height) => {
      if (!validCustomSize(width, height)) { setNotice('That size is not usable. Use whole pixels, from 1 to 20,000.'); return; }
      const id = `custom-${newId().replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 10)}`;
      if (!changeFormats(photoId, (raw) => addFormat(raw, label, width, height, id))) { setNotice('This photo already has the most formats it can hold.'); return; }
      stub.actions.setActiveSize(id);
    },
    duplicateSize: (photoId, sizeId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
      const source = applyFormats(createDefaultSizes(), frame?.formats).find((size) => size.id === sizeId);
      if (!frame || !source) return;
      const id = `custom-${newId().replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 10)}`;
      if (!changeFormats(photoId, (raw) => addFormat(raw, `${source.label} copy`, source.width, source.height, id), (crops) => { const own = readCrops(crops)[sizeId]; return own ? { ...readCrops(crops), [id]: own } : readCrops(crops); })) { setNotice('This photo already has the most formats it can hold.'); return; }
      stub.actions.setActiveSize(id);
    },
    removeSize: (photoId, sizeId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
      const remaining = applyFormats(createDefaultSizes(), frame?.formats).filter((size) => size.kind === 'photo' && size.enabled && size.id !== sizeId);
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
    addOverlayRow: (photoId) => changeOverlay(photoId, (overlay) => addRow(overlay, `row-${newId().slice(0, 8)}`)),
    updateOverlayRow: (photoId, rowId, patch) => changeOverlay(photoId, (overlay) => updateRow(overlay, rowId, patch)),
    removeOverlayRow: (photoId, rowId) => changeOverlay(photoId, (overlay) => removeRow(overlay, rowId)),
    addCustomFont: (fontName) => {
      const name = fontName.trim();
      if (!name) return;
      if (!hasDeviceFont(name)) { setNotice(`"${name}" is not installed on this device, so it was not added.`); return; }
      setDeviceFonts((current) => { const next = [...new Set([...current, name])]; saveDeviceFonts(next); return next; });
    },
    updateSettings: (patch) => setSavedUi((current) => { const next: SavedUi = { ...current, settings: { ...current.settings, ...patch } }; saveUi(next); return next; }),
    setAssistMode: (mode) => setSavedUi((current) => { const next: SavedUi = { ...current, assistMode: mode, settings: { ...current.settings, defaultAssistMode: mode } }; saveUi(next); return next; }),
    importWatermarkImage: async () => {
      const picked = await pickImageFile();
      if (!picked) return null;
      try {
        const entry = await importWatermark(picked, picked.name.replace(/\.[^.]+$/, ''), `wm-${newId().slice(0, 8)}`);
        updateWatermarks([...watermarkStore, entry]);
        return entry.id;
      } catch (error) { setNotice(error instanceof Error ? error.message : 'That image could not be added.'); return null; }
    },
    cutOutWatermark: async (presetId, slot, tolerance, commit) => {
      const entry = watermarkStore.find((candidate) => candidate.id === presetId);
      if (!entry) return null;
      const result = await cutOut(entry, slot, tolerance, commit).catch(() => null);
      if (!result) return null;
      if (commit && !result.tooMuch) updateWatermarks(watermarkStore.map((candidate) => (candidate.id === presetId ? result.entry : candidate)));
      if (result.tooMuch) setNotice('The background is not one flat colour, so it was left as it is. Try a plain background.');
      return { url: result.url, tooMuch: result.tooMuch };
    },
    makeWatermarkVariant: async (presetId, slot) => {
      const entry = watermarkStore.find((candidate) => candidate.id === presetId);
      const next = entry ? await makeVariant(entry, slot).catch(() => null) : null;
      if (next) updateWatermarks(watermarkStore.map((candidate) => (candidate.id === presetId ? next : candidate)));
      else setNotice('That version could not be made.');
    },
    deleteWatermark: (presetId) => {
      updateWatermarks(watermarkStore.filter((candidate) => candidate.id !== presetId));
      // Photos that used it fall back to the first built-in watermark; nothing else about them changes.
      mutate((current) => ({ ...current, frames: current.frames.map((frame) => { const overlay = readOverlay(frame.overlay); return overlay.watermarkPresetId === presetId ? { ...frame, overlay: { ...overlay, watermarkPresetId: INITIAL_WATERMARKS[0].id } } : frame; }) }));
    },
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
    copyRecipe: () => setClipboard(editToRecipe(activeFrame?.edit)),
    pasteRecipe: () => { if (clipboard && activeId) applyPatch(editTargets(activeId), clipboard); },
    setBurstGrouped: (burstGroupId, grouped) => mutate((current) => ({ ...current, frames: current.frames.map((frame) => (frame.burstGroupId === burstGroupId ? { ...frame, burstUngrouped: grouped ? undefined : true } : frame)) })),
    jumpToEditStep: (photoId, cursor) => mutate((current) => ({ ...current, frames: current.frames.map((frame) => (frame.id === photoId ? jumpToStep(frame, cursor) : frame)) })),
    undo: () => {
      if (activeFrame?.editHistory && activeFrame.editHistory.cursor > 0) mutate((current) => ({ ...current, frames: current.frames.map((frame) => (frame.id === activeFrame.id ? stepEdit(frame, -1) : frame)) }));
      else mutate(undoDecision);
    },
    redo: () => {
      const history = activeFrame?.editHistory;
      if (history && history.cursor < history.steps.length) mutate((current) => ({ ...current, frames: current.frames.map((frame) => (frame.id === activeFrame.id ? stepEdit(frame, 1) : frame)) }));
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

  exportEnv.current = { fonts: mergeFonts(deviceFonts), presets: [...INITIAL_WATERMARKS, ...watermarkLibrary], auto: watermarkAuto, textAllowed: featureAccess(can).overlayText, markAllowed: featureAccess(can).watermarkCustom };
  const photos = useMemo(() => (state?.frames ?? []).filter((frame) => !frame.removedAt).map((frame) => frameToPhoto(frame, urls[frame.id], { assist: assists[frame.id], watermarkAuto: watermarkAuto[frame.id], histogram: histograms[frame.id], pixelSize: pixelSizes[frame.id], verifiedOriginalSize: verifiedRasterSizes[`${frame.stableKey}|${frame.originalSha256 ?? ''}`], originalConnected: frame.sourceKind === 'file' && !isDesktopApp() ? provider.current?.hasBlob(frame.stableKey) === true : !urls[frame.id]?.failed })), [state?.frames, urls, assists, watermarkAuto, histograms, pixelSizes, verifiedRasterSizes]);
  // Photos moved to Trash: browsable and restorable from the Removed panel without walking back through Undo
  // (ROADMAP.md, "Removed photos panel" next item). Thumbnails are not fetched for them; the filename is enough
  // to recognise one in a short list, and restoring returns it to the normal, already-thumbnailed photo list.
  const removedPhotos = useMemo(() => removedFrames(state?.frames ?? []).map((frame) => frameToPhoto(frame, urls[frame.id], {})), [state?.frames, urls]);
  const store: WorkspaceStore = useMemo(() => ({
    ...stub.store,
    fonts: mergeFonts(deviceFonts),
    settings: mergeSettings(stub.store.settings, savedUi.settings),
    assistMode: savedUi.assistMode ?? stub.store.assistMode,
    watermarkPresets: [...INITIAL_WATERMARKS, ...watermarkLibrary],
    overlayTemplates: templates.map(({ id, name }) => ({ id, name })),
    features: featureAccess(can),
    featurePlan: featurePlan(),
    screen, hubState, projects,
    activeProjectId: state?.shoot.id ?? null,
    photos,
    removedPhotos,
    removedOpen,
    activePhotoId: activeId,
    selectedPhotoIds: selected,
    reviewingPhotoIds: reviewingIds,
    tasks: visibleTasks(taskList.filter((task) => task.state === 'running').map(taskToInfo), Object.values(taskHistory), clock),
    canUndo: Boolean(state?.undoStack.length) || (activeFrame?.editHistory?.cursor ?? 0) > 0,
    canRedo: Boolean(state?.redoStack.length) || (activeFrame?.editHistory ? activeFrame.editHistory.cursor < activeFrame.editHistory.steps.length : false),
    clipboardRecipe: clipboard,
    PhotoSurface: EngineSurface,
    lastActionNotice: notice ?? stub.store.lastActionNotice,
  }), [stub.store, can, savedUi, deviceFonts, watermarkLibrary, templates, screen, hubState, projects, state?.shoot.id, state?.undoStack.length, state?.redoStack.length, activeFrame, clipboard, photos, removedPhotos, removedOpen, activeId, selected, taskList, taskHistory, clock, notice]);

  return { store, actions };
}
