import { splitDropped } from './core/dropSplit';
import { useAccess } from './providers/useAccess';
import { loadLicence } from './providers/licenceStore';
import { PaidNotice } from './components/PaidNotice';
import { SyncFolderDialog } from './components/SyncFolderDialog';
import { PHOTO_ACCEPT } from './core/rawFormats';
import { DropOverlay } from './components/DropOverlay';
import { useDropPhotos } from './providers/useDropPhotos';
import { DesktopUpdate } from './components/DesktopUpdate';
import { useDesktopMenu } from './providers/useDesktopMenu';
import { OnlineHelperDialog } from './components/OnlineHelperDialog';
import { useSpeciesScan } from './useSpeciesScan';
import { SpeciesScanBanner } from './components/SpeciesScanBanner';
import type { SubjectKind } from './core/subjectTags';
import { applyAutoTag, keepAuto, mayAutoTag, reconcileAuto } from './core/autoTags';
import { burstMates, tagFrames } from './core/speciesBurst';
import { Copy, ClipboardPaste, Pin, PinOff } from 'lucide-react';
import { newId } from './core/ids';
import { redoLabel, undoLabel } from './core/describeAction';
import { jumpToStep, recordEdit, stepEdit } from './core/editHistory';
import { AutoCullPanel } from './components/AutoCullPanel';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { restoreProjectBackup } from './core/projectBackup';
import { saveProjectBackupFile } from './providers/projectBackupFile';
import { ProjectList } from './components/ProjectList';
import { INBOX_ID, appendProjectPhotos, createEmptyProject, createInboxProject, moveFrames, setArchived } from './core/projects';
import { MoveToProjectDialog } from './components/MoveToProjectDialog';
import { ProjectActionDialog } from './components/ProjectActionDialog';
import { createVirtualCopy } from './core/virtualCopies';
import { PhotoExportPanel } from './components/PhotoExportPanel';
import { PhotoEditor } from './components/PhotoEditor';
import type { PhotoFraming } from './core/photoFraming';
import { LEGACY_SETTINGS, type ProjectSettings } from './core/projectSettings';
import { DEFAULT_EDIT, isEmptyEdit, type PhotoEdit } from './core/photoEdits';
import { CompareView } from './components/CompareView';
import { ExifInspector } from './components/ExifInspector';
import { Filmstrip } from './components/Filmstrip';
import { isEdited } from './core/editedState';
import { ConfirmDialog } from './components/ConfirmDialog';
import { RemovedPhotosPanel } from './components/RemovedPhotosPanel';
import { FolderRegrantBanner } from './components/FolderRegrantBanner';
import { LoupePreview } from './components/LoupePreview';
import { MacroPadModal } from './components/MacroPadModal';
import { OpenShootModal } from './components/OpenShootModal';
import { TopWorkspaceBar } from './components/TopWorkspaceBar';
import { VirtualizedContactSheet } from './components/VirtualizedContactSheet';
import {
  DEFAULT_KEEPER_TARGET,
  applyDecisionWithHistory,
  removeFromLibrary,
  removedFrames,
  restoreRemoved,
  computeCullCounts,
  createDemoShootState,
  filterFrames,
  getDefaultComparePair,
  redoDecision,
  stepSelection,
  undoDecision,
  applyAutoCullDecisions,
} from './core/cullingEngine';
import {
  DEFAULT_KEY_BINDINGS,
  resolveKeyboardCommand,
  type CommandId,
  type KnobFunction,
} from './core/keyboardCommands';
import type {
  CullDecision,
  CullingState,
  FilterState,
  PhotoFrame,
  WorkspaceViewMode,
  ShootDescriptor,
} from './core/types';
import {
  BrowserCatalogueStore,
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  type UserPreferences,
} from './providers/browserCatalogueStore';
import { BrowserPreviewProvider } from './providers/browserPreviewProvider';
import {
  getLocalFileKey,
  loadLocalFileListShoot,
  readFilesFromDirectoryHandle,
  rehydrateLocalFramesFromStore,
} from './providers/localShootLoader';

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

