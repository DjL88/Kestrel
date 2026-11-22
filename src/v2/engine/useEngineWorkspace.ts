import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { applyDecisionWithHistory, redoDecision, undoDecision } from '../../core/cullingEngine';
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
import { isDesktopApp } from '../../providers/desktopShell';
import { pickedFromFile, pickedKey, pickPhotosNatively, type PickedPhoto } from '../../providers/linkedOriginals';
import { loadLocalFileListShoot } from '../../providers/localShootLoader';
import type { EditRecipe, HubViewState, Project, WorkspaceActions, WorkspaceStore } from '../ui/contract';
import { useWorkspace } from '../ui/stub';
import { EngineSurface } from './EngineSurface';
import { frameToPhoto, shootToProject, taskToInfo, type AssistState, type FrameUrls } from './frameToPhoto';
import { runAuto } from './runAuto';
import { applyRecipePatch, editToRecipe } from './recipeMap';
import { surfaceBridge } from './surfaceBridge';

/** Actions that change a photo's edit, sizes, overlay, masks or assist state. They are not connected to the real
 * recipe yet, so they say so instead of silently changing sample data. */
const NOT_CONNECTED = [
  'setActiveGroup', 'addEditGroup', 'renameEditGroup', 'toggleSizeEnabled', 'toggleSizeLinked', 'updateSizeCrop',
  'flipSelectedSizes', 'rotateSelectedSizes', 'resetSizeCrop', 'addCustomSize', 'toggleSplitFrames', 'setSplitPanOffset',
  'updateVideoZoom', 'updateOverlay', 'alignOverlaysCleanly', 'addOverlayRow', 'updateOverlayRow', 'removeOverlayRow',
  'addCustomFont', 'addMaskLayer', 'toggleMaskLayer', 'removeMaskLayer', 'runAutoCull', 'runDeepVisionReview',
  'runExport', 'reconnectOriginal',
] as const satisfies readonly (keyof WorkspaceActions)[];

const THUMBNAIL_WORKERS = 4;

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
 * selection, the Adjust recipe (sliders, Looks, reset, copy and paste, with edit undo and redo) and the canvas renderer. Everything else keeps the UI's own layout state; edit-type actions say they are not
 * connected yet (NOT_CONNECTED). Originals are never written.
 */
export function useEngineWorkspace(): { store: WorkspaceStore; actions: WorkspaceActions } {
  const stub = useWorkspace();
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
  const [assists, setAssists] = useState<Record<string, AssistState>>({});
  const autoInFlight = useRef(new Set<string>());
  const stateRef = useRef<CullingState | null>(null);
  stateRef.current = state;
  useEffect(() => { surfaceBridge.set(state?.frames ?? [], provider.current); }, [state?.frames]);
  const importController = useRef<AbortController | null>(null);
  const taskList = useSyncExternalStore(tasks.subscribe, tasks.list, tasks.list);

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
    setUrls({});
    setAssists({});
    setSelected(next.selectedFrameId ? [next.selectedFrameId] : []);
    setState(next);
    setScreen('editor');
  }, []);

  // Thumbnails: a few at a time, so a large project does not start thousands of reads at once.
  const projectId = state?.shoot.id;
  const frameCount = state?.frames.length ?? 0;
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    const pending = (stateRef.current?.frames ?? []).filter((frame) => !frame.removedAt && !urls[frame.id]);
    const queue = [...pending];
    const worker = async () => {
      for (let frame = queue.shift(); frame && live; frame = queue.shift()) {
        try {
          const thumb = await provider.current!.getThumbnailUrl(frame, 'visible');
          if (live) setUrls((current) => (current[frame.id] ? current : { ...current, [frame.id]: { thumb } }));
        } catch {
          if (live) setUrls((current) => ({ ...current, [frame.id]: { failed: true } }));
        }
      }
    };
    for (let i = 0; i < Math.min(THUMBNAIL_WORKERS, queue.length); i += 1) void worker();
    return () => { live = false; };
    // urls is read once per run on purpose: new frames re-run it through frameCount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, frameCount]);

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
    applyAssistSuggestion: (photoId) => applyAuto(photoId),
    applyAllAssistSuggestions: (photoId) => applyAuto(photoId),
    dismissAssistSuggestion: (photoId) => setAssists((current) => (current[photoId] ? { ...current, [photoId]: { ...current[photoId], dismissed: true } } : current)),
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
    clearNotice: () => { setNotice(null); stub.actions.clearNotice(); },
  };
  const unconnected = Object.fromEntries(NOT_CONNECTED.map((name) => [name, () => setNotice('That is not connected to the InFlight engine yet. Your photos and originals are unchanged.')])) as Partial<WorkspaceActions>;
  const actions = useMemo(() => ({ ...stub.actions, ...unconnected, ...real }) as WorkspaceActions,
    // `real` and `unconnected` are rebuilt each render and only close over stable refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stub.actions, stub.store.looks, applyAuto, activeId, activeFrame, clipboard, selected, applyPatch, editFrames, enterProject, backToProjects, decide, importPhotos, loadHub]);

  const photos = useMemo(() => (state?.frames ?? []).filter((frame) => !frame.removedAt).map((frame) => frameToPhoto(frame, urls[frame.id], assists[frame.id])), [state?.frames, urls, assists]);
  const store: WorkspaceStore = useMemo(() => ({
    ...stub.store,
    screen, hubState, projects,
    activeProjectId: state?.shoot.id ?? null,
    photos,
    activePhotoId: activeId,
    selectedPhotoIds: selected,
    tasks: taskList.map(taskToInfo),
    canUndo: Boolean(state?.undoStack.length) || (activeFrame?.editHistory?.cursor ?? 0) > 0,
    canRedo: Boolean(state?.redoStack.length) || (activeFrame?.editHistory ? activeFrame.editHistory.cursor < activeFrame.editHistory.steps.length : false),
    clipboardRecipe: clipboard,
    PhotoSurface: EngineSurface,
    lastActionNotice: notice ?? stub.store.lastActionNotice,
  }), [stub.store, screen, hubState, projects, state?.shoot.id, state?.undoStack.length, state?.redoStack.length, activeFrame, clipboard, photos, activeId, selected, taskList, notice]);

  return { store, actions };
}
