import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { applyCullConfidence, applyDecisionWithHistory, redoDecision, undoDecision } from '../../core/cullingEngine';
import { recordEdit, stepEdit } from '../../core/editHistory';
import { isEmptyEdit, DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import { sameRecipe } from '../../core/naturalAuto';
import { newId } from '../../core/ids';
import { PHOTO_ACCEPT } from '../../core/rawFormats';
import { appendProjectPhotos, applyImportBursts, createEmptyProject } from '../../core/projects';
import { tasks } from '../../core/taskStore';
import type { CullDecision, CullingState, PhotoFrame, ShootDescriptor } from '../../core/types';
import { BrowserCatalogueStore } from '../../providers/browserCatalogueStore';
import { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { scanForCulling } from '../../providers/browserAutoCull';
import { useAccess } from '../../providers/useAccess';
import { useBackgroundDevelop } from '../../useBackgroundDevelop';
import { useSpeciesScan } from '../../useSpeciesScan';
import { isDesktopApp } from '../../providers/desktopShell';
import { pickedFromFile, pickedKey, pickPhotosNatively, type PickedPhoto } from '../../providers/linkedOriginals';
import { loadLocalFileListShoot } from '../../providers/localShootLoader';
import type { EditRecipe, HubViewState, OverlaySettings, WatermarkPreset, Project, TaskInfo, WorkspaceActions, WorkspaceStore } from '../ui/contract';
import { useWorkspace } from '../ui/stub';
import { EngineSurface } from './EngineSurface';
import { featureAccess, featurePlan } from './featureMap';
import { hasDeviceFont, listDeviceFonts, loadSavedDeviceFonts, mergeFonts, saveDeviceFonts } from './fonts';
import { assetUrl, cutOut, importWatermark, loadStored, makeVariant, saveStored, toPresets, type StoredWatermark } from './watermarkLibrary';
import { watermarkToneForPixels } from '../../core/watermark';
import { INITIAL_WATERMARKS } from '../ui/stub';
import { addRow, alignOverlays, patchOverlay, readOverlay, removeRow, updateRow } from './overlayOps';
import { frameToPhoto, shootToProject, taskToInfo, visibleTasks, type AssistState, type FrameUrls } from './frameToPhoto';
import { runAuto } from './runAuto';
import { runDeepVisionReview } from './deepVisionReview';
import { applyRecipePatch, editToRecipe } from './recipeMap';
import { surfaceBridge } from './surfaceBridge';

/** Actions that change a photo's edit, sizes, overlay, masks or assist state. They are not connected to the real
 * recipe yet, so they say so instead of silently changing sample data. */
const NOT_CONNECTED = [
  'setActiveGroup', 'addEditGroup', 'renameEditGroup', 'toggleSizeEnabled', 'toggleSizeLinked', 'updateSizeCrop',
  'flipSelectedSizes', 'rotateSelectedSizes', 'resetSizeCrop', 'addCustomSize', 'toggleSplitFrames', 'setSplitPanOffset',
  'updateVideoZoom', 'addMaskLayer', 'toggleMaskLayer', 'removeMaskLayer',
  'runExport', 'reconnectOriginal',
] as const satisfies readonly (keyof WorkspaceActions)[];

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
  const [watermarkAuto, setWatermarkAuto] = useState<Record<string, 'light-on-dark' | 'dark-on-light'>>({});
  useEffect(() => { let live = true; void toPresets(watermarkStore).then((presets) => { if (live) setWatermarkLibrary(presets); }); return () => { live = false; }; }, [watermarkStore]);
  const updateWatermarks = useCallback((next: StoredWatermark[]) => { setWatermarkStore(next); saveStored(next); }, []);
  const [assists, setAssists] = useState<Record<string, AssistState>>({});
  const autoInFlight = useRef(new Set<string>());
  const cullController = useRef<AbortController | null>(null);
  const [importing, setImporting] = useState(false);
  const stateRef = useRef<CullingState | null>(null);
  stateRef.current = state;
  useEffect(() => { surfaceBridge.set(state?.frames ?? [], provider.current); }, [state?.frames]);
  const importController = useRef<AbortController | null>(null);
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

  const loadHub = useCallback(async () => {
    setHubState('loading');
    try {
      const store = catalogue.current!;
      const shoots = (await store.listProjects()).filter((shoot: ShootDescriptor) => !shoot.archivedAt && !shoot.inbox);
      const loaded = await Promise.all(shoots.map(async (shoot) => shootToProject(shoot, (await store.loadProject(shoot.id))?.frames ?? [])));
      setProjects(loaded);
      setHubState(loaded.length ? 'ready' : 'empty');
    } catch {
      setHubState('error');
    }
  }, []);
  useEffect(() => { void loadHub(); }, [loadHub]);

  // Save the open project whenever it changes, exactly as the current app does.
  useEffect(() => {
    if (!state || screen !== 'editor') return;
    void catalogue.current!.saveProject(state).catch(() => setNotice('InFlight could not save this project. Your original photos are unchanged.'));
  }, [state, screen]);

  const enterProject = useCallback((next: CullingState) => {
    provider.current!.clear();
    thumbs.current = { generation: thumbs.current.generation + 1, requested: new Set(), queue: [], active: 0 };
    setUrls({});
    setAssists({});
    setSelected(next.selectedFrameId ? [next.selectedFrameId] : []);
    setState(next);
    setScreen('editor');
  }, []);

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

  const activeFrame = state?.frames.find((frame) => frame.id === activeId) ?? null;
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
  const runDeepVisionReviewAction = useCallback((photoId: string) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    if (!frame || deepVisionInFlight.current.has(photoId)) return;
    deepVisionInFlight.current.add(photoId);
    const task = tasks.start('Running a deep vision review');
    runDeepVisionReview(frame, provider.current!).then((result) => {
      if (!result) { task.finish('Could not run a deep review on this photo.'); setNotice('Could not run a deep review on this photo.'); return; }
      task.finish(result.summary);
      setNotice(result.summary);
    }, () => { task.fail('Deep vision review failed.'); setNotice('The deep vision review failed.'); })
      .finally(() => deepVisionInFlight.current.delete(photoId));
  }, []);

  const importPhotos = useCallback(async () => {
    const target = stateRef.current;
    if (!target) return;
    if (importController.current) { setNotice('Photos are already being added. Wait for them to finish, or stop that task first.'); return; }
    const picks = await pickFiles();
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

  const backToProjects = useCallback(async () => {
    const current = stateRef.current;
    if (current) { try { await catalogue.current!.saveProject(current); } catch { /* the save effect already reported it */ } }
    setState(null); setScreen('hub'); setSelected([]);
    await loadHub();
  }, [loadHub]);

  const real: Partial<WorkspaceActions> = {
    openProject: (id) => { void catalogue.current!.loadProject(id).then((loaded) => { if (loaded) enterProject(loaded); else setNotice('That project could not be opened.'); }); },
    createProject: (name) => {
      const created = createEmptyProject(`project-${newId()}`, name.trim() || 'Untitled project');
      void catalogue.current!.saveProject(created).then(() => enterProject(created), () => setNotice('InFlight could not create the project.'));
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
    toggleFlag: (ids) => mutate((current) => ids.reduce((next, id) => {
      const frame = next.frames.find((candidate) => candidate.id === id);
      return frame ? applyDecisionWithHistory(next, id, frame.decision === 'keep' ? 'unreviewed' : 'keep', { allowAdvance: false }) : next;
    }, current)),
    setRating: (ids, rating) => mutate((current) => ({
      ...current,
      frames: current.frames.map((frame) => (ids.includes(frame.id) ? { ...frame, rating } : frame)),
      shoot: { ...current.shoot, lastUpdatedAt: Date.now() },
    })),
    importPhotos: () => { void importPhotos(); },
    runAutoCull: () => { void runAutoCull(); },
    applyAssistSuggestion: (photoId) => applyAuto(photoId),
    applyAllAssistSuggestions: (photoId) => applyAuto(photoId),
    dismissAssistSuggestion: (photoId) => setAssists((current) => (current[photoId] ? { ...current, [photoId]: { ...current[photoId], dismissed: true } } : current)),
    runDeepVisionReview: (photoId) => runDeepVisionReviewAction(photoId),
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
    applyLook: (photoId, lookId) => {
      const look = stub.store.looks.find((entry) => entry.id === lookId);
      if (look) applyPatch(editTargets(photoId), look.recipeDelta);
    },
    resetPhotoEdits: (photoId) => editFrames(editTargets(photoId), () => undefined),
    copyRecipe: () => setClipboard(editToRecipe(activeFrame?.edit)),
    pasteRecipe: () => { if (clipboard && activeId) applyPatch(editTargets(activeId), clipboard); },
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
    [stub.actions, stub.store.looks, applyAuto, changeOverlay, runAutoCull, runDeepVisionReviewAction, activeId, activeFrame, clipboard, selected, applyPatch, editFrames, enterProject, backToProjects, decide, importPhotos, loadHub]);

  const photos = useMemo(() => (state?.frames ?? []).filter((frame) => !frame.removedAt).map((frame) => frameToPhoto(frame, urls[frame.id], assists[frame.id], watermarkAuto[frame.id])), [state?.frames, urls, assists, watermarkAuto]);
  const store: WorkspaceStore = useMemo(() => ({
    ...stub.store,
    fonts: mergeFonts(deviceFonts),
    watermarkPresets: [...INITIAL_WATERMARKS, ...watermarkLibrary],
    features: featureAccess(can),
    featurePlan: featurePlan(),
    screen, hubState, projects,
    activeProjectId: state?.shoot.id ?? null,
    photos,
    activePhotoId: activeId,
    selectedPhotoIds: selected,
    tasks: visibleTasks(taskList.filter((task) => task.state === 'running').map(taskToInfo), Object.values(taskHistory), clock),
    canUndo: Boolean(state?.undoStack.length) || (activeFrame?.editHistory?.cursor ?? 0) > 0,
    canRedo: Boolean(state?.redoStack.length) || (activeFrame?.editHistory ? activeFrame.editHistory.cursor < activeFrame.editHistory.steps.length : false),
    clipboardRecipe: clipboard,
    PhotoSurface: EngineSurface,
    lastActionNotice: notice ?? stub.store.lastActionNotice,
  }), [stub.store, can, deviceFonts, watermarkLibrary, screen, hubState, projects, state?.shoot.id, state?.undoStack.length, state?.redoStack.length, activeFrame, clipboard, photos, activeId, selected, taskList, taskHistory, clock, notice]);

  return { store, actions };
}