export default function App() {
  const { can } = useAccess();
  const [syncOpen, setSyncOpen] = useState(false);
  useEffect(() => { void loadLicence(); }, []);
  const [paidDialog, setPaidDialog] = useState<string | null>(null);
  useDesktopMenu();
  const storeRef = useRef<BrowserCatalogueStore | null>(null);
  if (!storeRef.current) storeRef.current = new BrowserCatalogueStore();

  const relinkInput = useRef<HTMLInputElement>(null);
  const relinkingFiles = useRef(false);
  const previewProviderRef = useRef<BrowserPreviewProvider | null>(null);
  if (!previewProviderRef.current) previewProviderRef.current = new BrowserPreviewProvider();

  const [prefs, setPrefs] = useState<UserPreferences>(() => loadPreferences());
  const [cullingState, setCullingState] = useState<CullingState>(() =>
    createEmptyProject('uninitialised', '')
  );
  const [editing, setEditing] = useState(false);
  const [autoCullOpen, setAutoCullOpen] = useState(false);
  const [autoCullStart, setAutoCullStart] = useState(false);
  const [exportFrames, setExportFrames] = useState<PhotoFrame[]>([]);
  const [showPhotoInfo, setShowPhotoInfo] = useState(false);
  const [copiedEdit, setCopiedEdit] = useState<PhotoEdit | null>(null);
  const [batchUndo, setBatchUndo] = useState<{
    applied: PhotoEdit;
    previous: ReadonlyMap<string, PhotoEdit | undefined>;
  } | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [projects, setProjects] = useState<ShootDescriptor[]>([]);
  const [photoText, setPhotoText] = useState<Record<string, string>>({});
  const [projectBusy, setProjectBusy] = useState(true);
  const [projectError, setProjectError] = useState<string>();
  const [backupNotice, setBackupNotice] = useState<string>();
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [infoFrameId, setInfoFrameId] = useState<string>();
  const infoTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Viewport zoom/pan state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  // Modals & status
  const [openShootModal, setOpenShootModal] = useState(false);
  const [macroPadModal, setMacroPadModal] = useState(false);
  const [macroPadMode, setMacroPadMode] = useState<'cull' | 'edit'>('cull');
  const [folderError, setFolderError] = useState<string | null>(null);
  const [relinkStatus, setRelinkStatus] = useState<string>();
  const [previewRevision, setPreviewRevision] = useState(0);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<{
    loaded: number;
    total: number;
  } | null>(null);

  // Persist user preferences whenever they change
  useEffect(() => {
    savePreferences(prefs);
  }, [prefs]);

  useEffect(() => {
    let active = true;
    const store = storeRef.current!;
    async function initialiseProjects() {
      try {
        const saved = await store.listProjects();
        if (!active) return;
        if (saved.length) {
          setProjects(saved);
          return;
        }
        const legacy = await store.loadActiveState();
        if (!active) return;
        if (legacy?.shoot && Array.isArray(legacy.frames)) {
          await store.saveProject({ ...createDemoShootState(0), ...legacy, shoot: legacy.shoot, frames: legacy.frames });
          if (active) setProjects(await store.listProjects());
        }
      } catch {
        if (active) setProjectError('Could not open the local project catalogue. Reload to try again.');
      } finally {
        if (active) setProjectBusy(false);
      }
    }
    void initialiseProjects();
    return () => { active = false; };
  }, []);
  // The home page search also looks inside projects, so rebuild what it can search whenever the list changes.
  useEffect(() => {
    if (!projectsOpen || !storeRef.current) return;
    let current = true;
    storeRef.current.searchIndex().then((index) => { if (current) setPhotoText(index); }, () => { /* search falls back to titles only */ });
    return () => { current = false; };
  }, [projects, projectsOpen]);

  useEffect(() => {
    if (projectsOpen) return;
    void storeRef.current!.saveProject(cullingState).catch(() => {
      setProjectError('Project changes could not be saved. Check available browser storage.');
    });
  }, [cullingState, projectsOpen]);

  function enterProject(state: CullingState) {
    const filter = state.filter === 'all' ? 'unreviewed' : state.filter;
    const visible = filterFrames(state.frames, filter, state.searchQuery, state.ratingFilter);
    setBackupNotice(undefined);
    setCullingState({
      ...state,
      filter,
      selectedFrameId: visible.find((frame) => frame.id === state.selectedFrameId)?.id ?? visible[0]?.id ?? null,
    });
    setEditing(false);
    setInfoFrameId(undefined);
    setShowPhotoInfo(false);
    setMultiSelect(false);
    setSelectedIds(new Set());
    setBatchUndo(null);
    setRelinkStatus(undefined);
    setFolderError(null);
    setBannerDismissed(false);
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
    setPrefs((prev) => ({ ...prev, viewMode: 'grid' }));
    setProjectsOpen(false);
  }

  async function openProject(id: string) {
    const store = storeRef.current!;
    const preview = previewProviderRef.current!;
    setProjectBusy(true);
    setProjectError(undefined);
    try {
      const state = await store.loadProject(id);
      if (!state) throw new Error('Project unavailable');
      preview.clear();
      const shoot = { ...state.shoot };
      const localFrames = state.frames.filter((frame) => frame.sourceKind === 'file');
      shoot.needsFileReselect = !await rehydrateLocalFramesFromStore(localFrames, preview, store);

      const hasFolderFrames = state.frames.some((frame) => frame.sourceKind === 'directory-handle');
      if (hasFolderFrames) {
        const handle = await store.loadDirectoryHandle(shoot.id);
        try {
          const permission = await (handle as (FileSystemDirectoryHandle & {
            queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState>;
          }) | null)?.queryPermission?.({ mode: 'read' });
          if (handle && permission === 'granted') {
            const entries = await readFilesFromDirectoryHandle(handle);
            for (const entry of entries) preview.registerBlob(`folder://${entry.relativePath}`, entry.file);
          }
        } catch {
          // Keep the project available for catalogue editing until the source is reconnected.
        }
        shoot.needsFolderRegrant = state.frames.some((frame) =>
          frame.sourceKind === 'directory-handle' && !preview.hasBlob(frame.stableKey)
        );
      }
      enterProject({ ...state, shoot });
    } catch {
      setProjectError('Could not open this project. Try again.');
    } finally {
      setProjectBusy(false);
    }
  }

  const [projectAction, setProjectAction] = useState<{ kind: 'archive' | 'delete'; project: ShootDescriptor } | null>(null);

  async function refreshProjects() {
    setProjects(await storeRef.current!.listProjects());
  }

  async function confirmProjectAction() {
    const action = projectAction;
    setProjectAction(null);
    if (!action) return;
    setProjectBusy(true);
    setProjectError(undefined);
    try {
      const store = storeRef.current!;
      if (action.kind === 'delete') await store.deleteProject(action.project.id);
      else {
        const state = await store.loadProject(action.project.id);
        if (state) await store.saveProject(setArchived(state, Date.now()));
      }
      await refreshProjects();
    } catch {
      setProjectError(action.kind === 'delete' ? 'Could not delete the project. Nothing was changed.' : 'Could not archive the project. Nothing was changed.');
    } finally {
      setProjectBusy(false);
    }
  }

  async function unarchiveProject(id: string) {
    setProjectBusy(true);
    setProjectError(undefined);
    try {
      const store = storeRef.current!;
      const state = await store.loadProject(id);
      if (state) await store.saveProject(setArchived(state, undefined));
      await refreshProjects();
    } catch {
      setProjectError('Could not restore the project.');
    } finally {
      setProjectBusy(false);
    }
  }

  async function backUpProject(id: string) {
    const state = await storeRef.current!.loadProject(id);
    if (!state) throw new Error('Project not found');
    return saveProjectBackupFile(state);
  }

  async function newProject(name: string, options?: { keeperTarget: number; settings: ProjectSettings }) {
    setProjectBusy(true);
    setProjectError(undefined);
    try {
      const state = createEmptyProject(`project-${newId()}`, name, options);
      await storeRef.current!.saveProject(state);
      previewProviderRef.current!.clear();
      enterProject(state);
    } catch {
      setProjectError('Could not create the project. Check available browser storage.');
    } finally {
      setProjectBusy(false);
    }
  }

  async function restoreBackup(file: File) {
    const store = storeRef.current!;
    setProjectBusy(true);
    setProjectError(undefined);
    try {
      const state = restoreProjectBackup(await file.text(), `project-${newId()}`);
      await store.saveProject(state);
      await openProject(state.shoot.id);
    } catch (reason) {
      setProjectError(reason instanceof Error ? reason.message : 'Could not restore this project backup.');
    } finally {
      setProjectBusy(false);
    }
  }

  async function backupProject() {
    setProjectError(undefined);
    setBackupNotice(undefined);
    try {
      const result = await saveProjectBackupFile(cullingState);
      if (result !== 'cancelled') setBackupNotice(result === 'saved' ?
        'Catalogue backup saved. Keep the original photos separately.' :
        'Catalogue backup downloaded. Keep the original photos separately.');
    } catch {
      setProjectError('Could not save the catalogue backup. Try another destination.');
    }
  }

  async function backToProjects() {
    const store = storeRef.current!;
    setProjectBusy(true);
    setProjectError(undefined);
    try {
      await store.saveProject(cullingState);
      setProjects(await store.listProjects());
      setProjectsOpen(true);
    } catch {
      setProjectError('Could not save the project. Keep this tab open and retry after freeing storage.');
    } finally {
      setProjectBusy(false);
    }
  }

  const liveFrames = useMemo(() => cullingState.frames.filter((frame) => !frame.removedAt), [cullingState.frames]);
  const counts = useMemo(
    () => computeCullCounts(cullingState.frames),
    [cullingState.frames]
  );

  const visibleFrames = useMemo(
    () =>
      filterFrames(
        cullingState.frames,
        cullingState.filter,
        cullingState.searchQuery,
        cullingState.ratingFilter
      ),
    [cullingState.frames, cullingState.filter, cullingState.searchQuery, cullingState.ratingFilter]
  );

  const selectedFrame: PhotoFrame | null = useMemo(() => {
    if (!cullingState.selectedFrameId) return visibleFrames[0] ?? null;
    return (
      cullingState.frames.find((f) => f.id === cullingState.selectedFrameId) ??
      visibleFrames[0] ??
      null
    );
  }, [cullingState.frames, cullingState.selectedFrameId, visibleFrames]);

  const compareRightFrame: PhotoFrame | null = useMemo(() => {
    if (cullingState.compareRightFrameId) {
      const found = cullingState.frames.find(
        (f) => f.id === cullingState.compareRightFrameId
      );
      if (found) return found;
    }
    const pair = getDefaultComparePair(
      visibleFrames.length > 0 ? visibleFrames : liveFrames,
      selectedFrame?.id ?? null
    );
    return (
      cullingState.frames.find((f) => f.id === pair.rightId) ??
      selectedFrame ??
      null
    );
  }, [
    cullingState.compareRightFrameId,
    cullingState.frames,
    visibleFrames,
    selectedFrame,
  ]);

  const selectedVisibleIndex = useMemo(() => {
    if (!selectedFrame) return -1;
    return visibleFrames.findIndex((f) => f.id === selectedFrame.id);
  }, [visibleFrames, selectedFrame]);

  const handleSelectFrame = useCallback((frameId: string) => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
    setCullingState((prev) => ({
      ...prev,
      selectedFrameId: frameId,
    }));
  }, []);

  function selectGridPhoto(id: string, modifiers: { shift: boolean; toggle: boolean }) {
    if (multiSelect || modifiers.shift || modifiers.toggle) {
      setMultiSelect(true);
      setSelectedIds((previous) => {
        const next = new Set(previous);
        const target = visibleFrames.findIndex((frame) => frame.id === id);
        if (modifiers.shift && selectedVisibleIndex >= 0 && target >= 0) {
          const start = Math.min(selectedVisibleIndex, target);
          const end = Math.max(selectedVisibleIndex, target);
          for (const frame of visibleFrames.slice(start, end + 1)) next.add(frame.id);
        } else if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    }
    handleSelectFrame(id);
  }

  function rateOrFlagPhotos(id: string, change: { rating: number } | { flag: CullDecision }) {
    const targets = multiSelect && selectedIds.has(id) ? selectedIds : new Set([id]);
    if ('rating' in change) {
      setCullingState((previous) => ({
        ...previous,
        frames: previous.frames.map((frame) => targets.has(frame.id) ? { ...frame, rating: change.rating } : frame),
        shoot: { ...previous.shoot, lastUpdatedAt: Date.now() },
      }));
    } else {
      const keepers = [...targets].filter((frameId) => stateRef.current.frames.find((frame) => frame.id === frameId)?.decision === 'keep');
      if (change.flag === 'reject' && keepers.length) {
        setPendingAction({ kind: 'trash', frameIds: [...targets], allowAdvance: false });
        return;
      }
      setCullingState((previous) => [...targets].reduce((state, frameId) =>
        applyDecisionWithHistory(state, frameId, change.flag, { allowAdvance: false }), previous));
    }
  }

  const handleStepFrame = useCallback(
    (delta: number) => {
      setZoomLevel(1);
      setPanOffset({ x: 0, y: 0 });
      setCullingState((prev) => {
        const currentVisible = filterFrames(prev.frames, prev.filter, prev.searchQuery, prev.ratingFilter);
        const nextId = stepSelection(currentVisible, prev.selectedFrameId, delta);
        if (!nextId || nextId === prev.selectedFrameId) return prev;
        return {
          ...prev,
          selectedFrameId: nextId,
        };
      });
    },
    []
  );

  // Moving a Keeper to Trash, or removing a photo from Trash, asks first. Both are reversible and never touch the file.
  // Header Export uses the selection: the ticked photos in selection mode, otherwise the current photo.
  const exportSelection = useMemo(
    () => multiSelect && selectedIds.size ? liveFrames.filter((frame) => selectedIds.has(frame.id)) : selectedFrame ? [selectedFrame] : [],
    [multiSelect, selectedIds, liveFrames, selectedFrame]
  );
  const [moveOpen, setMoveOpen] = useState(false);
  const [toast, setToast] = useState('');
  const moveIds = multiSelect && selectedIds.size ? [...selectedIds] : selectedFrame ? [selectedFrame.id] : [];
  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? '' : current)), 6000);
  };

  async function moveSelectionTo(targetId: string) {
    setMoveOpen(false);
    try {
      const store = storeRef.current!;
      const target = await store.loadProject(targetId);
      if (!target) throw new Error('Project unavailable');
      const result = moveFrames(cullingState, target, moveIds, newId().slice(0, 8));
      if (!result.moved) {
        showToast(result.skipped ? 'Nothing moved: those photos are already in that project.' : 'Nothing to move.');
        return;
      }
      await store.saveProjects([result.source, result.target]);
      setCullingState(result.source);
      setSelectedIds(new Set());
      setMultiSelect(false);
      showToast(`Moved ${result.moved} ${result.moved === 1 ? 'photo' : 'photos'} to ${target.shoot.title}${result.skipped ? `. ${result.skipped} already there stayed here.` : '.'}`);
    } catch {
      showToast('Could not move the photos. Nothing was changed.');
    }
  }
  const stateRef = useRef(cullingState);
  stateRef.current = cullingState;
  const [pendingAction, setPendingAction] = useState<{ kind: 'trash' | 'remove' | 'reset'; frameIds: string[]; allowAdvance?: boolean } | null>(null);
  const [removedOpen, setRemovedOpen] = useState(false);

  const handleDecideFrame = useCallback(
    (frameId: string, decision: CullDecision, allowAdvance?: boolean) => {
      const frame = stateRef.current.frames.find((candidate) => candidate.id === frameId);
      if (frame && decision === 'reject') {
        if (frame.decision === 'reject') {
          setPendingAction({ kind: 'remove', frameIds: [frameId] });
          return;
        }
        if (frame.decision === 'keep') {
          setPendingAction({ kind: 'trash', frameIds: [frameId], allowAdvance });
          return;
        }
      }
      setCullingState((prev) =>
        applyDecisionWithHistory(prev, frameId, decision, { allowAdvance })
      );
    },
    []
  );

  const resetFrames = (ids: string[]) => setCullingState((prev) => {
    const targets = new Set(ids);
    return {
      ...prev,
      shoot: { ...prev.shoot, lastUpdatedAt: Date.now() },
      frames: prev.frames.map((frame) => targets.has(frame.id) && isEdited(frame)
        ? recordEdit(frame, { edit: undefined, framing: undefined }, Date.now()) : frame),
    };
  });

  // One photo resets straight away, and each reset stays in that photo's edit history. Several photos ask first.
  const requestReset = (ids: string[]) => {
    const edited = ids.filter((id) => { const frame = stateRef.current.frames.find((candidate) => candidate.id === id); return frame && isEdited(frame); });
    if (!edited.length) return;
    if (edited.length > 1) setPendingAction({ kind: 'reset', frameIds: edited });
    else resetFrames(edited);
  };

  const confirmPending = () => {
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    if (action.kind === 'reset') {
      resetFrames(action.frameIds);
      return;
    }
    setCullingState((prev) => action.kind === 'remove'
      ? removeFromLibrary(prev, action.frameIds)
      : action.frameIds.reduce((state, id) => applyDecisionWithHistory(state, id, 'reject', { allowAdvance: action.allowAdvance ?? false }), prev));
  };

  const toggleCompareView = useCallback(() => {
    setPrefs((prev) => {
      const nextMode: WorkspaceViewMode =
        prev.viewMode === 'compare' ? 'loupe' : 'compare';
      return { ...prev, viewMode: nextMode };
    });
    setCullingState((prev) => {
      const pool = filterFrames(prev.frames, prev.filter, prev.searchQuery, prev.ratingFilter);
      const pair = getDefaultComparePair(
        pool.length > 0 ? pool : prev.frames.filter((frame) => !frame.removedAt),
        prev.selectedFrameId
      );
      return {
        ...prev,
        selectedFrameId: pair.leftId ?? prev.selectedFrameId,
        compareRightFrameId: pair.rightId ?? prev.compareRightFrameId,
      };
    });
  }, []);

  // Unified command dispatcher shared by keyboard + macro pad + visible buttons
  const executeCommand = useCallback(
    (commandId: CommandId) => {
      switch (commandId) {
        case 'cull.keep': {
          if (selectedFrame) {
            handleDecideFrame(selectedFrame.id, 'keep');
          }
          break;
        }
        case 'cull.reject': {
          if (selectedFrame) {
            handleDecideFrame(selectedFrame.id, 'reject');
          }
          break;
        }
        case 'cull.unreviewed': {
          if (selectedFrame) {
            handleDecideFrame(selectedFrame.id, 'unreviewed', false);
          }
          break;
        }
        case 'cull.undo': {
          setCullingState((prev) => undoDecision(prev));
          break;
        }
        case 'cull.redo': {
          setCullingState((prev) => redoDecision(prev));
          break;
        }
        case 'cull.compare': {
          toggleCompareView();
          break;
        }
        case 'cull.toggleZoom': {
          setZoomLevel((z) => {
            const next = z > 1 ? 1 : 2;
            if (next === 1) setPanOffset({ x: 0, y: 0 });
            return next;
          });
          break;
        }
        case 'cull.knobCcw': {
          if (prefs.knobMode === 'zoom') {
            setZoomLevel((z) => {
              const next = Math.max(1, Number((z - 0.5).toFixed(2)));
              if (next <= 1) setPanOffset({ x: 0, y: 0 });
              return next;
            });
          } else {
            handleStepFrame(-1);
          }
          break;
        }
        case 'cull.knobCw': {
          if (prefs.knobMode === 'zoom') {
            setZoomLevel((z) => Math.min(4, Number((z + 0.5).toFixed(2))));
          } else {
            handleStepFrame(1);
          }
          break;
        }
        case 'cull.toggleGrid': {
          setPrefs((prev) => ({
            ...prev,
            viewMode: prev.viewMode === 'grid' ? 'loupe' : 'grid',
          }));
          break;
        }
        case 'cull.toggleShortcuts': {
          setPrefs((prev) => ({
            ...prev,
            showShortcutsOverlay: !prev.showShortcutsOverlay,
          }));
          break;
        }
        default:
          break;
      }
    },
    [selectedFrame, handleDecideFrame, toggleCompareView, prefs.knobMode, handleStepFrame]
  );

  const updateFrame = (frameId: string, patch: Pick<PhotoFrame, 'edit' | 'subjectNames' | 'tags' | 'subjectKind' | 'autoTags' | 'declinedTags' | 'rating' | 'framing' | 'focusPoint'>) => {
    const at = Date.now();
    const isRecipe = 'edit' in patch || 'framing' in patch;
    setCullingState((prev) => ({
      ...prev,
      shoot: { ...prev.shoot, lastUpdatedAt: at },
      frames: prev.frames.map((frame) => frame.id !== frameId ? frame :
        isRecipe ? recordEdit(frame, patch, at) : { ...frame, ...patch }),
    }));
  };

  // Tags and kind for any photo, from the editor or from the info pop-up.
  const setSubjects = (frame: PhotoFrame, tags: string[], subjectKind: SubjectKind | undefined) =>
    updateFrame(frame.id, { tags, subjectNames: [], subjectKind, ...reconcileAuto(frame, tags) });
  const keepTag = (frame: PhotoFrame, name: string) => updateFrame(frame.id, { autoTags: keepAuto(frame, name) });

  // After photos are added, name the species in the background. The subject flashes up on each card as it is found.
  const scan = useSpeciesScan({
    projectId: cullingState.shoot.id,
    frames: cullingState.frames, provider: previewProviderRef.current, active: !projectsOpen && !editing && can('speciesId'),
    onResult: (frameId, patch) => setCullingState((prev) => {
      if (prev.shoot.id !== cullingState.shoot.id) return prev;
      return { ...prev, frames: prev.frames.map((frame) =>
        frame.id === frameId && !frame.removedAt && !frame.speciesChecked && !frame.tags?.length && !frame.subjectNames?.length
          ? { ...frame, ...patch } : frame) };
    }),
  });

  const jumpPhotoHistory = (frameId: string, cursor: number) => {
    setCullingState((prev) => ({
      ...prev, shoot: { ...prev.shoot, lastUpdatedAt: Date.now() },
      frames: prev.frames.map((frame) => frame.id === frameId ? jumpToStep(frame, cursor) : frame),
    }));
  };

  const stepPhotoHistory = (frameId: string, direction: -1 | 1) => {
    setCullingState((prev) => ({
      ...prev, shoot: { ...prev.shoot, lastUpdatedAt: Date.now() },
      frames: prev.frames.map((frame) => frame.id === frameId ? stepEdit(frame, direction) : frame),
    }));
  };

  const addVirtualCopy = (framing?: PhotoFraming) => {
    if (!selectedFrame) return;
    const id = `copy-${newId()}`;
    const sourceId = selectedFrame.id;
    setCullingState((prev) => {
      const index = prev.frames.findIndex((frame) => frame.id === sourceId);
      if (index < 0) return prev;
      const copy = createVirtualCopy(prev.frames[index], prev.frames, id);
      if (framing) { copy.framing = framing; copy.focusPoint = undefined; }
      const frames = [...prev.frames.slice(0, index + 1), copy, ...prev.frames.slice(index + 1)];
      const visible = filterFrames([copy], prev.filter, prev.searchQuery, prev.ratingFilter).length > 0;
      return {
        ...prev, frames, selectedFrameId: id,
        shoot: { ...prev.shoot, totalFrames: frames.length, lastUpdatedAt: Date.now() },
        filter: visible ? prev.filter : 'all',
        searchQuery: visible ? prev.searchQuery : '',
      };
    });
  };

  const removeVirtualCopy = () => {
    if (!selectedFrame?.virtualCopy) return;
    const removedId = selectedFrame.id;
    const originalId = selectedFrame.virtualCopy.originalFrameId;
    setCullingState((prev) => {
      const frames = prev.frames.filter((frame) => frame.id !== removedId);
      const visible = filterFrames(frames, prev.filter, prev.searchQuery, prev.ratingFilter);
      const cleanHistory = (items: CullingState['undoStack']) => items
        .filter((item) => item.frameId !== removedId)
        .map((item) => ({
          ...item,
          prevSelectedId: item.prevSelectedId === removedId ? originalId : item.prevSelectedId,
          nextSelectedId: item.nextSelectedId === removedId ? originalId : item.nextSelectedId,
        }));
      return {
        ...prev, frames,
        selectedFrameId: visible.find((frame) => frame.id === originalId)?.id ?? visible[0]?.id ?? originalId,
        compareRightFrameId: prev.compareRightFrameId === removedId ? null : prev.compareRightFrameId,
        undoStack: cleanHistory(prev.undoStack),
        redoStack: cleanHistory(prev.redoStack),
        shoot: { ...prev.shoot, totalFrames: frames.length, lastUpdatedAt: Date.now() },
      };
    });
  };

  const filmstripVisible = prefs.showFilmstrip && !prefs.focusMode;
  const toggleFilmstrip = () => setPrefs((prev) => ({ ...prev, showFilmstrip: !prev.showFilmstrip }));

  const applyEditToKeepers = (edit: PhotoEdit) => {
    const applied = { ...edit };
    const previous = new Map(
      cullingState.frames.filter((frame) => frame.decision === 'keep').map((frame) => [frame.id, frame.edit])
    );
    setBatchUndo({ applied, previous });
    setCullingState((prev) => ({
      ...prev,
      shoot: { ...prev.shoot, lastUpdatedAt: Date.now() },
      frames: prev.frames.map((frame) =>
        previous.has(frame.id) ? recordEdit(frame, { edit: applied }, Date.now()) : frame
      ),
    }));
  };

  const undoKeeperEdits = () => {
    if (!batchUndo) return;
    setCullingState((prev) => ({
      ...prev,
      shoot: { ...prev.shoot, lastUpdatedAt: Date.now() },
      frames: prev.frames.map((frame) =>
        frame.edit === batchUndo.applied && batchUndo.previous.has(frame.id)
          ? recordEdit(frame, { edit: batchUndo.previous.get(frame.id) }, Date.now())
          : frame
      ),
    }));
    setBatchUndo(null);
  };

  // Global keyboard listener wired through unified resolveKeyboardCommand
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (projectsOpen || loadingProgress || exportFrames.length || autoCullOpen || pendingAction || removedOpen) return;
      if (e.key === 'Escape' && showPhotoInfo) {
        setShowPhotoInfo(false);
        setInfoFrameId(undefined);
        infoTriggerRef.current?.focus();
        return;
      }
      const isModalOpen = openShootModal || macroPadModal;
      if (editing) {
        if (!isModalOpen && e.key === 'Escape') setEditing(false);
        return;
      }
      const isSuppressed = isModalOpen || isEditableElement(e.target) ||
        (e.target instanceof Element && Boolean(e.target.closest('[data-workspace-options]')));

      const cmd = resolveKeyboardCommand({
        event: e,
        bindings: prefs.bindings,
        activeMode: 'cull',
        isSuppressed,
      });

      if (!cmd) return;
      e.preventDefault();
      executeCommand(cmd.id);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [projectsOpen, loadingProgress, exportFrames.length, autoCullOpen, pendingAction, removedOpen, showPhotoInfo, editing, openShootModal, macroPadModal, prefs.bindings, executeCommand]);

  const droppedInProjectRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const quickEditRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const handleSelectLocalFilesRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const onDroppedPhotos = useCallback((files: File[]) => { if (projectsOpen) void quickEditRef.current(files); else void droppedInProjectRef.current(files); }, [projectsOpen]);
  const drop = useDropPhotos(onDroppedPhotos);

  const handleSelectLocalFiles = async (files: File[], options?: { openEditor?: boolean }) => {
    // A photo that was removed from the library does not count as already added, so adding it again brings it back.
    const existing = new Set(cullingState.frames.filter((frame) => !frame.removedAt).map((frame) => frame.stableKey));
    const additions = files.filter((file) => {
      const key = getLocalFileKey(file);
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    if (!additions.length) {
      if (options?.openEditor) {
        // Quick edit of a photo that is already in Quick edits: open the one that is there.
        const present = cullingState.frames.find((frame) => !frame.removedAt && frame.stableKey === getLocalFileKey(files[0]));
        if (present) {
          setCullingState((prev) => ({ ...prev, filter: 'all', selectedFrameId: present.id }));
          setEditing(true);
          return;
        }
      }
      setFolderError('These photos are already in the project.');
      return;
    }
    setOpenShootModal(false);
    setFolderError(null);
    setProjectError(undefined);
    setLoadingProgress({ loaded: 0, total: additions.length });
    try {
      const { frames } = await loadLocalFileListShoot(
        additions, previewProviderRef.current!, storeRef.current!,
        ({ loaded, total }) => setLoadingProgress({ loaded, total })
      );
      const importId = newId().slice(0, 8);
      setCullingState((prev) => {
        const next = appendProjectPhotos(prev, frames, importId);
        const first = options?.openEditor ? next.frames.find((frame) => frame.id.startsWith(`${importId}-`)) : undefined;
        return first ? { ...next, filter: 'all', selectedFrameId: first.id } : next;
      });
      if (options?.openEditor) {
        setEditing(true);
      } else if (cullingState.settings?.autoCull && can('smartCulling')) {
        setAutoCullStart(true);
        setAutoCullOpen(true);
      }
      setPrefs((prev) => ({ ...prev, viewMode: 'grid' }));
    } catch {
      setProjectError('Could not add the photos. Try selecting the files again.');
    } finally {
      setLoadingProgress(null);
    }
  };

  // Quick edit: open the Quick edits bucket, then import the chosen photos and go straight to the editor.
  const quickFiles = useRef<File[] | null>(null);
  async function quickEdit(files: File[]) {
    if (!files.length) return;
    setProjectBusy(true);
    setProjectError(undefined);
    try {
      const store = storeRef.current!;
      if (!(await store.loadProject(INBOX_ID))) await store.saveProject(createInboxProject());
      quickFiles.current = files;
      await openProject(INBOX_ID);
    } catch {
      quickFiles.current = null;
      setProjectError('Could not open Quick edits. Check available browser storage.');
      setProjectBusy(false);
    }
  }
  useEffect(() => {
    if (!quickFiles.current || projectsOpen || cullingState.shoot.id !== INBOX_ID) return;
    const files = quickFiles.current;
    quickFiles.current = null;
    void handleSelectLocalFiles(files, { openEditor: true });
    // Runs once the Quick edits bucket is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsOpen, cullingState.shoot.id]);

  const handleOpenLocalFolder = async () => {
    try {
      const picker = (window as Window & {
        showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker;
      if (!picker) return;
      const handle = await picker();
      const entries = await readFilesFromDirectoryHandle(handle);
      if (entries.length) await handleSelectLocalFiles(entries.map(({ file }) => file));
      else setFolderError('This folder has no supported photos.');
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setFolderError('Could not read the folder. Try selecting files.');
    }
  };

  const reconnectFileSelection = async (files: File[]) => {
    if (relinkingFiles.current) return;
    const preview = previewProviderRef.current!;
    const store = storeRef.current!;
    const projectId = cullingState.shoot.id;
    const expected = new Set(cullingState.frames.filter((frame) => frame.sourceKind === 'file').map((frame) => frame.stableKey));
    let recovered = 0;
    let temporary = 0;
    relinkingFiles.current = true;
    setRelinkStatus('Reconnecting originals…');
    try {
      for (const file of files) {
        if (stateRef.current.shoot.id !== projectId) return;
        const key = getLocalFileKey(file);
        if (!expected.has(key) || preview.hasBlob(key)) continue;
        const saved = await store.saveLocalFileBlob(key, file);
        if (stateRef.current.shoot.id !== projectId) return;
        preview.registerBlob(key, file);
        recovered += 1;
        if (!saved) temporary += 1;
      }
      const missing = [...expected].filter((key) => !preview.hasBlob(key)).length;
      setRelinkStatus(recovered ? (missing ? `${missing} source files still need to be reselected.` : undefined) :
        'None of the selected files match the missing originals in this shoot.');
      if (!recovered) return;
      if (temporary) showToast('Some originals could only be reconnected for this session.');
      setPreviewRevision((previous) => previous + 1);
      setCullingState((previous) => previous.shoot.id === projectId ? {
        ...previous,
        shoot: { ...previous.shoot, needsFileReselect: missing > 0 },
      } : previous);
    } finally {
      relinkingFiles.current = false;
    }
  };

  /**
   * Photos dropped into an open project. Any that are the project's own missing originals (moved or backed up to another
   * drive) are reconnected, matched by name, size and modified time. The rest are added as new photos.
   */
  const handleDroppedInProject = async (files: File[]) => {
    const preview = previewProviderRef.current!;
    const { reconnect, add } = splitDropped(files, cullingState.frames, getLocalFileKey, (key) => preview.hasBlob(key));
    if (reconnect.length) await reconnectFileSelection(reconnect);
    if (add.length || !reconnect.length) await handleSelectLocalFiles(add.length ? add : files);
  };

  const handleReconnectFolderOrFiles = async () => {
    const store = storeRef.current!;
    const preview = previewProviderRef.current!;
    const { shoot } = cullingState;

    if (shoot.needsFileReselect && !shoot.needsFolderRegrant) {
      relinkInput.current?.click();
      return;
    }
    if (!shoot.needsFolderRegrant) return;
    try {
      const stored = await store.loadDirectoryHandle(shoot.id);
      const permission = await (stored as (FileSystemDirectoryHandle & {
        requestPermission?: (options: { mode: 'read' }) => Promise<PermissionState>;
      }) | null)?.requestPermission?.({ mode: 'read' });
      const handle = permission === 'granted' ? stored : await (window as Window & {
        showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker?.();
      if (!handle || (shoot.folderName && handle.name !== shoot.folderName)) {
        setRelinkStatus('Select the original folder to restore its photos.');
        return;
      }
      const entries = await readFilesFromDirectoryHandle(handle);
      const expected = new Set(cullingState.frames.filter((frame) => frame.sourceKind === 'directory-handle').map((frame) => frame.stableKey));
      for (const entry of entries) {
        const key = `folder://${entry.relativePath}`;
        if (expected.has(key)) preview.registerBlob(key, entry.file);
      }
      await store.saveDirectoryHandle(shoot.id, handle);
      const incomplete = [...expected].some((key) => !preview.hasBlob(key));
      setRelinkStatus(incomplete ? 'Some photos are missing from the original folder.' : undefined);
      setPreviewRevision((previous) => previous + 1);
      setCullingState((previous) => ({
        ...previous,
        shoot: { ...previous.shoot, needsFolderRegrant: incomplete },
      }));
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setRelinkStatus('Could not reopen the original folder in this browser.');
    }
  };

  const needsAccess = Boolean(
    cullingState.shoot.needsFolderRegrant || cullingState.shoot.needsFileReselect
  );

  quickEditRef.current = quickEdit;
  handleSelectLocalFilesRef.current = (files) => handleSelectLocalFiles(files);
  droppedInProjectRef.current = handleDroppedInProject;

  if (projectsOpen) {
    return <>
      <DesktopUpdate />
      <DropOverlay dragging={drop.dragging} message={drop.message} onDismiss={drop.clearMessage} />
      <ProjectList projects={projects} photoText={photoText} loading={projectBusy} error={projectError}
        onOpen={(id) => void openProject(id)} onCreate={(name, options) => void newProject(name, options)} onRestore={(file) => void restoreBackup(file)}
        onArchive={(project) => setProjectAction({ kind: 'archive', project })} onDelete={(project) => setProjectAction({ kind: 'delete', project })}
        onUnarchive={(id) => void unarchiveProject(id)} onQuickEdit={(files) => void quickEdit(files)} />
      {projectAction && <ProjectActionDialog kind={projectAction.kind} project={projectAction.project}
        onBackup={() => backUpProject(projectAction.project.id)} onConfirm={() => void confirmProjectAction()} onCancel={() => setProjectAction(null)} />}
    </>;
  }

  return (
    <div className={`h-dvh w-full flex flex-col pb-[env(safe-area-inset-bottom)] bg-kestrel-canvas text-zinc-100 overflow-hidden ${editing ? '' : 'max-md:pb-[calc(3.5rem+env(safe-area-inset-bottom))]'}`}>
      <DesktopUpdate />
      {syncOpen && <SyncFolderDialog title={cullingState.shoot.title} projectId={cullingState.shoot.id} updatedAt={cullingState.shoot.lastUpdatedAt} frames={cullingState.frames} onClose={() => setSyncOpen(false)}
        onApply={(frames) => setCullingState((prev) => ({ ...prev, frames, shoot: { ...prev.shoot, lastUpdatedAt: Date.now() } }))} />}
      {paidDialog && (
        <div role="dialog" aria-modal="true" aria-label={`${paidDialog} is part of Kestrel Paid`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onKeyDown={(event) => { if (event.key === 'Escape') setPaidDialog(null); }}>
          <div className="w-full max-w-sm space-y-3 rounded-xl border border-white/12 bg-kestrel-panel p-4">
            <PaidNotice title={paidDialog}>Assisted selection of your best frames.</PaidNotice>
            <button type="button" autoFocus onClick={() => setPaidDialog(null)} className="min-h-11 w-full rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8">Close</button>
          </div>
        </div>
      )}
      <DropOverlay dragging={drop.dragging} message={drop.message} onDismiss={drop.clearMessage} />
      {editing ? (
        <header className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-kestrel-panel px-3 py-1">
          <button type="button" onClick={() => setEditing(false)} className="min-h-11 shrink-0 rounded-md px-2 text-sm font-medium hover:bg-white/10">Back</button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-300" title={selectedFrame?.filename}>{selectedFrame?.filename ?? 'Edit photo'}</h1>
          {!filmstripVisible && (
            <div className="flex shrink-0">
              <button type="button" aria-label="Previous photo" title="Previous photo" disabled={selectedVisibleIndex <= 0} onClick={() => handleStepFrame(-1)}
                className="h-11 w-11 rounded-md text-lg disabled:opacity-30">‹</button>
              <button type="button" aria-label="Next photo" title="Next photo" disabled={selectedVisibleIndex < 0 || selectedVisibleIndex >= visibleFrames.length - 1} onClick={() => handleStepFrame(1)}
                className="h-11 w-11 rounded-md text-lg disabled:opacity-30">›</button>
            </div>
          )}
        </header>
      ) : <TopWorkspaceBar
        shoot={cullingState.shoot}
        counts={counts}
        filter={cullingState.filter}
        onFilterChange={(next: FilterState) => {
          setCullingState((prev) => {
            const nextVisible = filterFrames(prev.frames, next, prev.searchQuery, prev.ratingFilter);
            const stillVisible = nextVisible.some((f) => f.id === prev.selectedFrameId);
            return {
              ...prev,
              filter: next,
              selectedFrameId: stillVisible
                ? prev.selectedFrameId
                : nextVisible[0]?.id ?? null,
            };
          });
        }}
        ratingFilter={cullingState.ratingFilter ?? null}
        onRatingFilterChange={(next) =>
          setCullingState((prev) => {
            const nextVisible = filterFrames(prev.frames, prev.filter, prev.searchQuery, next);
            const stillVisible = nextVisible.some((f) => f.id === prev.selectedFrameId);
            return { ...prev, ratingFilter: next, selectedFrameId: stillVisible ? prev.selectedFrameId : nextVisible[0]?.id ?? null };
          })
        }
        searchQuery={cullingState.searchQuery}
        onSearchChange={(q) =>
          setCullingState((prev) => {
            const nextVisible = filterFrames(prev.frames, prev.filter, q, prev.ratingFilter);
            const stillVisible = nextVisible.some((f) => f.id === prev.selectedFrameId);
            return {
              ...prev,
              searchQuery: q,
              selectedFrameId: stillVisible
                ? prev.selectedFrameId
                : nextVisible[0]?.id ?? null,
            };
          })
        }
        keeperTarget={cullingState.keeperTarget}
        onKeeperTargetChange={(target) =>
          setCullingState((prev) => ({ ...prev, keeperTarget: target }))
        }
        viewMode={prefs.viewMode}
        onViewModeChange={(mode) => {
          if (mode === 'compare') {
            if (prefs.viewMode !== 'compare') toggleCompareView();
          } else {
            setPrefs((prev) => ({ ...prev, viewMode: mode }));
          }
        }}
        showShortcutsOverlay={prefs.showShortcutsOverlay}
        onToggleShortcutsOverlay={() =>
          setPrefs((prev) => ({
            ...prev,
            showShortcutsOverlay: !prev.showShortcutsOverlay,
          }))
        }
        onOpenShootModal={() => { setFolderError(null); setOpenShootModal(true); }}
        onBackToProjects={() => void backToProjects()}
        onBackupProject={() => void backupProject()}
        onSyncFolder={() => setSyncOpen(true)}
        onAutoCull={() => { if (!can('smartCulling')) { setPaidDialog('Auto-cull'); return; } setAutoCullStart(false); setAutoCullOpen(true); }}
        settings={cullingState.settings ?? LEGACY_SETTINGS}
        onSettingsChange={(settings) => setCullingState((prev) => ({ ...prev, settings, shoot: { ...prev.shoot, lastUpdatedAt: Date.now() } }))}
        actionsDisabled={Boolean(loadingProgress) || projectBusy}
        onOpenMacroPadModal={() => { setMacroPadMode('cull'); setMacroPadModal(true); }}
        loadingProgress={loadingProgress}
        onToggleMultiSelect={prefs.viewMode === 'grid' ? () => {
          if (multiSelect) setSelectedIds(new Set());
          setMultiSelect(!multiSelect);
        } : undefined}
        multiSelect={multiSelect}
        focusMode={prefs.focusMode}
        onToggleFocusMode={() => {
          setShowPhotoInfo(false);
          setPrefs((prev) => ({ ...prev, focusMode: !prev.focusMode }));
        }}
        onExportKeepers={cullingState.filter === 'keep' && visibleFrames.length
          ? () => setExportFrames(visibleFrames) : undefined}
        onUndo={cullingState.undoStack.length ? () => executeCommand('cull.undo') : undefined}
        undoLabel={undoLabel(cullingState)}
        redoLabel={redoLabel(cullingState)}
        onExport={exportSelection.length ? () => setExportFrames(exportSelection) : undefined}
        exportLabel={exportSelection.length > 1 ? `Export ${exportSelection.length}` : 'Export'}
        showFilmstrip={prefs.showFilmstrip}
        onToggleFilmstrip={toggleFilmstrip}
        showPhotoInfo={showPhotoInfo}
        onTogglePhotoInfo={() => {
          setInfoFrameId(undefined);
          infoTriggerRef.current = null;
          setShowPhotoInfo((visible) => !visible);
        }}
        autoAdvance={cullingState.autoAdvance}
        onToggleAutoAdvance={() =>
          setCullingState((prev) => ({ ...prev, autoAdvance: !prev.autoAdvance }))
        }
        onMoveToProject={moveIds.length ? () => { void refreshProjects().finally(() => setMoveOpen(true)); } : undefined}
        onClearDecision={selectedFrame && selectedFrame.decision !== 'unreviewed' ? () => executeCommand('cull.unreviewed') : undefined}
        onRemoveFromLibrary={selectedFrame?.decision === 'reject' ? () => setPendingAction({ kind: 'remove', frameIds: [selectedFrame.id] }) : undefined}
        removedCount={removedFrames(cullingState.frames).length}
        onOpenRemoved={removedFrames(cullingState.frames).length ? () => setRemovedOpen(true) : undefined}
        onRedo={cullingState.redoStack.length ? () => executeCommand('cull.redo') : undefined}
        onEditPhoto={selectedFrame && !loadingProgress ? () => setEditing(true) : undefined}
      />}

      <input ref={relinkInput} type="file" hidden multiple accept={PHOTO_ACCEPT}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) void reconnectFileSelection(files);
          event.target.value = '';
        }}
      />
      <FolderRegrantBanner
        status={relinkStatus}
        visible={needsAccess && !bannerDismissed}
        mode={cullingState.shoot.needsFolderRegrant ? 'folder' : 'files'}
        folderName={cullingState.shoot.folderName}
        onReconnect={handleReconnectFolderOrFiles}
        onDismiss={() => setBannerDismissed(true)}
      />

      {/* Main Workspace Split */}
      {backupNotice && <div className="flex items-center justify-between gap-2 border-b border-white/8 px-3 text-sm text-zinc-300">
        <p role="status">{backupNotice}</p>
        <button type="button" className="min-h-11 px-2" onClick={() => setBackupNotice(undefined)}>Dismiss</button>
      </div>}

      {projectError && <p role="alert" className="bg-orange-950 px-3 py-2 text-sm text-orange-100">{projectError}</p>}

      <main key={previewRevision} className="relative flex-1 flex min-h-0 min-w-0">
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {editing && selectedFrame && (
            <PhotoEditor
              key={selectedFrame.id}
              onOpenMacroPad={() => { setMacroPadMode('edit'); setMacroPadModal(true); }}
              autoEdit={!!cullingState.settings?.autoEdit}
              frame={selectedFrame}
              bindings={prefs.bindings}
              provider={previewProviderRef.current!}
              needsAccess={needsAccess}
              burstMates={burstMates(cullingState.frames, selectedFrame)}
              onTagPhotos={(ids, name, kind) => setCullingState((prev) => ({ ...prev, shoot: { ...prev.shoot, lastUpdatedAt: Date.now() }, frames: tagFrames(prev.frames, ids, name, kind) }))}
              onEdit={(edit) => updateFrame(selectedFrame.id, { edit: isEmptyEdit(edit) ? undefined : { ...edit } })}
              copiedEdit={copiedEdit}
              onCopyEdit={setCopiedEdit}
              onHistoryStep={(direction) => stepPhotoHistory(selectedFrame.id, direction)}
              onHistoryJump={(cursor) => jumpPhotoHistory(selectedFrame.id, cursor)}
              onCreateVirtualCopy={addVirtualCopy}
              onFocusPoint={(focusPoint) => updateFrame(selectedFrame.id, { focusPoint })}
              onFramingChange={(framing) => updateFrame(selectedFrame.id, { framing })}
              onRemoveVirtualCopy={selectedFrame.virtualCopy ? removeVirtualCopy : undefined}
              panelSide={prefs.editPanelSide}
              onPanelSideChange={(side) => setPrefs((prev) => ({ ...prev, editPanelSide: side }))}
              showFilmstrip={filmstripVisible}
              keeperCount={counts.keep}
              onApplyToKeepers={applyEditToKeepers}
              onUndoKeeperEdits={batchUndo ? undoKeeperEdits : undefined}
              onSubjectsChange={(tags, subjectKind) => setSubjects(selectedFrame, tags, subjectKind)}
              onAutoTag={(name, kind) => { if (mayAutoTag(selectedFrame, name)) updateFrame(selectedFrame.id, { ...applyAutoTag(selectedFrame, name), ...(selectedFrame.subjectKind || !kind ? {} : { subjectKind: kind }) }); }}
              onKeepTag={(name) => keepTag(selectedFrame, name)}
            />
          )}
          {!editing && liveFrames.length === 0 && (
            <div className="grid flex-1 place-items-center p-4">
              <div className="text-center">
                <h2 className="mb-3 text-sm text-zinc-300">This project has no photos yet</h2>
                <button type="button" disabled={Boolean(loadingProgress)} onClick={() => setOpenShootModal(true)}
                  className="min-h-11 rounded-lg bg-kestrel-copper hover:bg-kestrel-copper-hover! px-4 text-sm font-semibold text-zinc-950 disabled:opacity-40">Add photos</button>
              </div>
            </div>
          )}

          {!editing && multiSelect && prefs.viewMode === 'grid' && (
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#15171C] px-3 text-sm">
              <span>{selectedIds.size} selected</span>
              <div className="flex items-center">
              <button type="button" disabled={!selectedIds.size} className="min-h-11 px-2 text-sky-200 disabled:opacity-40"
                onClick={() => setExportFrames(cullingState.frames.filter((frame) => selectedIds.has(frame.id)))}>
                Export selected
              </button>
              <button type="button" className="min-h-11 px-2" onClick={() => {
                setMultiSelect(false);
                setSelectedIds(new Set());
              }}>Done</button>
              </div>
            </div>
          )}
          {!editing && liveFrames.length > 0 && !visibleFrames.length && (
            <div className="grid flex-1 place-items-center p-4">
              <div className="space-y-3 text-center">
                <p className="text-sm text-zinc-300">{cullingState.searchQuery ? 'No photos match this search.' : cullingState.filter === 'unreviewed' ? 'You’re caught up. Your picks are in Keepers.' :
                  cullingState.filter === 'keep' ? 'Flag a photo as Keep to see it here.' : 'Trash is empty.'}</p>
                {cullingState.filter === 'unreviewed' && counts.unreviewed === 0 && cullingState.undoStack.length > 0 && (
                  <button type="button" onClick={() => executeCommand('cull.undo')}
                    className="min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/10">
                    Undo last decision
                  </button>
                )}
              </div>
            </div>
          )}
          {!editing && can('speciesId') && <SpeciesScanBanner scan={scan} />}
          {can('onlineAi') && <OnlineHelperDialog />}
          {!editing && visibleFrames.length > 0 && prefs.viewMode === 'grid' && (
            <VirtualizedContactSheet
              onResetFrame={(id) => requestReset(multiSelect && selectedIds.has(id) ? [...selectedIds] : [id])}
              frames={visibleFrames}
              selectedFrameId={selectedFrame?.id ?? null}
              previewProvider={previewProviderRef.current!}
              needsAccess={needsAccess}
              onSelectFrame={selectGridPhoto}
              markedIds={selectedIds}
              multiSelect={multiSelect}
              onInfo={(id, trigger) => {
                setInfoFrameId(id);
                infoTriggerRef.current = trigger;
                setShowPhotoInfo(true);
              }}
              onOpenLoupe={(frameId) => {
                handleSelectFrame(frameId);
                setPrefs((prev) => ({ ...prev, viewMode: 'loupe' }));
              }}
              onDecideFrame={(frameId, decision) =>
                handleDecideFrame(frameId, decision, false)
              }
            />
          )}

          {!editing && visibleFrames.length > 0 && prefs.viewMode === 'loupe' && (
            <LoupePreview
              frame={selectedFrame}
              previewProvider={previewProviderRef.current!}
              zoomLevel={zoomLevel}
              onZoomChange={setZoomLevel}
              panOffset={panOffset}
              onPanChange={setPanOffset}
              canUndo={cullingState.undoStack.length > 0}
              hasPrev={selectedVisibleIndex > 0}
              hasNext={
                selectedVisibleIndex !== -1 &&
                selectedVisibleIndex < visibleFrames.length - 1
              }
              needsAccess={needsAccess}
              bindings={prefs.bindings}
              knobMode={prefs.knobMode}
              showShortcutsOverlay={prefs.showShortcutsOverlay && !prefs.focusMode}
              onExecuteCommand={executeCommand}
              onStepFrame={handleStepFrame}
              onResetFrame={() => selectedFrame && requestReset([selectedFrame.id])}
            />
          )}

          {!editing && visibleFrames.length > 0 && prefs.viewMode === 'compare' && (
            <CompareView
              leftFrame={selectedFrame}
              rightFrame={compareRightFrame}
              previewProvider={previewProviderRef.current!}
              needsAccess={needsAccess}
              zoomLevel={zoomLevel}
              panOffset={panOffset}
              onTransform={(zoom, pan) => {
                setZoomLevel(zoom);
                setPanOffset(pan);
              }}
              onSwapPanes={() => {
                setCullingState((prev) => ({
                  ...prev,
                  selectedFrameId: compareRightFrame?.id ?? prev.selectedFrameId,
                  compareRightFrameId: selectedFrame?.id ?? prev.compareRightFrameId,
                }));
              }}
              candidates={visibleFrames}
              onSelectRight={(frameId) => setCullingState((prev) => ({ ...prev, compareRightFrameId: frameId }))}
              onDecideFrame={(frameId, decision) =>
                handleDecideFrame(frameId, decision, false)
              }
              onExitCompare={() =>
                setPrefs((prev) => ({ ...prev, viewMode: 'loupe' }))
              }
            />
          )}

          {editing && selectedFrame && (
            <div role="toolbar" aria-label="Filmstrip controls"
              className={`flex shrink-0 items-center gap-1 border-t border-white/10 bg-kestrel-panel px-2 ${filmstripVisible ? (prefs.editPanelSide === 'left' ? 'md:pl-[calc(var(--editor-panel-w,0px)+0.5rem)]' : 'md:pr-[var(--editor-panel-w,0px)]') : ''}`}>
              <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-white/10"
                onClick={() => { setCopiedEdit(selectedFrame.edit ?? DEFAULT_EDIT); showToast('Adjustments copied'); }}>
                <Copy className="h-4 w-4" aria-hidden="true" /> Copy
              </button>
              <button type="button" disabled={!copiedEdit} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-white/10 disabled:opacity-40"
                onClick={() => { if (copiedEdit) { updateFrame(selectedFrame.id, { edit: isEmptyEdit(copiedEdit) ? undefined : { ...copiedEdit } }); showToast('Adjustments pasted'); } }}>
                <ClipboardPaste className="h-4 w-4" aria-hidden="true" /> Paste
              </button>
              <button type="button" aria-pressed={filmstripVisible} className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-white/10"
                onClick={() => setPrefs((prev) => ({ ...prev, showFilmstrip: !filmstripVisible, focusMode: false }))}>
                {filmstripVisible ? <PinOff className="h-4 w-4" aria-hidden="true" /> : <Pin className="h-4 w-4" aria-hidden="true" />}
                {filmstripVisible ? 'Hide filmstrip' : 'Pin filmstrip'}
              </button>
            </div>
          )}
          {/* Persistent Filmstrip in Loupe & Compare Modes */}
          {filmstripVisible && (editing || prefs.viewMode !== 'grid') && visibleFrames.length > 0 && (
            <div className={editing ? (prefs.editPanelSide === 'left' ? 'md:pl-[var(--editor-panel-w,0px)]' : 'md:pr-[var(--editor-panel-w,0px)]') : undefined}>
            <Filmstrip
              frames={visibleFrames}
              selectedFrameId={selectedFrame?.id ?? null}
              compareRightFrameId={compareRightFrame?.id ?? null}
              isCompareMode={!editing && visibleFrames.length > 0 && prefs.viewMode === 'compare'}
              previewProvider={previewProviderRef.current!}
              needsAccess={needsAccess}
              onSelectFrame={handleSelectFrame}
              onSelectCompareRight={(id) =>
                setCullingState((prev) => ({ ...prev, compareRightFrameId: id }))
              }
            />
            </div>
          )}
        </div>

        {!editing && showPhotoInfo && (
          <ExifInspector onSubjects={(frame, tags, kind) => setSubjects(frame, tags, kind)} onKeepTag={(frame, name) => keepTag(frame, name)} onRate={(id, rating) => rateOrFlagPhotos(id, { rating })}
            onFlag={(id, flag) => rateOrFlagPhotos(id, { flag })}
            batchCount={multiSelect && selectedIds.has(infoFrameId ?? selectedFrame?.id ?? '') ? selectedIds.size : 0}
            frame={infoFrameId ? cullingState.frames.find((frame) => frame.id === infoFrameId) ?? null : selectedFrame}
            onClose={() => {
              setShowPhotoInfo(false);
              setInfoFrameId(undefined);
              infoTriggerRef.current?.focus();
            }}
          />
        )}
      </main>

      {pendingAction?.kind === 'trash' && (() => {
        const moving = pendingAction.frameIds.filter((id) => cullingState.frames.find((frame) => frame.id === id)?.decision === 'keep').length;
        return (
          <ConfirmDialog title={moving > 1 ? `Move ${moving} Keepers to Trash?` : 'Move this Keeper to Trash?'}
            confirmLabel="Move to Trash" cancelLabel="Keep it" onConfirm={confirmPending} onCancel={() => setPendingAction(null)}>
            <p>{moving > 1 ? 'They leave Keepers and go to Trash.' : 'It leaves Keepers and goes to Trash.'} Your original files are not changed, and Undo puts them back.</p>
          </ConfirmDialog>
        );
      })()}
      {pendingAction?.kind === 'reset' && (
        <ConfirmDialog title={`Reset ${pendingAction.frameIds.length} photos to original?`} confirmLabel="Reset photos" cancelLabel="Cancel"
          onConfirm={confirmPending} onCancel={() => setPendingAction(null)}>
          <p>Adjustments, crops and rotation on these photos go back to the original. Your original files are not changed, and each photo’s Undo in the editor can bring its edits back.</p>
        </ConfirmDialog>
      )}
      {pendingAction?.kind === 'remove' && (
        <ConfirmDialog title="Remove from the library?" confirmLabel="Remove from library" cancelLabel="Cancel"
          onConfirm={confirmPending} onCancel={() => setPendingAction(null)}>
          <p>{cullingState.frames.find((frame) => frame.id === pendingAction.frameIds[0])?.filename ?? 'This photo'} will disappear from Kestrel’s views, counts and exports.</p>
          <p><strong>Your original file is not deleted.</strong> You can bring it back from Workspace options, Removed photos, or press Undo.</p>
        </ConfirmDialog>
      )}
      {removedOpen && (
        <RemovedPhotosPanel frames={removedFrames(cullingState.frames)} onClose={() => setRemovedOpen(false)}
          onRestore={(ids) => setCullingState((prev) => restoreRemoved(prev, ids))} />
      )}

      {moveOpen && <MoveToProjectDialog count={moveIds.length} onCancel={() => setMoveOpen(false)} onConfirm={(id) => void moveSelectionTo(id)}
        projects={projects.filter((project) => project.id !== cullingState.shoot.id && !project.archivedAt)} />}
      {toast && <p role="status" className="fixed bottom-4 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border border-white/15 bg-kestrel-raised px-4 py-2 text-sm shadow-2xl">{toast}</p>}
      {autoCullOpen && <AutoCullPanel autoStart={autoCullStart} frames={cullingState.frames} keeperTarget={cullingState.keeperTarget}
        provider={previewProviderRef.current!}
        onApply={(results) => setCullingState((previous) => applyAutoCullDecisions(previous, results))}
        onUndo={() => setCullingState((previous) => undoDecision(previous))}
        onInspect={(frame) => {
          setAutoCullOpen(false);
          setPrefs((previous) => ({ ...previous, viewMode: 'loupe' }));
          setCullingState((previous) => ({
            ...previous, filter: frame.decision, searchQuery: '', selectedFrameId: frame.id,
          }));
          setZoomLevel(1);
          setPanOffset({ x: 0, y: 0 });
        }}
        onClose={() => setAutoCullOpen(false)} />}

      {exportFrames.length > 0 && <PhotoExportPanel frames={exportFrames} provider={previewProviderRef.current!}
        onClose={() => setExportFrames([])} />}

      <MacroPadModal
        open={macroPadModal}
        openTo={macroPadMode}
        onClose={() => setMacroPadModal(false)}
        bindings={prefs.bindings}
        onUpdateBinding={(commandId, chord) =>
          setPrefs((prev) => ({
            ...prev,
            bindings: {
              ...prev.bindings,
              [commandId]: chord,
            },
          }))
        }
        onResetBindings={() =>
          setPrefs((prev) => ({
            ...prev,
            bindings: DEFAULT_KEY_BINDINGS,
            knobMode: DEFAULT_PREFERENCES.knobMode,
          }))
        }
        knobMode={prefs.knobMode}
        onKnobModeChange={(mode: KnobFunction) =>
          setPrefs((prev) => ({ ...prev, knobMode: mode }))
        }
      />

      <OpenShootModal
        open={openShootModal}
        onClose={() => setOpenShootModal(false)}
        onSelectLocalFiles={handleSelectLocalFiles}
        onOpenLocalFolder={handleOpenLocalFolder}
        folderError={folderError}
      />
    </div>
  );
}
