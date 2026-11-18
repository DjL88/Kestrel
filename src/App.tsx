import { isDesktopApp } from './providers/desktopShell';
import { useOpenedFiles } from './providers/useOpenedFiles';
import { pickFolderNatively, pickedFromFile, pickedKey, linkedReader, type PickedPhoto } from './providers/linkedOriginals';
import { checkOriginalPaths } from './providers/originalPathStatus';
import { scanOriginalFolder, matchScannedOriginals } from './providers/nativeOriginalScan';
import { splitDropped } from './core/dropSplit';
import { useAccess } from './providers/useAccess';
import { loadLicence } from './providers/licenceStore';
import { PaidNotice } from './components/PaidNotice';
import { SyncFolderDialog } from './components/SyncFolderDialog';
import { ProjectLocationsDialog } from './components/ProjectLocationsDialog';
import { useAutoBackup } from './providers/autoBackup';
import { exportPlaceFor } from './providers/exportToPlace';
import { WatchFolderDialog } from './components/WatchFolderDialog';
import { useFolderWatch } from './providers/useFolderWatch';
import { PHOTO_ACCEPT } from './core/rawFormats';
import { TaskManager } from './components/TaskManager';
import { ImportProgress } from './components/ImportProgress';
import { PhotoContextMenu } from './components/PhotoContextMenu';
import { ratingFor, targetsFor, type PhotoAction } from './core/photoMenu';
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
import { loadImage } from './providers/loadImage';
import { DEFAULT_FRAMING, drawFramedPhoto } from './core/photoFraming';
import { ArrowLeft, Copy, ClipboardPaste, Pin, PinOff } from 'lucide-react';
import { newId } from './core/ids';
import { redoLabel, undoLabel } from './core/describeAction';
import { jumpToStep, recordEdit, stepEdit } from './core/editHistory';
import { markExportRequested } from './core/compareStages';
import { AutoCullPanel } from './components/AutoCullPanel';
import { scanForCulling } from './providers/browserAutoCull';
import { limitAutoKeepers } from './core/autoCull';
import { backgroundCullCandidates, backgroundCullMoves, backgroundDevelopTargets } from './core/backgroundAutoPolicy';
import { GuidedBanner } from './components/GuidedBanner';
import { guidedStep } from './core/guidedProgress';
import { BatchLookDialog } from './components/BatchLookDialog';
import { SelectionLookDialog } from './components/SelectionLookDialog';
import { applySelectedLook, previewSelectedLook } from './core/selectedLooks';
import { suggestKeeperAutoEdits, applyKeeperAutoEdits } from './providers/batchAutoEdit';
import { tasks } from './core/taskStore';
import { applyKeeperLook, previewKeeperLook } from './core/batchLooks';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { restoreProjectBackup } from './core/projectBackup';
import { saveProjectBackupFile } from './providers/projectBackupFile';
import { ProjectList } from './components/ProjectList';
import { INBOX_ID, appendProjectPhotos, createEmptyProject, createInboxProject, moveFrames, setArchived } from './core/projects';
import { MoveToProjectDialog } from './components/MoveToProjectDialog';
import { ProjectActionDialog } from './components/ProjectActionDialog';
import { createVirtualCopy } from './core/virtualCopies';
import { PhotoExportPanel } from './components/PhotoExportPanel';
import { PhotoEditor, type EditorTab } from './components/PhotoEditor';
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
  collectTagOptions,
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
  applyCullConfidence,
  sortFrames,
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
  loadDirectoryHandleShoot,
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
  const [locationsOpen, setLocationsOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
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
  // Left- or right-handed use is read by the whole page's styles, so the home page and every dialog follow it too.
  useEffect(() => { document.documentElement.dataset.hand = prefs.hand; }, [prefs.hand]);
  const [cullingState, setCullingState] = useState<CullingState>(() =>
    createEmptyProject('uninitialised', '')
  );
  const [editing, setEditing] = useState(false);
  const [editorTab, setEditorTab] = useState<EditorTab>('auto');
  const [autoCullOpen, setAutoCullOpen] = useState(false);
  const [batchLookOpen, setBatchLookOpen] = useState(false);
  const [autoAdjustOpen, setAutoAdjustOpen] = useState(false);
  const [autoAdjustSelectedOpen, setAutoAdjustSelectedOpen] = useState(false);
  const autoAdjustController = useRef<AbortController | null>(null);
  const [autoCullStart, setAutoCullStart] = useState(false);
  /** The guided "what's next" banner, dismissed for one project at a time. Resets on reload or when a different project opens. */
  const [guidedDismissedFor, setGuidedDismissedFor] = useState<string | null>(null);
  const [exportFrames, setExportFrames] = useState<PhotoFrame[]>([]);
  const [showPhotoInfo, setShowPhotoInfo] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
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
  const [temporaryOriginals, setTemporaryOriginals] = useState<Set<string>>(() => new Set());
  const [temporaryWarningDismissed, setTemporaryWarningDismissed] = useState(false);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // A temporary edit queue limits Next/Previous and the filmstrip to selected photos.
  const [editQueueIds, setEditQueueIds] = useState<string[] | null>(null);
  const [confirmPasteSelection, setConfirmPasteSelection] = useState(false);
  const [selectionLookOpen, setSelectionLookOpen] = useState(false);
  const [editTogether, setEditTogether] = useState(false);
  // Avoid recomputing and saving every selected photograph for each slider tick.
  // The active photograph changes immediately; the group catches up after dragging stops.
  const linkedEditTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLinkedEdit = useRef<(() => void) | null>(null);
  const cancelLinkedEdit = () => {
    if (linkedEditTimer.current !== null) clearTimeout(linkedEditTimer.current);
    linkedEditTimer.current = null;
    pendingLinkedEdit.current = null;
  };
  const flushLinkedEdit = () => {
    const commit = pendingLinkedEdit.current;
    cancelLinkedEdit();
    commit?.();
  };
  const [infoFrameId, setInfoFrameId] = useState<string>();
  const infoTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Viewport zoom/pan state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  // Modals & status
  const [openShootModal, setOpenShootModal] = useState(false);
  const [macroPadModal, setMacroPadModal] = useState(false);
  const [macroPadMode, setMacroPadMode] = useState<'cull' | 'edit'>('cull');
  useEffect(() => {
    const openFromDesktopMenu = () => { setMacroPadMode(editing ? 'edit' : 'cull'); setMacroPadModal(true); };
    window.addEventListener('kestrel:open-macro-pad', openFromDesktopMenu);
    return () => window.removeEventListener('kestrel:open-macro-pad', openFromDesktopMenu);
  }, [editing]);
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
  // Back the open project up on its own to the place chosen for it (if any), without waiting to be asked.
  useAutoBackup(cullingState, !projectsOpen);

  function enterProject(state: CullingState) {
    const filter = state.shoot.inbox ? 'all' : state.filter === 'all' ? 'unreviewed' : state.filter;
    const visible = filterFrames(state.frames, filter, state.searchQuery, state.ratingFilter, state.cameraFilter, state.lensFilter, state.tagFilter);
    setBackupNotice(undefined);
    setTemporaryOriginals(new Set());
    setTemporaryWarningDismissed(false);
    setCullingState({
      ...state,
      filter,
      selectedFrameId: visible.find((frame) => frame.id === state.selectedFrameId)?.id ?? visible[0]?.id ?? null,
    });
    setEditing(false);
    setInfoFrameId(undefined);
    setShowPhotoInfo(window.matchMedia('(min-width: 1024px)').matches);
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
      const localFrames = state.frames.filter((frame) => !frame.removedAt && frame.sourceKind === 'file');
      shoot.needsFileReselect = !await rehydrateLocalFramesFromStore(localFrames, preview, store);

      const hasFolderFrames = state.frames.some((frame) => !frame.removedAt && frame.sourceKind === 'directory-handle');
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
          !frame.removedAt && frame.sourceKind === 'directory-handle' && !preview.hasBlob(frame.stableKey)
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
  /** Move to a different filter while keeping the current selection if it's still visible, same rule the filter buttons use. */
  const changeFilter = useCallback((next: FilterState) => {
    setCullingState((prev) => {
      const nextVisible = filterFrames(prev.frames, next, prev.searchQuery, prev.ratingFilter, prev.cameraFilter, prev.lensFilter, prev.tagFilter);
      const stillVisible = nextVisible.some((f) => f.id === prev.selectedFrameId);
      return { ...prev, filter: next, selectedFrameId: stillVisible ? prev.selectedFrameId : nextVisible[0]?.id ?? null };
    });
  }, []);
  const uneditedKeepers = previewKeeperLook(cullingState.frames).eligible;
  const guided = guidedStep(counts, uneditedKeepers);

  const visibleFrames = useMemo(
    () =>
      sortFrames(
        filterFrames(
          cullingState.frames,
          cullingState.filter,
          cullingState.searchQuery,
          cullingState.ratingFilter,
          cullingState.cameraFilter,
          cullingState.lensFilter,
          cullingState.tagFilter
        ),
        cullingState.sortOrder
      ),
    [
      cullingState.frames,
      cullingState.filter,
      cullingState.searchQuery,
      cullingState.ratingFilter,
      cullingState.cameraFilter,
      cullingState.lensFilter,
      cullingState.tagFilter,
      cullingState.sortOrder,
    ]
  );

  /** Distinct cameras, lenses, and tags/species seen in this project, for the Filter control's pickers. */
  const cameraOptions = useMemo(
    () => [...new Set(cullingState.frames.flatMap((frame) => frame.exif.camera ? [frame.exif.camera] : []))].sort(),
    [cullingState.frames]
  );
  const lensOptions = useMemo(
    () => [...new Set(cullingState.frames.flatMap((frame) => frame.exif.lens ? [frame.exif.lens] : []))].sort(),
    [cullingState.frames]
  );
  const tagOptions = useMemo(
    () => collectTagOptions(cullingState.frames),
    [cullingState.frames]
  );

  const editorFrames = useMemo(() =>
    editQueueIds?.length ? visibleFrames.filter((frame) => editQueueIds.includes(frame.id)) : visibleFrames,
    [visibleFrames, editQueueIds]);
  const editorIndex = editorFrames.findIndex((frame) => frame.id === cullingState.selectedFrameId);

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
    // Follow the selected photo rather than a previously opened thumbnail info popup.
    setInfoFrameId(undefined);
    flushLinkedEdit();
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
      flushLinkedEdit();
      setZoomLevel(1);
      setPanOffset({ x: 0, y: 0 });
      setCullingState((prev) => {
        const currentVisible = filterFrames(prev.frames, prev.filter, prev.searchQuery, prev.ratingFilter, prev.cameraFilter, prev.lensFilter, prev.tagFilter);
        const available = editQueueIds?.length ? currentVisible.filter((frame) => editQueueIds.includes(frame.id)) : currentVisible;
        const nextId = stepSelection(available, prev.selectedFrameId, delta);
        if (!nextId || nextId === prev.selectedFrameId) return prev;
        return {
          ...prev,
          selectedFrameId: nextId,
        };
      });
    },
    [editQueueIds]
  );

  // A native desktop Select All means *photo records in the current filtered view*,
  // including offscreen/virtualized records, never text in the webview.
  useEffect(() => {
    const selectAllPhotos = () => {
      if (projectsOpen) return;
      const ids = visibleFrames.map((frame) => frame.id);
      setSelectedIds(new Set(ids));
      setMultiSelect(ids.length > 0);
    };
    const deselectPhotos = () => {
      if (projectsOpen) return;
      setSelectedIds(new Set());
      setMultiSelect(false);
    };
    window.addEventListener('kestrel:photos-select-all', selectAllPhotos);
    window.addEventListener('kestrel:photos-deselect-all', deselectPhotos);
    return () => {
      window.removeEventListener('kestrel:photos-select-all', selectAllPhotos);
      window.removeEventListener('kestrel:photos-deselect-all', deselectPhotos);
    };
  }, [projectsOpen, visibleFrames]);

  const selectedVisibleFrames = visibleFrames.filter((frame) => selectedIds.has(frame.id));
  const startSelectedEditing = () => {
    const ids = selectedVisibleFrames.map((frame) => frame.id);
    if (!ids.length) return;
    setEditQueueIds(ids);
    setEditTogether(false);
    handleSelectFrame(ids[0]);
    setEditing(true);
    // Carry the marked photos into Edit so bulk actions work immediately.
    setMultiSelect(true);
    setSelectedIds(new Set(ids));
    setPrefs((prev) => ({ ...prev, showFilmstrip: true, focusMode: false }));
  };
  const leaveEditor = () => { flushLinkedEdit(); setEditing(false); setEditQueueIds(null); setEditTogether(false); setMultiSelect(false); setSelectedIds(new Set()); };

  const pasteToSelection = () => {
    if (!copiedEdit || !selectedVisibleFrames.length) return;
    const ids = new Set(selectedVisibleFrames.map((frame) => frame.id));
    const at = Date.now();
    setCullingState((prev) => ({ ...prev, shoot: { ...prev.shoot, lastUpdatedAt: at },
      frames: prev.frames.map((frame) => {
        if (!ids.has(frame.id)) return frame;
        // Copy global adjustments only; preserve the destination's masks and framing.
        const edit = { ...copiedEdit, masks: frame.edit?.masks };
        return recordEdit(frame, { edit }, at);
      }),
    }));
    setConfirmPasteSelection(false);
    showToast(`Applied copied adjustments to ${ids.size} photos. Undo is available per photo.`);
  };

  // The right-click menu on a photo (grid or filmstrip). It acts on the whole selection when the photo is part of one.
  const [photoMenu, setPhotoMenu] = useState<{ frameId: string; x: number; y: number } | null>(null);
  const openPhotoMenu = (frameId: string, x: number, y: number) => {
    // A photo outside the current selection becomes the one the menu is about.
    if (!(multiSelect && selectedIds.has(frameId))) handleSelectFrame(frameId);
    setPhotoMenu({ frameId, x, y });
  };
  const choosePhotoAction = (action: PhotoAction) => {
    const menu = photoMenu;
    setPhotoMenu(null);
    if (!menu) return;
    const ids = targetsFor(menu.frameId, selectedIds, multiSelect);
    const chosen = ids.map((id) => cullingState.frames.find((frame) => frame.id === id)).filter((frame): frame is PhotoFrame => Boolean(frame));
    const rating = ratingFor(action);
    if (rating !== null) { rateOrFlagPhotos(menu.frameId, { rating }); return; }
    switch (action) {
      case 'edit': handleSelectFrame(menu.frameId); setEditQueueIds(null); setEditing(true); break;
      case 'info': setInfoFrameId(menu.frameId); setShowPhotoInfo(true); break;
      case 'keep': rateOrFlagPhotos(menu.frameId, { flag: 'keep' }); break;
      case 'trash': rateOrFlagPhotos(menu.frameId, { flag: 'reject' }); break;
      case 'unreview': rateOrFlagPhotos(menu.frameId, { flag: 'unreviewed' }); break;
      case 'copy': { const frame = chosen[0]; if (frame) { setCopiedEdit(frame.edit ?? DEFAULT_EDIT); showToast('Adjustments copied'); } break; }
      case 'paste': {
        if (!copiedEdit || !chosen.length) break;
        const at = Date.now();
        const target = new Set(chosen.map((frame) => frame.id));
        // Global adjustments only: each photo keeps its own masks and framing, and each paste is one undo step.
        setCullingState((prev) => ({ ...prev, shoot: { ...prev.shoot, lastUpdatedAt: at },
          frames: prev.frames.map((frame) => (target.has(frame.id) ? recordEdit(frame, { edit: { ...copiedEdit, masks: frame.edit?.masks } }, at) : frame)) }));
        showToast(`Pasted adjustments to ${chosen.length} photo${chosen.length === 1 ? '' : 's'}.`);
        break;
      }
      case 'reset': requestReset(ids); break;
      case 'duplicate': addVirtualCopy(undefined, menu.frameId); showToast('Made a virtual copy. It shares the original file and has its own edits.'); break;
      case 'export': setExportFrames(chosen); break;
      case 'remove': setPendingAction({ kind: 'remove', frameIds: ids }); break;
    }
  };

  // Moving a Keeper to Trash, or removing a photo from Trash, asks first. Both are reversible and never touch the file.
  // Header Export uses the selection: the ticked photos in selection mode, otherwise the current photo.
  const exportSelection = useMemo(
    () => multiSelect && selectedIds.size ? visibleFrames.filter((frame) => selectedIds.has(frame.id)) : selectedFrame ? [selectedFrame] : [],
    [multiSelect, selectedIds, visibleFrames, selectedFrame]
  );
  // Native menu actions use the exact current photo selection, not a button's
  // changing label or whatever happens to be visible in the WebView.
  useEffect(() => {
    const exportFromDesktopMenu = () => {
      if (!projectsOpen && exportSelection.length) setExportFrames(exportSelection);
    };
    window.addEventListener('kestrel:desktop-export', exportFromDesktopMenu);
    return () => window.removeEventListener('kestrel:desktop-export', exportFromDesktopMenu);
  }, [projectsOpen, exportSelection]);

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
  const editingRef = useRef(editing);
  editingRef.current = editing;

  // New imports trigger the local background pipeline rather than opening a blocking dialog.
  // Queued batches are scoped to a project and can be cancelled; nothing touches RAW originals.
  const autoPendingProject = useRef<string | null>(null);
  const autoPendingIds = useRef(new Set<string>());
  const autoWorker = useRef<{ projectId: string; controller: AbortController } | null>(null);
  const [autoQueueTick, setAutoQueueTick] = useState(0);
  function enqueueBackgroundAuto(projectId: string, ids: readonly string[]) {
    if (!ids.length) return;
    if (autoPendingProject.current !== projectId) {
      autoWorker.current?.controller.abort();
      autoPendingProject.current = projectId;
      autoPendingIds.current.clear();
    }
    ids.forEach((id) => autoPendingIds.current.add(id));
    setAutoQueueTick((tick) => tick + 1);
  }

  useEffect(() => {
    if (autoWorker.current?.projectId !== cullingState.shoot.id) autoWorker.current?.controller.abort();
    if (autoPendingProject.current !== cullingState.shoot.id) autoPendingIds.current.clear();
  }, [cullingState.shoot.id]);
  useEffect(() => () => { autoWorker.current?.controller.abort(); }, []);

  useEffect(() => {
    const projectId = cullingState.shoot.id;
    if (autoWorker.current || autoPendingProject.current !== projectId || !autoPendingIds.current.size) return;
    const imported = new Set(autoPendingIds.current);
    autoPendingIds.current.clear();
    const controller = new AbortController();
    autoWorker.current = { projectId, controller };
    const alive = () => !controller.signal.aborted && stateRef.current.shoot.id === projectId;
    const run = async () => {
      const provider = previewProviderRef.current!;
      let snapshot = stateRef.current;
      if (!alive()) return;
      let autoKeptCount = 0;
      let autoDupCount = 0;
      if (snapshot.settings?.autoCull && can('smartCulling')) {
        const candidates = backgroundCullCandidates(snapshot.frames, imported);
        if (candidates.length) {
          const task = tasks.start('Reviewing imported photographs', {
            total: candidates.length, cancel: () => controller.abort(),
          });
          controller.signal.addEventListener('abort', () => { tasks.cancel(task.id); }, { once: true });
          try {
            const results = await scanForCulling(candidates, snapshot.frames, provider, snapshot.keeperTarget,
              controller.signal, (count) => task.progress(count));
            if (!alive()) return;
            // Recheck the LIVE catalogue: user decisions, crops and history made while
            // the detector ran always win over delayed automated results.
            const latest = stateRef.current;
            const remaining = Math.max(0, latest.keeperTarget -
              latest.frames.filter((frame) => !frame.removedAt && frame.decision === 'keep').length);
            const limited = limitAutoKeepers(results, latest.frames, remaining);
            const moves = latest.settings?.autoCull
              ? backgroundCullMoves(latest.frames, limited, imported).filter((item) =>
                  !(editingRef.current && item.frameId === latest.selectedFrameId))
              : [];
            autoKeptCount = moves.filter((m) => m.decision === 'keep').length;
            autoDupCount = moves.filter((m) => m.decision === 'reject').length;
            snapshot = applyAutoCullDecisions(latest, moves);
            setCullingState((prev) => {
              if (prev.shoot.id !== projectId || controller.signal.aborted || !prev.settings?.autoCull) return prev;
              const spare = Math.max(0, prev.keeperTarget -
                prev.frames.filter((frame) => !frame.removedAt && frame.decision === 'keep').length);
              const currentResults = limitAutoKeepers(results, prev.frames, spare);
              const decisions = backgroundCullMoves(prev.frames, currentResults, imported).filter((item) =>
                !(editingRef.current && item.frameId === prev.selectedFrameId));
              const scored = applyCullConfidence(prev, results.map((item) => ({
                frameId: item.frameId, confidence: item.confidence, score: item.score,
              })));
              return applyAutoCullDecisions(scored, decisions);
            });
            task.finish('Review the remaining uncertain photographs whenever you like');
          } catch (error) {
            if (!controller.signal.aborted) task.fail(error instanceof Error ? error.message : 'Review could not finish');
            return;
          }
        }
      }
      if (!alive() || !snapshot.settings?.autoEdit || !can('autoTab')) {
        if (alive() && (autoKeptCount > 0 || autoDupCount > 0)) {
          showToast(`Auto-cull: ${autoKeptCount} keeper${autoKeptCount === 1 ? '' : 's'}${autoDupCount ? `, ${autoDupCount} exact duplicate${autoDupCount === 1 ? '' : 's'} trashed` : ''}.`);
        }
        return;
      }
      // A manual edit or crop keeps the photo unchanged. Its optional advice
      // stays behind Auto > Suggest a look in the editor, never applied by this job.
      const targets = backgroundDevelopTargets(snapshot.frames, imported);
      if (editingRef.current && snapshot.selectedFrameId) targets.delete(snapshot.selectedFrameId);
      if (!targets.size) {
        if (autoKeptCount > 0 || autoDupCount > 0) {
          showToast(`Auto-cull: ${autoKeptCount} keeper${autoKeptCount === 1 ? '' : 's'}${autoDupCount ? `, ${autoDupCount} duplicate${autoDupCount === 1 ? '' : 's'} trashed` : ''}.`);
        }
        return;
      }
      const task = tasks.start('Developing untouched keepers', {
        total: targets.size, cancel: () => controller.abort(),
      });
      controller.signal.addEventListener('abort', () => { tasks.cancel(task.id); }, { once: true });
      try {
        const edits = await suggestKeeperAutoEdits(snapshot.frames, provider, controller.signal,
          (count) => task.progress(count), targets);
        if (!alive()) return;
        setCullingState((prev) => {
          if (prev.shoot.id !== projectId || controller.signal.aborted || !prev.settings?.autoEdit) return prev;
          const stillUntouched = backgroundDevelopTargets(prev.frames, targets);
          if (editingRef.current && prev.selectedFrameId) stillUntouched.delete(prev.selectedFrameId);
          const frames = applyKeeperAutoEdits(prev.frames, edits, Date.now(), stillUntouched);
          return frames.some((frame, index) => frame !== prev.frames[index])
            ? { ...prev, frames, shoot: { ...prev.shoot, lastUpdatedAt: Date.now() } } : prev;
        });
        task.finish(`${edits.size} starting looks prepared; existing manual edits preserved`);
        if (edits.size > 0 || autoKeptCount > 0) {
          showToast(
            `${autoKeptCount > 0 ? `Auto-cull kept ${autoKeptCount} · ` : ''}Auto-edited ${edits.size} keeper${edits.size === 1 ? '' : 's'} (Undo in History).`
          );
        }
      } catch (error) {
        if (!controller.signal.aborted) task.fail(error instanceof Error ? error.message : 'Auto Develop could not finish');
      }
    };
    void run().finally(() => {
      if (autoWorker.current?.controller !== controller) return;
      autoWorker.current = null;
      if (autoPendingIds.current.size) setAutoQueueTick((tick) => tick + 1);
    });
  }, [autoQueueTick, cullingState.shoot.id, can]);
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
      const pool = filterFrames(prev.frames, prev.filter, prev.searchQuery, prev.ratingFilter, prev.cameraFilter, prev.lensFilter, prev.tagFilter);
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

  const recordDownloadedEdits = (exported: readonly PhotoFrame[]) => {
    if (!exported.length) return;
    const at = Date.now();
    // Snapshot the actual frames sent to export, not potentially newer edits.
    const snapshots = new Map(exported.map((frame) => [frame.id, markExportRequested(frame, at).lastExport]));
    setCullingState((prev) => ({
      ...prev, shoot: { ...prev.shoot, lastUpdatedAt: at },
      frames: prev.frames.map((frame) => snapshots.has(frame.id)
        ? { ...frame, lastExport: snapshots.get(frame.id) } : frame),
    }));
  };

  // Tags and kind for any photo, from the editor or from the info pop-up.
  const setSubjects = (frame: PhotoFrame, tags: string[], subjectKind: SubjectKind | undefined) =>
    updateFrame(frame.id, { tags, subjectNames: [], subjectKind, ...reconcileAuto(frame, tags) });
  /** A small copy of a photo for the species model, drawn the way the camera held it. Null when the original is not available. */
  const loadSpeciesPicture = useCallback(async (frame: PhotoFrame): Promise<HTMLCanvasElement | null> => {
    const provider = previewProviderRef.current;
    const url = provider ? await provider.getFullPreviewUrl(frame) : '';
    if (!url) return null;
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    drawFramedPhoto(image, canvas, { ...DEFAULT_FRAMING, turns: frame.framing?.turns ?? 0 }, { scale: Math.min(1, 448 / Math.max(image.naturalWidth, image.naturalHeight)) });
    return canvas;
  }, []);
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

  const addVirtualCopy = (framing?: PhotoFraming, fromFrameId?: string) => {
    const sourceId = fromFrameId ?? selectedFrame?.id;
    if (!sourceId) return;
    const id = `copy-${newId()}`;
    setCullingState((prev) => {
      const index = prev.frames.findIndex((frame) => frame.id === sourceId);
      if (index < 0) return prev;
      const copy = createVirtualCopy(prev.frames[index], prev.frames, id);
      if (framing) { copy.framing = framing; copy.focusPoint = undefined; }
      const frames = [...prev.frames.slice(0, index + 1), copy, ...prev.frames.slice(index + 1)];
      const visible = filterFrames([copy], prev.filter, prev.searchQuery, prev.ratingFilter, prev.cameraFilter, prev.lensFilter, prev.tagFilter).length > 0;
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
      const visible = filterFrames(frames, prev.filter, prev.searchQuery, prev.ratingFilter, prev.cameraFilter, prev.lensFilter, prev.tagFilter);
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

  const autoAdjustSelected = async () => {
    if (autoAdjustController.current) return;
    // Snapshot the selection and project before analysing, so later clicks cannot
    // silently change the target set of an in-progress operation.
    const projectId = cullingState.shoot.id;
    const frames = cullingState.frames;
    const ids = new Set(selectedVisibleFrames.map((frame) => frame.id));
    const candidates = frames.filter((frame) => ids.has(frame.id) && !frame.removedAt && !frame.virtualCopy &&
      !frame.editHistory?.steps.length && (!frame.edit || isEmptyEdit(frame.edit))).length;
    if (!candidates) { setAutoAdjustSelectedOpen(false); return; }
    const controller = new AbortController();
    autoAdjustController.current = controller;
    const task = tasks.start('Auto-adjusting selected photos', { total: candidates, cancel: () => controller.abort() });
    setAutoAdjustSelectedOpen(false);
    try {
      const suggestions = await suggestKeeperAutoEdits(frames, previewProviderRef.current!, controller.signal,
        (count) => task.progress(count), ids);
      // Never apply results from a previous project or an aborted scan.
      if (controller.signal.aborted || stateRef.current.shoot.id !== projectId) {
        if (!controller.signal.aborted) task.finish('Project changed; no edits applied');
        return;
      }
      const at = Date.now();
      let applied = 0;
      setCullingState((prev) => {
        if (prev.shoot.id !== projectId) return prev;
        const nextFrames = applyKeeperAutoEdits(prev.frames, suggestions, at, ids);
        applied = nextFrames.filter((frame, i) => frame !== prev.frames[i]).length;
        return applied ? { ...prev, shoot: { ...prev.shoot, lastUpdatedAt: at }, frames: nextFrames } : prev;
      });
      task.finish(`${suggestions.size} photos analysed with usable adjustments`);
      showToast(`Auto-adjusted selected photos with usable previews. Original files unchanged.`);
    } catch (error) {
      if (controller.signal.aborted || task.cancelled) return;
      task.fail(error instanceof Error ? error.message : 'Could not auto-adjust the selection');
      showToast('Could not auto-adjust the selection. Nothing was changed.');
    } finally {
      if (autoAdjustController.current === controller) autoAdjustController.current = null;
    }
  };

  const autoAdjustKeepers = async () => {
    if (autoAdjustController.current) return;
    const projectId = cullingState.shoot.id;
    const frames = cullingState.frames;
    const candidates = previewKeeperLook(frames).eligible;
    const controller = new AbortController();
    autoAdjustController.current = controller;
    const task = tasks.start('Auto-adjusting keepers', { total: candidates, cancel: () => controller.abort() });
    setAutoAdjustOpen(false);
    try {
      const edits = await suggestKeeperAutoEdits(frames, previewProviderRef.current!, controller.signal,
        (count) => task.progress(count));
      if (controller.signal.aborted || stateRef.current.shoot.id !== projectId) {
        if (!controller.signal.aborted) task.finish('Project changed; no edits applied');
        return;
      }
      const at = Date.now();
      setCullingState((prev) => prev.shoot.id !== projectId ? prev : {
        ...prev, shoot: { ...prev.shoot, lastUpdatedAt: at },
        frames: applyKeeperAutoEdits(prev.frames, edits, at),
      });
      task.finish(`${edits.size} keepers adjusted`);
      showToast(`Auto-adjusted ${edits.size} keepers. Originals remain unchanged.`);
    } catch (error) {
      if (controller.signal.aborted || task.cancelled) return;
      task.fail(error instanceof Error ? error.message : 'Auto-adjust could not finish');
      showToast('Auto-adjust could not finish. No edits were applied.');
    } finally {
      if (autoAdjustController.current === controller) autoAdjustController.current = null;
    }
  };

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
      // Already handled by an open menu or dialog (for example Escape closing Workspace options).
      if (e.defaultPrevented) return;
      if (e.key === 'Escape' && showPhotoInfo) {
        setShowPhotoInfo(false);
        setInfoFrameId(undefined);
        infoTriggerRef.current?.focus();
        return;
      }
      const isModalOpen = openShootModal || macroPadModal;
      if (editing) {
        if (!isModalOpen && e.key === 'Escape') { setEditing(false); setEditQueueIds(null); setMultiSelect(false); setSelectedIds(new Set()); }
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
  const watchImportRef = useRef<(files: File[]) => Promise<number>>(async () => 0);
  const quickEditRef = useRef<(files: Array<File | PickedPhoto>) => Promise<void>>(async () => {});
  const handleSelectLocalFilesRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const onDroppedPhotos = useCallback((files: File[]) => { if (projectsOpen) void quickEditRef.current(files); else void droppedInProjectRef.current(files); }, [projectsOpen]);
  const drop = useDropPhotos(onDroppedPhotos);
  const watch = useFolderWatch(useCallback((files: File[]) => watchImportRef.current(files), []));
  // Watching belongs to the current project. Never silently import into another
  // project after switching workspaces or returning to the home screen.
  useEffect(() => { if (projectsOpen) watch.stop(); }, [projectsOpen, cullingState.shoot.id, watch.stop]);

  const handleSelectLocalFiles = async (picks: Array<File | PickedPhoto>, options?: { openEditor?: boolean; watched?: boolean; onImported?: (count: number) => void }) => {
    const targetProjectId = cullingState.shoot.id;
    const files = picks.map((pick) => (pick instanceof File ? pickedFromFile(pick) : pick));
    // A photo that was removed from the library does not count as already added, so adding it again brings it back.
    const existing = new Set(cullingState.frames.filter((frame) => !frame.removedAt).map((frame) => frame.stableKey));
    const additions = files.filter((file) => {
      const key = pickedKey(file);
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    if (!additions.length) {
      if (options?.openEditor) {
        // Quick edit of a photo that is already in Quick edits: open the one that is there.
        const present = cullingState.frames.find((frame) => !frame.removedAt && frame.stableKey === pickedKey(files[0]));
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
    // Imports appear in the task manager too (a watched folder has its own status, so it is left out).
    const task = options?.watched ? null : tasks.start(`Adding ${additions.length} photo${additions.length === 1 ? '' : 's'}`, { total: additions.length });
    try {
      const { frames, unstoredKeys, uncachedPreviewKeys, failedNames } = await loadLocalFileListShoot(
        additions, previewProviderRef.current!, storeRef.current!,
        ({ loaded, total }) => { setLoadingProgress({ loaded, total }); task?.progress(loaded, total); },
        { allowPartial: !options?.watched },
      );
      // Imports must never append photos to a different project if the user switches while they load.
      if (stateRef.current.shoot.id !== targetProjectId) {
        task?.finish('Project changed; photos were not added.');
        return;
      }
      if (!frames.length) {
        task?.fail('None of the selected photos could be read.');
        setProjectError('None of these photos could be read. Check file permissions or reconnect the drive, then try again. Your existing project is unchanged.');
        return;
      }
      task?.finish(failedNames.length ? `Added ${frames.length} photos; ${failedNames.length} could not be read.` : undefined);
      if (unstoredKeys.length) {
        setTemporaryOriginals((previous) => new Set([...previous, ...unstoredKeys]));
        setTemporaryWarningDismissed(false);
      }
      const warnings: string[] = [];
      if (failedNames.length) {
        const examples = failedNames.slice(0, 3).join(', ');
        warnings.push(`Added ${frames.length} photos, but could not read ${failedNames.length}: ${examples}${failedNames.length > 3 ? ', and others' : ''}. Check their source or drive permissions, then select them again. Your other photos were kept.`);
      }
      if (uncachedPreviewKeys.length) {
        warnings.push(`Could not save offline previews for ${uncachedPreviewKeys.length} ${uncachedPreviewKeys.length === 1 ? 'photo' : 'photos'}. The originals were not copied; reselect them or reconnect their folder when the source is unavailable.`);
      }
      if (warnings.length) setProjectError(warnings.join(' '));
      const importId = newId().slice(0, 8);
      setCullingState((prev) => {
        if (prev.shoot.id !== targetProjectId) return prev;
        const next = appendProjectPhotos(prev, frames, importId);
        const first = options?.openEditor ? next.frames.find((frame) => frame.id.startsWith(`${importId}-`)) : undefined;
        return first ? { ...next, filter: 'all', selectedFrameId: first.id } : next;
      });
      if (options?.openEditor) setEditing(true);
      enqueueBackgroundAuto(targetProjectId, frames.map((frame) => `${importId}-${frame.id}`));
      setPrefs((prev) => ({ ...prev, viewMode: 'grid' }));
      options?.onImported?.(frames.length);
    } catch {
      task?.fail('Could not add the photos.');
      setProjectError('Could not add the photos. Try selecting the files again.');
      if (options?.watched) throw new Error('Kestrel could not import the watched photos. They will be retried.');
    } finally {
      task?.fail('Stopped before it finished'); // does nothing if it finished
      setLoadingProgress(null);
    }
  };

  // Quick edit: open the Quick edits bucket, then import the chosen photos and go straight to the editor.
  const quickFiles = useRef<Array<File | PickedPhoto> | null>(null);
  async function quickEdit(files: Array<File | PickedPhoto>) {
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
    const targetProjectId = cullingState.shoot.id;
    // The desktop app never uses the browser's folder picker (it asks permission for "this website"): photos are linked from the disk.
    if (isDesktopApp()) {
      try {
        const chosen = await pickFolderNatively();
        if (chosen === 'cancelled') return;
        if (!chosen.length) { setFolderError('This folder has no supported photos.'); return; }
        await handleSelectLocalFiles(chosen);
      } catch { setFolderError('Could not read that folder.'); }
      return;
    }
    try {
      const picker = (window as Window & {
        showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker;
      if (!picker) return;
      const handle = await picker();
      const entries = await readFilesFromDirectoryHandle(handle);
      if (!entries.length) {
        setFolderError('This folder has no supported photos.');
        return;
      }

      const otherFolder = cullingState.frames.find((frame) =>
        frame.sourceKind === 'directory-handle' &&
        !frame.stableKey.startsWith(`folder://${handle.name}/`)
      );
      if (otherFolder) {
        setFolderError('Keep each folder in its own project so Kestrel can reconnect it safely.');
        return;
      }

      setOpenShootModal(false);
      setFolderError(null);
      setProjectError(undefined);
      setLoadingProgress({ loaded: 0, total: entries.length });
      const task = tasks.start(`Adding ${entries.length} photo${entries.length === 1 ? '' : 's'}`, { total: entries.length });
      try {
        const { frames } = await loadDirectoryHandleShoot(
          handle,
          previewProviderRef.current!,
          storeRef.current!,
          ({ loaded, total }) => { setLoadingProgress({ loaded, total }); task.progress(loaded, total); },
          { handleKey: targetProjectId, entries },
        );
        if (stateRef.current.shoot.id !== targetProjectId) {
          task.finish('Project changed; photos were not added.');
          return;
        }
        task.finish();
        const importId = newId().slice(0, 8);
        setCullingState((previous) => {
          if (previous.shoot.id !== targetProjectId) return previous;
          const next = appendProjectPhotos(previous, frames, importId);
          return {
            ...next,
            shoot: {
              ...next.shoot,
              folderName: handle.name,
              needsFolderRegrant: false,
              needsFileReselect: false,
            },
          };
        });
        enqueueBackgroundAuto(targetProjectId, frames.map((frame) => `${importId}-${frame.id}`));
        setPrefs((previous) => ({ ...previous, viewMode: 'grid' }));
      } catch {
        task.fail('Could not add the photos.');
        setProjectError('Could not add the folder. Try selecting it again.');
      } finally {
        task.fail('Stopped before it finished');
        setLoadingProgress(null);
      }
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
    const storedKeys: string[] = [];
    const unstoredKeys: string[] = [];
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
        if (!saved) { temporary += 1; unstoredKeys.push(key); }
        else storedKeys.push(key);
      }
      const missing = [...expected].filter((key) => !preview.hasBlob(key)).length;
      setRelinkStatus(recovered ? (missing ? `${missing} source ${missing === 1 ? 'file still needs' : 'files still need'} to be reselected.` : undefined) :
        'None of the selected files match the missing originals in this shoot.');
      if (!recovered) return;
      if (temporary || storedKeys.length) {
        setTemporaryOriginals((previous) => {
          const next = new Set(previous);
          for (const key of storedKeys) next.delete(key);
          for (const key of unstoredKeys) next.add(key);
          return next;
        });
        if (temporary) setTemporaryWarningDismissed(false);
      }
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
  const handleDroppedInProject = async (files: File[], watched = false): Promise<number> => {
    const preview = previewProviderRef.current!;
    const { reconnect, add } = splitDropped(files, cullingState.frames, getLocalFileKey, (key) => preview.hasBlob(key));
    if (reconnect.length) await reconnectFileSelection(reconnect);
    let imported = 0;
    if (add.length || !reconnect.length) {
      await handleSelectLocalFiles(add.length ? add : files, {
        watched, onImported: (count) => { imported = count; },
      });
    }
    return imported;
  };

  /** Desktop originals remain linked at their chosen location, never copied to IndexedDB. */
  const reconnectDesktopFolder = async () => {
    if (relinkingFiles.current) return;
    const projectId = cullingState.shoot.id;
    relinkingFiles.current = true;
    setRelinkStatus('Choose the folder containing your originals…');
    try {
      const [{ open }, fs] = await Promise.all([
        import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs'),
      ]);
      const folder = await open({ directory: true, multiple: false, title: 'Reconnect original photos' });
      if (typeof folder !== 'string') {
        setRelinkStatus(undefined);
        return;
      }
      const expected = new Map(cullingState.frames
        .filter((frame) => !frame.removedAt && frame.sourceKind === 'file' && frame.sourcePath)
        .map((frame) => [frame.stableKey, frame]));
      const expectedRecords = [...expected.values()].map((frame) => {
        const parts = frame.stableKey.split('::');
        return { stableKey: frame.stableKey, filename: frame.filename,
          size: Number(parts.at(-2)) || 0, lastModified: Number(parts.at(-1)) || 0 };
      });
      const scan = await scanOriginalFolder(folder, fs.readDir, fs.stat,
        new Set(expectedRecords.map((frame) => frame.filename.toLowerCase())));
      const { matches: replacements, ambiguous, approximate } = matchScannedOriginals(expectedRecords, scan.files);
      const recovered = replacements.size;
      if (stateRef.current.shoot.id !== projectId) return;
      const preview = previewProviderRef.current!;
      for (const [key, path] of replacements) {
        const frame = expected.get(key)!;
        const parts = key.split('::');
        preview.registerLinked(key, {
          read: linkedReader(path, frame.filename, Number(parts.at(-1)) || 0, Number(parts.at(-2)) || undefined),
          size: Number(parts.at(-2)) || 0, lastModified: Number(parts.at(-1)) || 0,
        });
        preview.retryLinkedOriginal(key);
      }
      const nextFrames = stateRef.current.frames.map((frame) =>
        replacements.has(frame.stableKey) ? { ...frame, sourcePath: replacements.get(frame.stableKey) } : frame);
      const paths = nextFrames.filter((frame) => !frame.removedAt && frame.sourceKind === 'file' && frame.sourcePath).map((frame) => frame.sourcePath!);
      const statuses = await checkOriginalPaths(paths, fs.stat);
      const remaining = nextFrames.filter((frame) => !frame.removedAt && frame.sourceKind === 'file' && frame.sourcePath && statuses.get(frame.sourcePath) !== 'available').length;
      if (stateRef.current.shoot.id !== projectId) return;
      setCullingState((previous) => previous.shoot.id !== projectId ? previous : {
        ...previous, frames: nextFrames,
        shoot: { ...previous.shoot, needsFileReselect: remaining > 0 },
      });
      setPreviewRevision((previous) => previous + 1);
      const details = [approximate.length ? `${approximate.length} matched by name and size because the file's modified time had changed.` : '', ambiguous.length ? `${ambiguous.length} ambiguous matches skipped.` : '',
        scan.truncated ? 'Folder scan reached its safety limit.' : '',
        scan.skippedDirectories ? `${scan.skippedDirectories} folders could not be scanned.` : ''].filter(Boolean).join(' ');
      setRelinkStatus((recovered
        ? `Reconnected ${recovered} original ${recovered === 1 ? 'photo' : 'photos'}.${remaining ? ` ${remaining} may still need reconnecting.` : ''}`
        : 'No matching originals found. Choose the folder containing the same files.') + (details ? ` ${details}` : ''));
    } catch {
      setRelinkStatus('Could not read that folder. Reconnect the drive or choose another folder.');
    } finally {
      relinkingFiles.current = false;
    }
  };

  const handleReconnectFolderOrFiles = async () => {
    const store = storeRef.current!;
    const preview = previewProviderRef.current!;
    const { shoot } = cullingState;

    if (shoot.needsFileReselect && !shoot.needsFolderRegrant) {
      if (isDesktopApp() && cullingState.frames.some((frame) => frame.sourcePath)) {
        await reconnectDesktopFolder();
        return;
      }
      relinkInput.current?.click();
      return;
    }
    if (!shoot.needsFolderRegrant) return;
    if (isDesktopApp()) { setRelinkStatus('This project was made in a browser. Add its photos again with Add photos > Choose folder.'); return; }
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
  // Photos opened from Finder or Explorer with Open With, or a double-click, go straight into Quick edit.
  useOpenedFiles((photos) => void quickEditRef.current(photos));
  handleSelectLocalFilesRef.current = (files) => handleSelectLocalFiles(files);
  droppedInProjectRef.current = async (files) => { await handleDroppedInProject(files); };
  watchImportRef.current = (files) => handleDroppedInProject(files, true);

  if (projectsOpen) {
    return <>
      <DesktopUpdate />
      <TaskManager />
      <DropOverlay dragging={drop.dragging} message={drop.message} onDismiss={drop.clearMessage} />
      <ProjectList projects={projects} photoText={photoText} loading={projectBusy} error={projectError}
        onOpen={(id) => void openProject(id)} onCreate={(name, options) => void newProject(name, options)} onRestore={(file) => void restoreBackup(file)}
        onArchive={(project) => setProjectAction({ kind: 'archive', project })} onDelete={(project) => setProjectAction({ kind: 'delete', project })}
        onUnarchive={(id) => void unarchiveProject(id)} onQuickEdit={(files) => void quickEdit(files)}
        editPanelSide={prefs.editPanelSide}
        onEditPanelSideChange={(side) => setPrefs((prev) => ({ ...prev, editPanelSide: side }))}
        onOpenMacroPad={() => { setMacroPadMode('cull'); setMacroPadModal(true); }} />
      <MacroPadModal open={macroPadModal} openTo={macroPadMode} onClose={() => setMacroPadModal(false)}
        bindings={prefs.bindings}
        onUpdateBinding={(commandId, chord) => setPrefs((prev) => ({
          ...prev, bindings: { ...prev.bindings, [commandId]: chord },
        }))}
        onResetBindings={() => setPrefs((prev) => ({ ...prev, bindings: DEFAULT_KEY_BINDINGS }))}
        knobMode={prefs.knobMode} onKnobModeChange={(mode) => setPrefs((prev) => ({ ...prev, knobMode: mode }))} />
      {projectAction && <ProjectActionDialog kind={projectAction.kind} project={projectAction.project}
        onBackup={() => backUpProject(projectAction.project.id)} onConfirm={() => void confirmProjectAction()} onCancel={() => setProjectAction(null)} />}
    </>;
  }

  return (
    <div className={`h-dvh max-h-dvh w-full max-w-full min-w-0 flex flex-col pb-[env(safe-area-inset-bottom)] bg-kestrel-canvas text-zinc-100 overflow-hidden ${editing ? '' : 'max-md:pb-[calc(3.5rem+env(safe-area-inset-bottom))]'}`}>
      {photoMenu && (() => {
        const frame = cullingState.frames.find((candidate) => candidate.id === photoMenu.frameId);
        if (!frame) return null;
        const ids = targetsFor(photoMenu.frameId, selectedIds, multiSelect);
        return <PhotoContextMenu x={photoMenu.x} y={photoMenu.y} label={ids.length > 1 ? `${ids.length} photos` : frame.filename}
          state={{ decision: frame.decision, count: ids.length, canPaste: Boolean(copiedEdit), hasEdit: Boolean(frame.edit), edited: ids.some((id) => { const target = cullingState.frames.find((candidate) => candidate.id === id); return Boolean(target && isEdited(target)); }) }}
          onChoose={choosePhotoAction} onClose={() => setPhotoMenu(null)} />;
      })()}
      <DesktopUpdate />
      <TaskManager />
      {locationsOpen && <ProjectLocationsDialog state={cullingState} onClose={() => setLocationsOpen(false)} />}
      {syncOpen && <SyncFolderDialog title={cullingState.shoot.title} projectId={cullingState.shoot.id} updatedAt={cullingState.shoot.lastUpdatedAt} frames={cullingState.frames} onClose={() => setSyncOpen(false)}
        onApply={(frames) => setCullingState((prev) => ({ ...prev, frames, shoot: { ...prev.shoot, lastUpdatedAt: Date.now() } }))} />}
      {watchOpen && <WatchFolderDialog onStart={(source, includeExisting) => void watch.start(source, includeExisting)} onClose={() => setWatchOpen(false)} />}
      {watch.status && <p role="status" className="fixed bottom-3 left-3 z-40 max-w-[calc(100vw-1.5rem)] rounded-xl border border-white/15 bg-kestrel-raised px-3 py-2 text-xs text-zinc-100 shadow-lg">{watch.status.error ?? `Watching “${watch.status.folder}” · ${watch.status.imported} new photo${watch.status.imported === 1 ? '' : 's'} added`}</p>}
      {paidDialog && (
        <div role="dialog" aria-modal="true" aria-label={`${paidDialog} is part of Kestrel Pro`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
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
          <button type="button" onClick={leaveEditor} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300" aria-label="Back" title="Back to photo library"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back</button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-300" title={selectedFrame?.filename}>{selectedFrame?.filename ?? 'Edit photo'}</h1>
          {multiSelect && selectedVisibleFrames.length > 0 && (
            <span className="shrink-0 text-xs tabular-nums text-zinc-300">{selectedVisibleFrames.length} selected</span>
          )}
          {!filmstripVisible && (
            <div className="flex shrink-0">
              <button type="button" aria-label="Previous photo" title="Previous photo" disabled={(editQueueIds ? editorIndex : selectedVisibleIndex) <= 0} onClick={() => handleStepFrame(-1)}
                className="h-11 w-11 rounded-md text-lg disabled:opacity-30">‹</button>
              <button type="button" aria-label="Next photo" title="Next photo" disabled={(editQueueIds ? editorIndex : selectedVisibleIndex) < 0 || (editQueueIds ? editorIndex >= editorFrames.length - 1 : selectedVisibleIndex >= visibleFrames.length - 1)} onClick={() => handleStepFrame(1)}
                className="h-11 w-11 rounded-md text-lg disabled:opacity-30">›</button>
            </div>
          )}
        </header>
      ) : <TopWorkspaceBar
        shoot={cullingState.shoot}
        counts={counts}
        filter={cullingState.filter}
        onFilterChange={changeFilter}
        ratingFilter={cullingState.ratingFilter ?? null}
        onRatingFilterChange={(next) =>
          setCullingState((prev) => {
            const nextVisible = filterFrames(prev.frames, prev.filter, prev.searchQuery, next, prev.cameraFilter, prev.lensFilter, prev.tagFilter);
            const stillVisible = nextVisible.some((f) => f.id === prev.selectedFrameId);
            return { ...prev, ratingFilter: next, selectedFrameId: stillVisible ? prev.selectedFrameId : nextVisible[0]?.id ?? null };
          })
        }
        searchQuery={cullingState.searchQuery}
        onSearchChange={(q) =>
          setCullingState((prev) => {
            const nextVisible = filterFrames(prev.frames, prev.filter, q, prev.ratingFilter, prev.cameraFilter, prev.lensFilter, prev.tagFilter);
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
        cameraFilter={cullingState.cameraFilter ?? null}
        onCameraFilterChange={(next) =>
          setCullingState((prev) => {
            const nextVisible = filterFrames(prev.frames, prev.filter, prev.searchQuery, prev.ratingFilter, next, prev.lensFilter, prev.tagFilter);
            const stillVisible = nextVisible.some((f) => f.id === prev.selectedFrameId);
            return { ...prev, cameraFilter: next, selectedFrameId: stillVisible ? prev.selectedFrameId : nextVisible[0]?.id ?? null };
          })
        }
        lensFilter={cullingState.lensFilter ?? null}
        onLensFilterChange={(next) =>
          setCullingState((prev) => {
            const nextVisible = filterFrames(prev.frames, prev.filter, prev.searchQuery, prev.ratingFilter, prev.cameraFilter, next, prev.tagFilter);
            const stillVisible = nextVisible.some((f) => f.id === prev.selectedFrameId);
            return { ...prev, lensFilter: next, selectedFrameId: stillVisible ? prev.selectedFrameId : nextVisible[0]?.id ?? null };
          })
        }
        tagFilter={cullingState.tagFilter ?? []}
        onTagFilterChange={(next) =>
          setCullingState((prev) => {
            const nextVisible = filterFrames(prev.frames, prev.filter, prev.searchQuery, prev.ratingFilter, prev.cameraFilter, prev.lensFilter, next);
            const stillVisible = nextVisible.some((f) => f.id === prev.selectedFrameId);
            return { ...prev, tagFilter: next, selectedFrameId: stillVisible ? prev.selectedFrameId : nextVisible[0]?.id ?? null };
          })
        }
        tagOptions={tagOptions}
        cameraOptions={cameraOptions}
        lensOptions={lensOptions}
        sortOrder={cullingState.sortOrder}
        onSortOrderChange={(next) => setCullingState((prev) => ({ ...prev, sortOrder: next }))}
        keeperTarget={cullingState.keeperTarget}
        onKeeperTargetChange={(target) =>
          setCullingState((prev) => ({ ...prev, keeperTarget: target }))
        }
        editPanelSide={prefs.editPanelSide}
        onEditPanelSideChange={(side) => setPrefs((prev) => ({ ...prev, editPanelSide: side }))}
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
        watching={watch.status?.folder ?? null}
        onWatchFolder={() => { if (watch.status) watch.stop(); else setWatchOpen(true); }}
        onSyncFolder={() => setSyncOpen(true)}
        onLocations={() => setLocationsOpen(true)}
        hand={prefs.hand}
        onHandChange={(hand) => setPrefs((prev) => ({ ...prev, hand, editPanelSide: hand }))}
        onAutoCull={() => { if (!can('smartCulling')) { setPaidDialog('Auto-cull'); return; } setAutoCullStart(false); setAutoCullOpen(true); }}
        settings={cullingState.settings ?? LEGACY_SETTINGS}
        onSettingsChange={(settings) => setCullingState((prev) => ({ ...prev, settings, shoot: { ...prev.shoot, lastUpdatedAt: Date.now() } }))}
        actionsDisabled={Boolean(loadingProgress) || projectBusy}
        onOpenMacroPadModal={() => { setMacroPadMode('cull'); setMacroPadModal(true); }}
        loadingProgress={loadingProgress}
        onToggleMultiSelect={() => {
          if (multiSelect) setSelectedIds(new Set());
          setMultiSelect(!multiSelect);
        }}
        multiSelect={multiSelect}
        focusMode={prefs.focusMode}
        onToggleFocusMode={() => {
          setShowPhotoInfo(false);
          setPrefs((prev) => ({ ...prev, focusMode: !prev.focusMode }));
        }}
        onBatchLook={previewKeeperLook(cullingState.frames).total > 0 ? () => setBatchLookOpen(true) : undefined}
        onAutoAdjustKeepers={!autoAdjustController.current && previewKeeperLook(cullingState.frames).eligible > 0 ? () => setAutoAdjustOpen(true) : undefined}
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
        onEditPhoto={selectedFrame && !loadingProgress ? () => { setEditQueueIds(null); setEditing(true); } : undefined}
      />}

      <input ref={relinkInput} type="file" hidden multiple accept={PHOTO_ACCEPT} data-testid="relink-file-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) void reconnectFileSelection(files);
          event.target.value = '';
        }}
      />
      <FolderRegrantBanner
        status={relinkStatus}
        visible={!editing && needsAccess && !bannerDismissed}
        mode={cullingState.shoot.needsFolderRegrant ? 'folder' : 'files'}
        folderName={cullingState.shoot.folderName}
        onReconnect={handleReconnectFolderOrFiles}
        onDismiss={() => setBannerDismissed(true)}
      />

      {/* Main Workspace Split */}
      {temporaryOriginals.size > 0 && !temporaryWarningDismissed && <div role="alert"
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-400/30 bg-amber-500/12 px-4 py-2 text-sm text-amber-100">
        <p>Kestrel could not store {temporaryOriginals.size === 1 ? 'one original' : `${temporaryOriginals.size} originals`} for reopening. You can use them now.
          Keep your original {temporaryOriginals.size === 1 ? 'file' : 'files'}: you may need to reselect {temporaryOriginals.size === 1 ? 'it' : 'them'} after reopening.
          Project backups do not include original photos.</p>
        <button type="button" className="min-h-11 px-2 underline" onClick={() => setTemporaryWarningDismissed(true)}>Dismiss</button>
      </div>}
      {backupNotice && <div className="flex items-center justify-between gap-2 border-b border-white/8 px-3 text-sm text-zinc-300">
        <p role="status">{backupNotice}</p>
        <button type="button" className="min-h-11 px-2" onClick={() => setBackupNotice(undefined)}>Dismiss</button>
      </div>}

      {projectError && <p role="alert" className="bg-orange-950 px-3 py-2 text-sm text-orange-100">{projectError}</p>}

      <main key={previewRevision} className="relative flex-1 flex min-h-0 min-w-0">
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {editing && selectedFrame && (
            <PhotoEditor
              initialTab={editorTab}
              onTabChange={setEditorTab}
              key={selectedFrame.id}
              onExportRequested={recordDownloadedEdits}
              exportCount={multiSelect && selectedVisibleFrames.length > 1 ? selectedVisibleFrames.length : 1}
              onExport={() => setExportFrames(multiSelect && selectedVisibleFrames.length > 1 ? selectedVisibleFrames : [selectedFrame])}
              onOpenMacroPad={() => { setMacroPadMode('edit'); setMacroPadModal(true); }}
              autoEdit={!!cullingState.settings?.autoEdit}
              frame={selectedFrame}
              bindings={prefs.bindings}
              provider={previewProviderRef.current!}
              needsAccess={needsAccess}
              onEdit={(edit) => {
                // Always update the active photo immediately so slider dragging remains fluid.
                updateFrame(selectedFrame.id, { edit: isEmptyEdit(edit) ? undefined : { ...edit } });
                cancelLinkedEdit();
                if (!editTogether || !multiSelect || selectedVisibleFrames.length < 2) return;
                const projectId = cullingState.shoot.id;
                const activeId = selectedFrame.id;
                const ids = new Set(selectedVisibleFrames.map((frame) => frame.id));
                const globalEdit = { ...edit, masks: undefined };
                pendingLinkedEdit.current = () => {
                  if (stateRef.current.shoot.id !== projectId) return;
                  const at = Date.now();
                  setCullingState((prev) => {
                    if (prev.shoot.id !== projectId) return prev;
                    let changed = false;
                    const frames = prev.frames.map((frame) => {
                      if (!ids.has(frame.id) || frame.id === activeId || frame.removedAt) return frame;
                      const nextEdit = { ...globalEdit, masks: frame.edit?.masks };
                      const next = recordEdit(frame, { edit: isEmptyEdit(nextEdit) ? undefined : nextEdit }, at);
                      if (next !== frame) changed = true;
                      return next;
                    });
                    return changed ? { ...prev, frames, shoot: { ...prev.shoot, lastUpdatedAt: at } } : prev;
                  });
                };
                linkedEditTimer.current = setTimeout(flushLinkedEdit, 250);
              }}
              onApplyLook={(look) => {
                const ids = new Set(multiSelect ? selectedVisibleFrames.map((frame) => frame.id) : []);
                if (ids.size < 2) {
                  updateFrame(selectedFrame.id, { edit: isEmptyEdit(look) ? undefined : { ...look } });
                  return;
                }
                const at = Date.now();
                // Applying a named look is an explicit batch action. Never copy the
                // active photo's local masks onto another selected photograph.
                const globalLook = { ...look, masks: undefined };
                setCullingState((prev) => ({ ...prev,
                  shoot: { ...prev.shoot, lastUpdatedAt: at },
                  frames: applySelectedLook(prev.frames, ids, globalLook, true, at),
                }));
              }}
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
              hand={prefs.hand}
              onHandChange={(hand) => setPrefs((prev) => ({ ...prev, hand, editPanelSide: hand }))}
              showFilmstrip={filmstripVisible}
              keeperCount={counts.keep}
              onApplyToKeepers={applyEditToKeepers}
              onUndoKeeperEdits={batchUndo ? undoKeeperEdits : undefined}
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

          {!editing && multiSelect && (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-white/10 bg-[#15171C] px-2 text-sm">
              <span>{selectedIds.size} selected</span>
              <div className="flex flex-wrap items-center gap-x-1">
              <button type="button" disabled={!selectedVisibleFrames.length} className="min-h-11 px-2 text-sky-200 disabled:opacity-40"
                onClick={() => setExportFrames(selectedVisibleFrames)}>
                Export selected
              </button>
              <button type="button" disabled={!selectedVisibleFrames.length} className="min-h-11 px-2 text-sky-200 disabled:opacity-40"
                onClick={() => setSelectionLookOpen(true)}>Apply look</button>
              <button type="button" disabled={!!autoAdjustController.current} onClick={() => setAutoAdjustSelectedOpen(true)}
                className="min-h-11 rounded-md border border-white/15 px-2 text-xs font-medium hover:bg-white/10 disabled:opacity-40">Auto-adjust selected</button>
              <button type="button" disabled={!selectedVisibleFrames.length} className="min-h-11 px-2 text-sky-200 disabled:opacity-40"
                onClick={startSelectedEditing}>Edit selected</button>
              <button type="button" disabled={!selectedVisibleFrames.length} className="min-h-11 px-2 text-orange-200 disabled:opacity-40"
                onClick={() => setPendingAction({ kind: 'trash', frameIds: selectedVisibleFrames.map((frame) => frame.id), allowAdvance: false })}>Trash selected</button>
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
          {loadingProgress && <ImportProgress loaded={loadingProgress.loaded} total={loadingProgress.total} />}
          {!editing && !cullingState.shoot.inbox && !loadingProgress && guidedDismissedFor !== cullingState.shoot.id &&
            ((guided === 'reviewing' && cullingState.filter === 'unreviewed') ||
             ((guided === 'improving' || guided === 'ready') && cullingState.filter === 'keep')) && (
            <GuidedBanner step={guided} unreviewed={counts.unreviewed} keepers={counts.keep} decided={counts.all - counts.unreviewed} uneditedKeepers={uneditedKeepers}
              onFindBestPhotos={() => {
                if (!can('smartCulling')) { setPaidDialog('Auto-cull'); return; }
                setAutoCullStart(true);
                setAutoCullOpen(true);
              }}
              onReviewMyself={() => changeFilter('unreviewed')}
              onSeeSuggestedEdits={() => setAutoAdjustOpen(true)}
              onEditMyself={() => changeFilter('keep')}
              onExportKeepers={() => setExportFrames(cullingState.frames.filter((frame) => !frame.removedAt && frame.decision === 'keep'))}
              onDismiss={() => setGuidedDismissedFor(cullingState.shoot.id)} />
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
              onPhotoMenu={openPhotoMenu}
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
              onOpenMenu={(x, y) => selectedFrame && openPhotoMenu(selectedFrame.id, x, y)}
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
              className={`mobile-toolbar-scroll flex min-w-0 max-w-full shrink-0 items-center gap-1 overflow-x-auto border-t border-white/10 bg-kestrel-panel px-2 ${filmstripVisible ? (prefs.editPanelSide === 'left' ? 'workspace:pl-[calc(var(--editor-panel-w,0px)+0.5rem)]' : 'workspace:pr-[var(--editor-panel-w,0px)]') : ''}`}>
              <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-white/10"
                onClick={() => { setCopiedEdit(selectedFrame.edit ?? DEFAULT_EDIT); showToast('Adjustments copied'); }}>
                <Copy className="h-4 w-4" aria-hidden="true" /> Copy
              </button>
              {!multiSelect && <button type="button" disabled={!copiedEdit} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-white/10 disabled:opacity-40"
                onClick={() => { if (copiedEdit) { updateFrame(selectedFrame.id, { edit: isEmptyEdit(copiedEdit) ? undefined : { ...copiedEdit } }); showToast('Adjustments pasted'); } }}>
                <ClipboardPaste className="h-4 w-4" aria-hidden="true" /> Paste
              </button>}
              <button type="button" aria-pressed={multiSelect} className="inline-flex min-h-11 items-center rounded-md px-2 text-xs hover:bg-white/10"
                onClick={() => {
                  cancelLinkedEdit();
                  flushLinkedEdit();
                  setEditTogether(false);
                  if (multiSelect) { setMultiSelect(false); setSelectedIds(new Set()); }
                  else { setMultiSelect(true); setSelectedIds(new Set([selectedFrame.id])); }
                }}>{multiSelect ? 'Done selecting' : 'Select photos'}</button>
              {multiSelect && <>
                {selectedVisibleFrames.length > 1 && <button type="button" aria-pressed={editTogether}
                  onClick={() => { flushLinkedEdit(); setEditTogether((value) => !value); }}
                  className={`min-h-11 rounded-md border px-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-sky-300 ${editTogether ? 'border-sky-200 bg-white/15' : 'border-white/15 hover:bg-white/10'}`}>
                  {editTogether ? 'Editing together ✓' : 'Edit together'}
                </button>}
                <span role="status" className="shrink-0 text-xs text-zinc-300">{selectedVisibleFrames.length} selected</span>
                <button type="button" disabled={!selectedVisibleFrames.length} className="min-h-11 rounded-md px-2 text-xs hover:bg-white/10 disabled:opacity-40"
                  onClick={() => setSelectionLookOpen(true)}>Apply look</button>
                <button type="button" disabled={!!autoAdjustController.current} className="min-h-11 rounded-md px-2 text-xs hover:bg-white/10 disabled:opacity-40"
                  onClick={() => setAutoAdjustSelectedOpen(true)}>Auto-adjust</button>
                <button type="button" disabled={!selectedVisibleFrames.length || !copiedEdit} className="min-h-11 rounded-md px-2 text-xs hover:bg-white/10 disabled:opacity-40"
                  onClick={() => setConfirmPasteSelection(true)}>Paste to selected</button>
                <button type="button" disabled={!selectedVisibleFrames.length} className="min-h-11 rounded-md px-2 text-xs text-orange-200 hover:bg-white/10 disabled:opacity-40"
                  onClick={() => setPendingAction({ kind: 'trash', frameIds: selectedVisibleFrames.map((frame) => frame.id) })}>Trash</button>
              </>}
              <button type="button" aria-pressed={filmstripVisible} className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-white/10"
                onClick={() => setPrefs((prev) => ({ ...prev, showFilmstrip: !filmstripVisible, focusMode: false }))}>
                {filmstripVisible ? <PinOff className="h-4 w-4" aria-hidden="true" /> : <Pin className="h-4 w-4" aria-hidden="true" />}
                {filmstripVisible ? 'Hide filmstrip' : 'Pin filmstrip'}
              </button>
            </div>
          )}
          {/* Persistent Filmstrip in Loupe & Compare Modes */}
          {filmstripVisible && (editing || prefs.viewMode !== 'grid') && visibleFrames.length > 0 && (
            <div className={editing ? (prefs.editPanelSide === 'left' ? 'workspace:pl-[var(--editor-panel-w,0px)]' : 'workspace:pr-[var(--editor-panel-w,0px)]') : undefined}>
            <Filmstrip
              onPhotoMenu={openPhotoMenu}
              frames={editing ? editorFrames : visibleFrames}
              selectedFrameId={selectedFrame?.id ?? null}
              compareRightFrameId={compareRightFrame?.id ?? null}
              isCompareMode={!editing && visibleFrames.length > 0 && prefs.viewMode === 'compare'}
              previewProvider={previewProviderRef.current!}
              needsAccess={needsAccess}
              onSelectFrame={handleSelectFrame}
              markedIds={selectedIds}
              multiSelect={multiSelect}
              onSelectMarked={selectGridPhoto}
              onSelectCompareRight={(id) =>
                setCullingState((prev) => ({ ...prev, compareRightFrameId: id }))
              }
            />
            </div>
          )}
        </div>

        {!editing && showPhotoInfo && (
          <ExifInspector onSubjects={(frame, tags, kind) => setSubjects(frame, tags, kind)} onKeepTag={(frame, name) => keepTag(frame, name)}
            loadPicture={loadSpeciesPicture}
            mates={burstMates(cullingState.frames, infoFrameId ? cullingState.frames.find((frame) => frame.id === infoFrameId) ?? { id: '', burstGroupId: null } : selectedFrame ?? { id: '', burstGroupId: null })}
            onTagPhotos={(ids, name, kind) => setCullingState((prev) => ({ ...prev, shoot: { ...prev.shoot, lastUpdatedAt: Date.now() }, frames: tagFrames(prev.frames, ids, name, kind) }))}
            onAutoTag={(frame, name, kind) => {
              // The species-only model must never manufacture wildlife classification.
              if (frame.subjectKind === 'wildlife' && kind === 'wildlife' && mayAutoTag(frame, name))
                updateFrame(frame.id, applyAutoTag(frame, name));
            }} onRate={(id, rating) => rateOrFlagPhotos(id, { rating })}
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

      {autoAdjustSelectedOpen && <ConfirmDialog title="Auto-adjust selected photos?" confirmLabel="Analyse selected photos"
        cancelLabel="Cancel" onCancel={() => setAutoAdjustSelectedOpen(false)}
        confirmDisabled={!selectedVisibleFrames.some((frame) => !frame.removedAt && !frame.virtualCopy &&
          !frame.editHistory?.steps.length && (!frame.edit || isEmptyEdit(frame.edit)))}
        onConfirm={() => void autoAdjustSelected()}>
        <p>Each selected photo gets its own local light and colour adjustments. These are not the same preset applied to everyone.</p>
        <p>Already-edited photos are protected. Missing or damaged previews will be skipped; you can cancel before changes are applied.</p>
        <p>Originals, masks and crops remain untouched. Per-photo edit history supports undo.</p>
      </ConfirmDialog>}
      {selectionLookOpen && <SelectionLookDialog frames={cullingState.frames} ids={new Set(selectedVisibleFrames.map((frame) => frame.id))}
        onClose={() => setSelectionLookOpen(false)} onApply={(look, includeEdited) => {
          const at = Date.now();
          const ids = new Set(selectedVisibleFrames.map((frame) => frame.id));
          setCullingState((prev) => ({ ...prev, frames: applySelectedLook(prev.frames, ids, look, includeEdited, at),
            shoot: { ...prev.shoot, lastUpdatedAt: at } }));
          showToast(`Applied a look to ${previewSelectedLook(cullingState.frames, ids, includeEdited).eligible} selected photos.`);
        }} />}
      {confirmPasteSelection && <ConfirmDialog title={`Paste adjustments to ${selectedVisibleFrames.length} photos?`}
        confirmLabel="Apply adjustments" cancelLabel="Cancel" onCancel={() => setConfirmPasteSelection(false)}
        onConfirm={pasteToSelection}>
        <p>Copy the current global slider adjustments to these photos. Each photo keeps its existing crop and local masks.</p>
        <p>Original files are never modified. The edit history on each photo lets you undo the change.</p>
      </ConfirmDialog>}
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
        autoEditEnabled={Boolean(cullingState.settings?.autoEdit && can('autoTab'))}
        onApply={(results) => {
          const nextState = applyAutoCullDecisions(stateRef.current, results);
          setCullingState((previous) => applyAutoCullDecisions(previous, results));
          const keptIds = new Set(results.filter((r) => r.decision === 'keep').map((r) => r.frameId));
          if (keptIds.size && stateRef.current.settings?.autoEdit && can('autoTab')) {
            const targets = backgroundDevelopTargets(nextState.frames, keptIds);
            if (targets.size && !autoAdjustController.current) {
              const projectId = nextState.shoot.id;
              const controller = new AbortController();
              autoAdjustController.current = controller;
              const task = tasks.start('Developing chosen keepers', { total: targets.size, cancel: () => controller.abort() });
              void suggestKeeperAutoEdits(nextState.frames, previewProviderRef.current!, controller.signal,
                (count) => task.progress(count), targets)
                .then((edits) => {
                  if (controller.signal.aborted || stateRef.current.shoot.id !== projectId) return;
                  const at = Date.now();
                  setCullingState((prev) => {
                    if (prev.shoot.id !== projectId) return prev;
                    const stillUntouched = backgroundDevelopTargets(prev.frames, targets);
                    const frames = applyKeeperAutoEdits(prev.frames, edits, at, stillUntouched);
                    return frames.some((f, idx) => f !== prev.frames[idx])
                      ? { ...prev, shoot: { ...prev.shoot, lastUpdatedAt: at }, frames }
                      : prev;
                  });
                  task.finish(`${edits.size} keepers auto-edited`);
                  if (edits.size > 0) {
                    showToast(`Kept ${keptIds.size} photo${keptIds.size === 1 ? '' : 's'} · Auto-edited ${edits.size} keeper${edits.size === 1 ? '' : 's'}.`);
                  }
                })
                .catch(() => { if (!controller.signal.aborted) task.fail('Auto-edit could not finish'); })
                .finally(() => { if (autoAdjustController.current === controller) autoAdjustController.current = null; });
            }
          }
        }}
        onScanned={(results) => setCullingState((previous) => applyCullConfidence(previous, results))}
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
        onShowCollection={(filter) => {
          // One simple jump: close the dialog and look at the keepers (or what is left to decide) as a grid.
          setAutoCullOpen(false);
          setPrefs((previous) => ({ ...previous, viewMode: 'grid' }));
          setCullingState((previous) => ({ ...previous, filter, searchQuery: '', selectedFrameId: previous.frames.find((frame) => !frame.removedAt && frame.decision === filter)?.id ?? previous.selectedFrameId }));
        }}
        onClose={() => setAutoCullOpen(false)} />}

      {autoAdjustOpen && <ConfirmDialog title="Auto-adjust unedited keepers?" confirmLabel="Auto-adjust keepers" cancelLabel="Cancel"
        onConfirm={() => void autoAdjustKeepers()} onCancel={() => setAutoAdjustOpen(false)}>
        <p>Kestrel will analyse each unedited keeper locally and adjust its light, colour and tone. Already edited photos stay unchanged.</p>
        <p>{previewKeeperLook(cullingState.frames).eligible} keepers are eligible. The task can be cancelled. No changes are applied until the scan finishes.</p>
        <p>Nothing is uploaded or modified in your original files. You can undo the result for each photo.</p>
      </ConfirmDialog>}
      {batchLookOpen && <BatchLookDialog frames={cullingState.frames} onClose={() => setBatchLookOpen(false)}
        onApply={(look, includeEdited) => {
          const at = Date.now();
          setCullingState((prev) => ({ ...prev, shoot: { ...prev.shoot, lastUpdatedAt: at },
            frames: applyKeeperLook(prev.frames, look, includeEdited, at) }));
        }} />}
      {exportFrames.length > 0 && <PhotoExportPanel onDownloadRequested={recordDownloadedEdits} frames={exportFrames} provider={previewProviderRef.current!}
        exportPlace={exportPlaceFor(cullingState.shoot.id)}
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
