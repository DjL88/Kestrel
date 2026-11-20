import { isDesktopApp } from './providers/desktopShell';
import { appText as t } from './i18n/areas/app';
import { messages } from './i18n/messages';
import { useOpenedFiles } from './providers/useOpenedFiles';
import { pickFolderNatively, pickedFromFile, pickedKey, linkedReader, linkedRangeOpener, type PickedPhoto } from './providers/linkedOriginals';
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
import { PhotoContextMenu } from './components/PhotoContextMenu';
import { ratingFor, targetsFor, type PhotoAction } from './core/photoMenu';
import { DropOverlay } from './components/DropOverlay';
import { useDropPhotos } from './providers/useDropPhotos';
import { DesktopUpdate } from './components/DesktopUpdate';
import { useDesktopMenu } from './providers/useDesktopMenu';
import { OnlineHelperDialog } from './components/OnlineHelperDialog';
import { useSpeciesScan } from './useSpeciesScan';
import { useBackgroundDevelop } from './useBackgroundDevelop';
import { SpeciesScanBanner } from './components/SpeciesScanBanner';
import type { SubjectKind } from './core/subjectTags';
import { applyAutoTag, keepAuto, mayAutoTag, reconcileAuto } from './core/autoTags';
import { burstMates, tagFrames } from './core/speciesBurst';
import { loadImage } from './providers/loadImage';
import { DEFAULT_FRAMING, drawFramedPhoto } from './core/photoFraming';
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, ClipboardPaste, Info, PanelLeftClose, PanelLeftOpen, Maximize2 } from 'lucide-react';
import { WorkspacePaneRail } from './components/WorkspacePaneRail';
import { PHOTO_INFO_DOCK_QUERY } from './core/photoInfoLayout';
import { PhotoJump } from './components/PhotoJump';
import { SettingsButton } from './components/SettingsButton';
import { AppearanceDialog } from './components/AppearanceDialog';
import { photoInfoDockSide, readWorkspacePaneState, toggleWorkspacePanes, writeWorkspacePaneState } from './core/workspacePaneState';
import { newId } from './core/ids';
import { redoLabel, undoLabel } from './core/describeAction';
import { jumpToStep, recordEdit, stepEdit } from './core/editHistory';
import { markExportRequested } from './core/compareStages';
import { AutoCullPanel } from './components/AutoCullPanel';
import { scanForCulling } from './providers/browserAutoCull';
import { createImportCullPreflight, type ImportCullPreflight } from './providers/importCullPreflight';
import { settleImportObservation } from './core/importCullHandoff';
import type { ImportCullCache } from './core/importCullCache';
import { limitAutoKeepers } from './core/autoCull';
import { backgroundCullCandidates, backgroundCullMoves, backgroundDevelopTargets } from './core/backgroundAutoPolicy';
import { beginCullScan, advanceCullScan, endCullScan, type CullScanProgress } from './core/cullScanProgress';
import { commitCompletedAutoResult } from './core/progressiveAutoCommit';
import { prioritizePhotoProcessing } from './core/photoProcessingOrder';
import { GuidedBanner } from './components/GuidedBanner';
import { guidedStep, remainingWereScanned } from './core/guidedProgress';
import { BatchLookDialog } from './components/BatchLookDialog';
import { SelectionLookDialog } from './components/SelectionLookDialog';
import { applySelectedLook, previewSelectedLook } from './core/selectedLooks';
import { suggestKeeperAutoEdits, applyKeeperAutoEdits } from './providers/batchAutoEdit';
import { tasks, type TaskHandle } from './core/taskStore';
import { applyKeeperLook, previewKeeperLook } from './core/batchLooks';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { restoreProjectBackup } from './core/projectBackup';
import { saveProjectBackupFile } from './providers/projectBackupFile';
import { ProjectList } from './components/ProjectList';
import { INBOX_ID, appendProjectPhotos, applyImportBursts, createEmptyProject, createInboxProject, moveFrames, setArchived } from './core/projects';
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
import { FilmstripDock } from './components/FilmstripDock';
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
  linkedOriginalsAvailable,
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
  // Hand and editing-panel side are one choice now. Settings saved when they could differ follow the hand.
  useEffect(() => {
    if (prefs.editPanelSide !== prefs.hand) setPrefs((prev) => (prev.editPanelSide === prev.hand ? prev : { ...prev, editPanelSide: prev.hand }));
  }, [prefs.hand, prefs.editPanelSide]);
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
  /** Culling keeps running with its panel out of the way, so the rest of the app can be used. */
  const [autoCullHidden, setAutoCullHidden] = useState(false);
  // Suggestions belong to one project: opening another one closes any cull of the previous project.
  useEffect(() => { setAutoCullOpen(false); setAutoCullHidden(false); }, [cullingState.shoot.id]);
  /** The guided "what's next" banner, dismissed for one project at a time. Resets on reload or when a different project opens. */
  const [guidedDismissedFor, setGuidedDismissedFor] = useState<string | null>(null);
  const [exportFrames, setExportFrames] = useState<PhotoFrame[]>([]);
  const [showPhotoInfo, setShowPhotoInfo] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHOTO_INFO_DOCK_QUERY).matches);
  // Settings (display, preferred hand, keyboard and macro pad): one dialog, opened from the top right of every page.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Section F: a workspace layout belongs to the device, not to each photo,
  // project, synced catalogue or editor tab. A private-storage failure is safe.
  const [workspacePanes, setWorkspacePanes] = useState(readWorkspacePaneState);
  useEffect(() => { writeWorkspacePaneState(workspacePanes); }, [workspacePanes]);
  const togglePanes = () => setWorkspacePanes(toggleWorkspacePanes);
  const panesCollapsed = workspacePanes.folded;
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
    /** Still looking through the chosen folder, so the number of photos is not known yet. */
    finding?: boolean;
  } | null>(null);
  /** The one import that may run at a time, and how to stop it. A second import would duplicate photos still in flight. */
  const importRef = useRef<{ projectId: string; controller: AbortController } | null>(null);
  // Prevent new import batches from being committed once project navigation begins.
  const leavingRef = useRef(false);
  // A cancelled import remains retired even if the same project is reopened before its I/O settles.
  const retiredImportsRef = useRef(new WeakSet<AbortController>());
  const stopImport = useCallback(() => { importRef.current?.controller.abort(); }, []);
  const projectsOpenRef = useRef(projectsOpen);
  projectsOpenRef.current = projectsOpen;
  const claimedBy = (claim: { controller: AbortController } | null, controller: AbortController) => claim?.controller === controller;

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
        if (active) setProjectError(t.projects.catalogueUnavailable);
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
      setProjectError(t.projects.saveFailed);
    });
  }, [cullingState, projectsOpen]);
  // Back the open project up on its own to the place chosen for it (if any), without waiting to be asked.
  useAutoBackup(cullingState, !projectsOpen);

  function enterProject(state: CullingState) {
    const filter = state.shoot.inbox ? 'all' : state.filter === 'all' ? 'unreviewed' : state.filter;
    const visible = filterFrames(state.frames, filter, state.searchQuery, state.ratingFilter, state.cameraFilter, state.lensFilter);
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
    setShowPhotoInfo(window.matchMedia(PHOTO_INFO_DOCK_QUERY).matches);
    setMultiSelect(false);
    setSelectedIds(new Set());
    setBatchUndo(null);
    setRelinkStatus(undefined);
    setFolderError(null);
    setBannerDismissed(false);
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
    setPrefs((prev) => ({ ...prev, viewMode: 'grid' }));
    leavingRef.current = false;
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
      // Open at once; whether linked originals are still on disk is checked just after, in the background.
      shoot.needsFileReselect = !await rehydrateLocalFramesFromStore(localFrames, preview, store, { checkPaths: false });

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
      if (!shoot.needsFileReselect && localFrames.some((frame) => frame.sourcePath)) {
        void linkedOriginalsAvailable(localFrames).then((available) => {
          if (available) return;
          // Only flag the project that was checked, if it is still open; nothing in the catalogue is changed.
          setCullingState((previous) => (previous.shoot.id !== shoot.id || previous.shoot.needsFileReselect ? previous
            : { ...previous, shoot: { ...previous.shoot, needsFileReselect: true } }));
        }, () => { /* a failed check is not proof of a missing original; Reconnect stays available */ });
      }
    } catch {
      setProjectError(t.projects.openFailed);
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
      setProjectError(action.kind === 'delete' ? t.projects.deleteFailed : t.projects.archiveFailed);
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
      setProjectError(t.projects.unarchiveFailed);
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
      setProjectError(t.projects.createFailed);
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
      setProjectError(reason instanceof Error ? reason.message : t.projects.restoreFailed);
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
        t.backup.saved :
        t.backup.downloaded);
    } catch {
      setProjectError(t.backup.failed);
    }
  }

  async function backToProjects() {
    const store = storeRef.current!;
    setProjectBusy(true);
    setProjectError(undefined);
    // Freeze incoming results *before* the asynchronous save. Otherwise an in-flight
    // import batch may be added after the saved project snapshot has been taken.
    leavingRef.current = true;
    if (importRef.current) retiredImportsRef.current.add(importRef.current.controller);
    stopImport();
    autoWorker.current?.controller.abort();
    autoPendingIds.current.clear();
    setAutoCullOpen(false);
    setAutoCullHidden(false);
    try {
      await store.saveProject(stateRef.current);
      setProjects(await store.listProjects());
      setProjectsOpen(true);
    } catch {
      leavingRef.current = false;
      setProjectError(t.projects.leaveFailed);
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
      const nextVisible = filterFrames(prev.frames, next, prev.searchQuery, prev.ratingFilter, prev.cameraFilter, prev.lensFilter);
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
          cullingState.lensFilter
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
      cullingState.sortOrder,
    ]
  );

  /** Distinct cameras and lenses seen in this project, for the Filter control's pickers. Sorted for a stable list. */
  const cameraOptions = useMemo(
    () => [...new Set(cullingState.frames.flatMap((frame) => frame.exif.camera ? [frame.exif.camera] : []))].sort(),
    [cullingState.frames]
  );
  const lensOptions = useMemo(
    () => [...new Set(cullingState.frames.flatMap((frame) => frame.exif.lens ? [frame.exif.lens] : []))].sort(),
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
    // Preserve loupe zoom and pan as photos are stepped through, as in the
    // shared editor. Fit remains an explicit action rather than a forced reset.
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
        const currentVisible = filterFrames(prev.frames, prev.filter, prev.searchQuery, prev.ratingFilter, prev.cameraFilter, prev.lensFilter);
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
  // Editing is another view onto the same selection, not a destructive navigation.
  // Keep review marks and selected photo IDs when returning to Library/Review.
  const leaveEditor = () => { flushLinkedEdit(); setEditing(false); setEditQueueIds(null); setEditTogether(false); };

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
    showToast(t.toasts.pastedToSelection(ids.size));
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
      case 'copy': { const frame = chosen[0]; if (frame) { setCopiedEdit(frame.edit ?? DEFAULT_EDIT); showToast(t.toasts.adjustmentsCopied); } break; }
      case 'paste': {
        if (!copiedEdit || !chosen.length) break;
        const at = Date.now();
        const target = new Set(chosen.map((frame) => frame.id));
        // Global adjustments only: each photo keeps its own masks and framing, and each paste is one undo step.
        setCullingState((prev) => ({ ...prev, shoot: { ...prev.shoot, lastUpdatedAt: at },
          frames: prev.frames.map((frame) => (target.has(frame.id) ? recordEdit(frame, { edit: { ...copiedEdit, masks: frame.edit?.masks } }, at) : frame)) }));
        showToast(t.toasts.pastedAdjustments(chosen.length));
        break;
      }
      case 'reset': requestReset(ids); break;
      case 'duplicate': addVirtualCopy(undefined, menu.frameId); showToast(t.toasts.virtualCopy); break;
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
        showToast(result.skipped ? t.toasts.alreadyInProject : t.toasts.nothingToMove);
        return;
      }
      await store.saveProjects([result.source, result.target]);
      setCullingState(result.source);
      setSelectedIds(new Set());
      setMultiSelect(false);
      showToast(t.toasts.moved(result.moved, target.shoot.title, result.skipped));
    } catch {
      showToast(t.toasts.moveFailed);
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
  const autoPendingCullPreflight = useRef<ImportCullPreflight | null>(null);
  const autoWorker = useRef<{ projectId: string; controller: AbortController } | null>(null);
  const [autoQueueTick, setAutoQueueTick] = useState(0);
  const scanRunSequence = useRef(0);
  const [liveCullScan, setLiveCullScan] = useState<CullScanProgress | null>(null);
  function enqueueBackgroundAuto(projectId: string, ids: readonly string[], preflight?: ImportCullPreflight) {
    if (!ids.length) return;
    if (autoPendingProject.current !== projectId) {
      autoWorker.current?.controller.abort();
      autoPendingProject.current = projectId;
      autoPendingIds.current.clear();
      autoPendingCullPreflight.current?.abort();
      autoPendingCullPreflight.current = null;
    }
    ids.forEach((id) => autoPendingIds.current.add(id));
    if (preflight) autoPendingCullPreflight.current = preflight;
    setAutoQueueTick((tick) => tick + 1);
  }

  useEffect(() => {
    if (autoWorker.current?.projectId !== cullingState.shoot.id) autoWorker.current?.controller.abort();
    if (autoPendingProject.current !== cullingState.shoot.id) {
      autoPendingIds.current.clear();
      autoPendingCullPreflight.current?.abort();
      autoPendingCullPreflight.current = null;
    }
  }, [cullingState.shoot.id]);
  useEffect(() => () => { autoWorker.current?.controller.abort(); }, []);

  useEffect(() => {
    const projectId = cullingState.shoot.id;
    if (autoWorker.current || autoPendingProject.current !== projectId || !autoPendingIds.current.size) return;
    const imported = new Set(autoPendingIds.current);
    autoPendingIds.current.clear();
    const pendingPreflight = autoPendingCullPreflight.current;
    autoPendingCullPreflight.current = null;
    const controller = new AbortController();
    autoWorker.current = { projectId, controller };
    const alive = () => !controller.signal.aborted && stateRef.current.shoot.id === projectId;
    let preflightCache: ImportCullCache | undefined;
    const run = async () => {
      // Optional model observation must not hold the completed import hostage.
      // Only the final background cull waits before resetting the detector.
      preflightCache = await settleImportObservation(pendingPreflight ?? undefined, controller.signal);
      const provider = previewProviderRef.current!;
      let snapshot = stateRef.current;
      if (!alive()) return;
      if (snapshot.settings?.autoCull && can('smartCulling')) {
        const candidates = prioritizePhotoProcessing(backgroundCullCandidates(snapshot.frames, imported));
        if (candidates.length) {
          const task = tasks.start(t.tasks.reviewingImported, {
            total: candidates.length, cancel: () => controller.abort(),
          });
          const scanRunId = ++scanRunSequence.current;
          setLiveCullScan(beginCullScan(projectId, scanRunId, candidates.map((frame) => frame.id)));
          controller.signal.addEventListener('abort', () => {
            tasks.cancel(task.id);
            setLiveCullScan((prev) => endCullScan(prev, projectId, scanRunId));
          }, { once: true });
          try {
            const results = await scanForCulling(candidates, snapshot.frames, provider, snapshot.keeperTarget,
              controller.signal, (count) => task.progress(count), undefined,
              (frameId, stage) => {
                if (!alive() || leavingRef.current) return;
                setLiveCullScan((prev) => advanceCullScan(prev, projectId, scanRunId, frameId, stage));
              }, preflightCache ? { cache: preflightCache, projectId } : undefined);
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
            task.finish(t.tasks.reviewRemaining);
          } catch (error) {
            if (!controller.signal.aborted) task.fail(error instanceof Error ? error.message : t.tasks.reviewFailed);
            return;
          } finally {
            // Neither Stop nor a stale result may leave an old scan on a
            // reopened project or clear the status of a newer analysis run.
            setLiveCullScan((prev) => endCullScan(prev, projectId, scanRunId));
          }
        }
      }
      if (!alive() || !snapshot.settings?.autoEdit || !can('autoTab')) return;
      // A manual edit or crop keeps the photo unchanged. Its optional advice
      // stays behind Auto > Suggest a look in the editor, never applied by this job.
      const targets = backgroundDevelopTargets(snapshot.frames, imported);
      if (editingRef.current && snapshot.selectedFrameId) targets.delete(snapshot.selectedFrameId);
      if (!targets.size) return;
      const task = tasks.start(t.tasks.developingKeepers, {
        total: targets.size, cancel: () => controller.abort(),
      });
      controller.signal.addEventListener('abort', () => { tasks.cancel(task.id); }, { once: true });
      try {
        const edits = await suggestKeeperAutoEdits(prioritizePhotoProcessing(snapshot.frames), provider, controller.signal,
          (count) => task.progress(count), targets,
          (frameId, edit) => {
            if (!alive() || leavingRef.current) return;
            // The photographer can edit, reject, remove or switch projects while
            // the next photo is processing. Every result checks the LIVE state.
            setCullingState((prev) => {
              if (!alive() || leavingRef.current || controller.signal.aborted) return prev;
              return commitCompletedAutoResult(prev, {
                projectId, frameId, edit, at: Date.now(),
                editingFrameId: editingRef.current ? prev.selectedFrameId ?? undefined : undefined,
              });
            });
          });
        if (!alive()) return;
        // Earlier completed photos remain edited even if a later photo fails
        // or Stop is pressed; nothing is held in a batch-wide commit.
        task.finish(t.tasks.startingLooks(edits.size));
      } catch (error) {
        if (!controller.signal.aborted) task.fail(error instanceof Error ? error.message : t.tasks.autoDevelopFailed);
      }
    };
    void run().finally(() => {
      preflightCache?.clear();
      pendingPreflight?.abort();
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
      const pool = filterFrames(prev.frames, prev.filter, prev.searchQuery, prev.ratingFilter, prev.cameraFilter, prev.lensFilter);
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
          // A kind the person chose while the scan was running always wins over the scan's.
          ? { ...frame, ...patch, ...(frame.subjectKind && patch.subjectKind ? { subjectKind: frame.subjectKind } : {}) } : frame) };
    }),
  });

  // Every RAW is developed from its sensor data in the background, so the library shows Kestrel's develop, not the
  // camera's JPEG. Paused while a photo is edited (the editor develops its own photo at full size first).
  useBackgroundDevelop({
    projectId: cullingState.shoot.id, frames: cullingState.frames, provider: previewProviderRef.current,
    active: !projectsOpen && !editing && !loadingProgress, onScreen: cullingState.selectedFrameId,
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
      const visible = filterFrames([copy], prev.filter, prev.searchQuery, prev.ratingFilter, prev.cameraFilter, prev.lensFilter).length > 0;
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
      const visible = filterFrames(frames, prev.filter, prev.searchQuery, prev.ratingFilter, prev.cameraFilter, prev.lensFilter);
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
    const task = tasks.start(t.tasks.autoAdjustingSelected, { total: candidates, cancel: () => controller.abort() });
    setAutoAdjustSelectedOpen(false);
    try {
      const suggestions = await suggestKeeperAutoEdits(frames, previewProviderRef.current!, controller.signal,
        (count) => task.progress(count), ids);
      // Never apply results from a previous project or an aborted scan.
      if (controller.signal.aborted || stateRef.current.shoot.id !== projectId) {
        if (!controller.signal.aborted) task.finish(t.tasks.projectChangedNoEdits);
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
      task.finish(t.tasks.analysedWithAdjustments(suggestions.size));
      showToast(t.toasts.autoAdjustedSelected);
    } catch (error) {
      if (controller.signal.aborted || task.cancelled) return;
      task.fail(error instanceof Error ? error.message : t.tasks.autoAdjustSelectionFailed);
      showToast(t.toasts.autoAdjustSelectedFailed);
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
    const task = tasks.start(t.tasks.autoAdjustingKeepers, { total: candidates, cancel: () => controller.abort() });
    setAutoAdjustOpen(false);
    try {
      const edits = await suggestKeeperAutoEdits(frames, previewProviderRef.current!, controller.signal,
        (count) => task.progress(count));
      if (controller.signal.aborted || stateRef.current.shoot.id !== projectId) {
        if (!controller.signal.aborted) task.finish(t.tasks.projectChangedNoEdits);
        return;
      }
      const at = Date.now();
      setCullingState((prev) => prev.shoot.id !== projectId ? prev : {
        ...prev, shoot: { ...prev.shoot, lastUpdatedAt: at },
        frames: applyKeeperAutoEdits(prev.frames, edits, at),
      });
      task.finish(t.tasks.keepersAdjusted(edits.size));
      showToast(t.toasts.autoAdjustedKeepers(edits.size));
    } catch (error) {
      if (controller.signal.aborted || task.cancelled) return;
      task.fail(error instanceof Error ? error.message : t.tasks.autoAdjustFailed);
      showToast(t.toasts.autoAdjustKeepersFailed);
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
      if (projectsOpen || exportFrames.length || (autoCullOpen && !autoCullHidden) || pendingAction || removedOpen) return;
      // Already handled by an open menu or dialog (for example Escape closing Workspace options).
      if (e.defaultPrevented) return;
      const modalOpen = openShootModal || macroPadModal;
      if (e.key === 'Escape' && prefs.focusMode && !modalOpen) {
        e.preventDefault();
        setPrefs((prev) => ({ ...prev, focusMode: false }));
        return;
      }
      if (e.key === 'Escape' && showPhotoInfo && !prefs.focusMode && !panesCollapsed) {
        setShowPhotoInfo(false);
        setInfoFrameId(undefined);
        infoTriggerRef.current?.focus();
        return;
      }
      const isModalOpen = modalOpen;
      const plainKey = !e.ctrlKey && !e.metaKey && !e.altKey;
      const inControl = isEditableElement(e.target) || (e.target instanceof Element && Boolean(
        e.target.closest('button,a,[role="dialog"],[role="menu"],[data-workspace-options]')
      ));
      if (plainKey && !inControl && !isModalOpen) {
        if (e.key.toLowerCase() === 'f') {
          e.preventDefault();
          setPrefs((prev) => ({ ...prev, focusMode: !prev.focusMode,
            viewMode: prev.focusMode || editing || prev.viewMode !== 'grid' ? prev.viewMode : 'loupe' }));
          return;
        }
        // Tab is *only* a pane shortcut while the photograph itself owns
        // focus. Elsewhere it remains normal keyboard/screen-reader navigation.
        if (e.key === 'Tab' && !e.shiftKey && !prefs.focusMode &&
            window.matchMedia('(min-width: 900px) and (min-height: 550px)').matches &&
            e.target instanceof Element && e.target.matches('[data-photo-stage]')) {
          e.preventDefault();
          setWorkspacePanes(toggleWorkspacePanes);
          // Move focus to a visible keyboard control instead of trapping Tab
          // on the photo canvas. Other Tab presses navigate normally.
          requestAnimationFrame(() => {
            const selector = editing ? '[data-workspace-pane-toggle]' : '[aria-controls="workspace-options"]';
            document.querySelector<HTMLButtonElement>(selector)?.focus();
          });
          return;
        }
      }
      if (editing) {
        if (!isModalOpen && e.key === 'Escape') {
          flushLinkedEdit();
          setEditing(false);
          setEditQueueIds(null);
          setEditTogether(false);
          // Keyboard Back and the visible Back button must preserve the same review selection.
        }
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
  }, [projectsOpen, loadingProgress, exportFrames.length, autoCullOpen, autoCullHidden, pendingAction, removedOpen, showPhotoInfo, editing, openShootModal, macroPadModal, prefs.bindings, prefs.focusMode, prefs.viewMode, panesCollapsed, executeCommand]);

  const droppedInProjectRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const watchImportRef = useRef<(files: File[]) => Promise<number>>(async () => 0);
  const quickEditRef = useRef<(files: Array<File | PickedPhoto>) => Promise<void>>(async () => {});
  const handleSelectLocalFilesRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const onDroppedPhotos = useCallback((files: File[]) => { if (projectsOpen) void quickEditRef.current(files); else void droppedInProjectRef.current(files); }, [projectsOpen]);
  const drop = useDropPhotos(onDroppedPhotos);
  const watch = useFolderWatch(useCallback((files: File[]) => watchImportRef.current(files), []));
  // Watching belongs to the current project. Never silently import into another
  // project after switching workspaces or returning to the home screen.
  // Leaving the project for the home screen stops its import too: the project is not saved while the home screen is
  // open, so photos added after leaving could be lost. Photos added before leaving stay in the project.
  useEffect(() => { if (projectsOpen) { watch.stop(); stopImport(); } }, [projectsOpen, cullingState.shoot.id, watch.stop, stopImport]);

  const handleSelectLocalFiles = async (picks: Array<File | PickedPhoto>, options?: { openEditor?: boolean; watched?: boolean; onImported?: (count: number) => void; claimed?: AbortController }) => {
    const targetProjectId = cullingState.shoot.id;
    if (importRef.current && importRef.current.controller !== options?.claimed) {
      if (options?.watched) throw new Error('Another import is running; the watched photos will be retried.');
      setFolderError(t.importing.stillAdding);
      return;
    }
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
      setFolderError(t.importing.alreadyInProject);
      return;
    }
    setOpenShootModal(false);
    setFolderError(null);
    setProjectError(undefined);
    setLoadingProgress({ loaded: 0, total: additions.length });
    const controller = options?.claimed ?? new AbortController();
    importRef.current = { projectId: targetProjectId, controller };
    // Imports appear in the task manager too, with Stop (a watched folder has its own status, so it is left out).
    const task = options?.watched ? null : tasks.start(t.tasks.adding(additions.length), { total: additions.length, cancel: () => controller.abort() });
    // Photos appear as they are read, so they can be looked at, culled and edited straight away. Watched imports stay
    // all-or-nothing (the watcher retries a whole batch), so they are still added at the end.
    const progressive = !options?.watched;
    const importId = newId().slice(0, 8);
    const importSequenceBase = cullingState.frames.reduce((max, frame) => Math.max(max, frame.sequenceIndex), 0);
    // Observe a bounded number of imported originals without deciding their cull status.
    const preflight = progressive && !autoWorker.current && !autoPendingIds.current.size &&
      stateRef.current.settings?.autoCull && can('smartCulling')
      ? createImportCullPreflight(targetProjectId, importId, previewProviderRef.current!, controller.signal)
      : undefined;
    let preflightHandedOff = false;
    const shown = new Set<string>(); // queued to be shown
    const appended = new Set<string>(); // actually added to the project
    let waiting: PhotoFrame[] = [];
    let lastShown = 0;
    const show = () => {
      if (!waiting.length) return;
      if (retiredImportsRef.current.has(controller) || leavingRef.current || projectsOpenRef.current || stateRef.current.shoot.id !== targetProjectId) {
        waiting = [];
        controller.abort();
        return;
      }
      const batch = waiting;
      for (const frame of batch) appended.add(frame.stableKey);
      waiting = [];
      lastShown = Date.now();
      setCullingState((prev) => (retiredImportsRef.current.has(controller) || leavingRef.current || projectsOpenRef.current || prev.shoot.id !== targetProjectId
        ? prev : appendProjectPhotos(prev, batch, importId, { sequenceBase: importSequenceBase })));
    };
    try {
      const { frames, unstoredKeys, uncachedPreviewKeys, failedNames, stopped } = await loadLocalFileListShoot(
        additions, previewProviderRef.current!, storeRef.current!,
        ({ loaded, total }) => {
          // Chunk completion still controls the numeric import progress. A
          // separate event releases each ready photo sooner than the chunk.
          if (retiredImportsRef.current.has(controller) || leavingRef.current || projectsOpenRef.current || stateRef.current.shoot.id !== targetProjectId) { controller.abort(); return; }
          setLoadingProgress({ loaded, total });
          task?.progress(loaded, total);
        },
        {
          allowPartial: !options?.watched, signal: controller.signal,
          onFrameReady: progressive ? (frame) => {
            if (retiredImportsRef.current.has(controller) || leavingRef.current || projectsOpenRef.current ||
                stateRef.current.shoot.id !== targetProjectId || controller.signal.aborted) {
              controller.abort();
              return;
            }
            if (shown.has(frame.stableKey)) return;
            shown.add(frame.stableKey);
            preflight?.offer({ ...frame, id: `${importId}-${frame.id}` });
            waiting.push(frame);
            // The first eight appear independently, then larger groups limit
            // catalogue writes and React renders in a 500-photo shoot.
            if (waiting.length >= 24 || Date.now() - lastShown > 1200 || shown.size <= 8) show();
          } : undefined,
        },
      );
      // The background cull, not the import task, waits for in-flight ONNX.
      if ((projectsOpenRef.current || leavingRef.current || retiredImportsRef.current.has(controller)) && progressive) {
        // The project was closed: what was added before closing is saved; nothing more is added to a closed project.
        task?.finish(t.tasks.stoppedProjectClosed(appended.size));
        return;
      }
      if (stateRef.current.shoot.id !== targetProjectId) {
        task?.finish(appended.size ? t.tasks.stoppedOtherProject(appended.size) : t.tasks.projectChangedNotAdded);
        return;
      }
      if (!frames.length) {
        if (stopped) { task?.finish(t.tasks.stoppedBeforeAny); return; }
        task?.fail(t.tasks.noneReadable);
        setProjectError(t.importing.noneReadable);
        return;
      }
      task?.finish(stopped ? t.tasks.stoppedAdded(frames.length) : failedNames.length ? t.tasks.addedSomeUnreadable(frames.length, failedNames.length) : undefined);
      if (unstoredKeys.length) {
        setTemporaryOriginals((previous) => new Set([...previous, ...unstoredKeys]));
        setTemporaryWarningDismissed(false);
      }
      const warnings: string[] = [];
      if (failedNames.length) {
        const examples = failedNames.slice(0, 3).join(', ');
        warnings.push(t.importing.someUnreadable(frames.length, failedNames.length, examples, failedNames.length > 3));
      }
      if (uncachedPreviewKeys.length) {
        warnings.push(t.importing.previewsNotSaved(uncachedPreviewKeys.length));
      }
      if (warnings.length) setProjectError(warnings.join(' '));
      if (progressive) waiting = [];
      setCullingState((prev) => {
        if (prev.shoot.id !== targetProjectId) return prev;
        // The remaining photos, then the final burst groups (a burst can straddle two batches).
        // Only photos not added yet: one already added and then removed during the import must stay removed.
        const next = applyImportBursts(appendProjectPhotos(prev, frames.filter((frame) => !appended.has(frame.stableKey)), importId, { sequenceBase: importSequenceBase }), frames, importId);
        const first = options?.openEditor ? next.frames.find((frame) => frame.id.startsWith(`${importId}-`)) : undefined;
        return first ? { ...next, filter: 'all', selectedFrameId: first.id } : next;
      });
      if (options?.openEditor) setEditing(true);
      enqueueBackgroundAuto(targetProjectId, frames.map((frame) => `${importId}-${frame.id}`), preflight);
      preflightHandedOff = true;
      setPrefs((prev) => ({ ...prev, viewMode: 'grid' }));
      options?.onImported?.(frames.length);
    } catch {
      task?.fail(t.tasks.addFailed);
      setProjectError(t.importing.addFailed);
      if (options?.watched) throw new Error('Kestrel could not import the watched photos. They will be retried.');
    } finally {
      // Only a failed/retired import still owns the optional model observer.
      // A successful import transferred it to background culling for safe drain.
      if (!preflightHandedOff) preflight?.abort();
      task?.fail(t.tasks.stoppedUnfinished); // does nothing if it finished
      if (importRef.current?.controller === controller) importRef.current = null;
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
      setProjectError(t.projects.quickEditFailed);
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
      if (importRef.current) { setFolderError(t.importing.stillAdding); return; }
      // Looking through a big folder takes a while: claim the import and show progress from the moment it is chosen.
      const controller = new AbortController();
      // Shown in Tasks, like every other job: looking through the folder, then adding its photos.
      let finding: TaskHandle | null = null;
      try {
        const chosen = await pickFolderNatively({
          signal: controller.signal,
          onChosen: () => {
            importRef.current = { projectId: cullingState.shoot.id, controller };
            setOpenShootModal(false);
            setLoadingProgress({ loaded: 0, total: 0, finding: true });
            finding = tasks.start(t.tasks.findingPhotos, { cancel: () => controller.abort() });
          },
          onProgress: (done, total) => {
            setLoadingProgress({ loaded: done, total, finding: true });
            finding?.progress(done, total || null);
          },
        });
        (finding as TaskHandle | null)?.finish();
        finding = null;
        if (chosen === 'cancelled') return;
        if (!chosen.length) { setFolderError(t.importing.noSupportedPhotos); return; }
        await handleSelectLocalFiles(chosen, { claimed: controller });
      } catch { setFolderError(t.importing.folderUnreadable); } finally {
        (finding as TaskHandle | null)?.finish();
        // Read through a function: TypeScript cannot see that onChosen set the claim.
        if (claimedBy(importRef.current, controller)) { importRef.current = null; setLoadingProgress(null); }
      }
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
        setFolderError(t.importing.noSupportedPhotos);
        return;
      }

      const otherFolder = cullingState.frames.find((frame) =>
        frame.sourceKind === 'directory-handle' &&
        !frame.stableKey.startsWith(`folder://${handle.name}/`)
      );
      if (otherFolder) {
        setFolderError(t.importing.oneFolderPerProject);
        return;
      }

      setOpenShootModal(false);
      setFolderError(null);
      setProjectError(undefined);
      setLoadingProgress({ loaded: 0, total: entries.length });
      const task = tasks.start(t.tasks.adding(entries.length), { total: entries.length });
      try {
        const { frames } = await loadDirectoryHandleShoot(
          handle,
          previewProviderRef.current!,
          storeRef.current!,
          ({ loaded, total }) => { setLoadingProgress({ loaded, total }); task.progress(loaded, total); },
          { handleKey: targetProjectId, entries },
        );
        if (stateRef.current.shoot.id !== targetProjectId) {
          task.finish(t.tasks.projectChangedNotAdded);
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
        task.fail(t.tasks.addFailed);
        setProjectError(t.importing.folderAddFailed);
      } finally {
        task.fail(t.tasks.stoppedUnfinished);
        setLoadingProgress(null);
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setFolderError(t.importing.folderUnreadableTryFiles);
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
    setRelinkStatus(t.reconnect.reconnecting);
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
      setRelinkStatus(recovered ? (missing ? t.reconnect.stillToReselect(missing) : undefined) :
        t.reconnect.noMatchSelected);
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
    setRelinkStatus(t.reconnect.chooseFolder);
    try {
      const [{ open }, fs] = await Promise.all([
        import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs'),
      ]);
      const folder = await open({ directory: true, multiple: false, title: t.reconnect.dialogTitle });
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
          openRange: linkedRangeOpener(path, Number(parts.at(-2)) || undefined),
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
      const details = [approximate.length ? t.reconnect.matchedByNameAndSize(approximate.length) : '', ambiguous.length ? t.reconnect.ambiguousSkipped(ambiguous.length) : '',
        scan.truncated ? t.reconnect.scanLimit : '',
        scan.skippedDirectories ? t.reconnect.foldersSkipped(scan.skippedDirectories) : ''].filter(Boolean).join(' ');
      setRelinkStatus((recovered
        ? `${t.reconnect.reconnected(recovered)}${remaining ? ` ${t.reconnect.mayStillNeed(remaining)}` : ''}`
        : t.reconnect.noMatchInFolder) + (details ? ` ${details}` : ''));
    } catch {
      setRelinkStatus(t.reconnect.folderUnreadable);
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
    if (isDesktopApp()) { setRelinkStatus(t.reconnect.madeInBrowser); return; }
    try {
      const stored = await store.loadDirectoryHandle(shoot.id);
      const permission = await (stored as (FileSystemDirectoryHandle & {
        requestPermission?: (options: { mode: 'read' }) => Promise<PermissionState>;
      }) | null)?.requestPermission?.({ mode: 'read' });
      const handle = permission === 'granted' ? stored : await (window as Window & {
        showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker?.();
      if (!handle || (shoot.folderName && handle.name !== shoot.folderName)) {
        setRelinkStatus(t.reconnect.selectOriginalFolder);
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
      setRelinkStatus(incomplete ? t.reconnect.someMissing : undefined);
      setPreviewRevision((previous) => previous + 1);
      setCullingState((previous) => ({
        ...previous,
        shoot: { ...previous.shoot, needsFolderRegrant: incomplete },
      }));
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setRelinkStatus(t.reconnect.reopenFailed);
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
        onEditPanelSideChange={(side) => setPrefs((prev) => ({ ...prev, hand: side, editPanelSide: side }))}
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
        return <PhotoContextMenu x={photoMenu.x} y={photoMenu.y} label={ids.length > 1 ? t.header.photoCount(ids.length) : frame.filename}
          state={{ decision: frame.decision, count: ids.length, canPaste: Boolean(copiedEdit), hasEdit: Boolean(frame.edit), edited: ids.some((id) => { const target = cullingState.frames.find((candidate) => candidate.id === id); return Boolean(target && isEdited(target)); }) }}
          onChoose={choosePhotoAction} onClose={() => setPhotoMenu(null)} />;
      })()}
      <DesktopUpdate />
      {locationsOpen && <ProjectLocationsDialog state={cullingState} onClose={() => setLocationsOpen(false)} />}
      {syncOpen && <SyncFolderDialog title={cullingState.shoot.title} projectId={cullingState.shoot.id} updatedAt={cullingState.shoot.lastUpdatedAt} frames={cullingState.frames} onClose={() => setSyncOpen(false)}
        onApply={(frames) => setCullingState((prev) => ({ ...prev, frames, shoot: { ...prev.shoot, lastUpdatedAt: Date.now() } }))} />}
      {watchOpen && <WatchFolderDialog onStart={(source, includeExisting) => void watch.start(source, includeExisting)} onClose={() => setWatchOpen(false)} />}
      {watch.status && <p role="status" className="fixed bottom-3 left-3 z-40 max-w-[calc(100vw-1.5rem)] rounded-xl border border-white/15 bg-kestrel-raised px-3 py-2 text-xs text-zinc-100 shadow-lg">{watch.status.error ?? t.watch.status(watch.status.folder, watch.status.imported)}</p>}
      {paidDialog && (
        <div role="dialog" aria-modal="true" aria-label={t.paid.dialogLabel(paidDialog)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onKeyDown={(event) => { if (event.key === 'Escape') setPaidDialog(null); }}>
          <div className="w-full max-w-sm space-y-3 rounded-xl border border-white/12 bg-kestrel-panel p-4">
            <PaidNotice title={paidDialog}>{t.paid.autoCullPitch}</PaidNotice>
            <button type="button" autoFocus onClick={() => setPaidDialog(null)} className="min-h-11 w-full rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8">{t.paid.close}</button>
          </div>
        </div>
      )}
      {settingsOpen && <AppearanceDialog side={prefs.editPanelSide} onSideChange={(side) => setPrefs((prev) => ({ ...prev, hand: side, editPanelSide: side }))}
        hand={prefs.hand} onHandChange={(hand) => setPrefs((prev) => ({ ...prev, hand, editPanelSide: hand }))}
        onClose={() => setSettingsOpen(false)} onOpenMacroPad={() => { setSettingsOpen(false); setMacroPadMode(editing ? 'edit' : 'cull'); setMacroPadModal(true); }} />}
      <DropOverlay dragging={drop.dragging} message={drop.message} onDismiss={drop.clearMessage} />
      {prefs.focusMode ? null : editing ? (
        <header className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-kestrel-panel px-3 py-1">
          <button type="button" onClick={leaveEditor} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300" aria-label={t.header.back} title={t.header.backTitle}><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t.header.back}</button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-300" title={selectedFrame?.filename}>{selectedFrame?.filename ?? t.header.editPhoto}</h1>
          <TaskManager inline />
          {/* The same order as the library's top row: work in hand, this page's actions (Export), then Settings. */}
          <div id="editor-header-actions" className="flex shrink-0 items-center gap-2" />
          <button type="button" ref={infoTriggerRef} onClick={() => {
            setInfoFrameId(undefined);
            setWorkspacePanes({ folded: false });
            setShowPhotoInfo((visible) => !visible);
          }} aria-label={t.top.photoInfo} title={t.top.photoInfo} aria-pressed={showPhotoInfo && !panesCollapsed}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-zinc-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300 aria-pressed:bg-white/15">
            <Info className="h-5 w-5" aria-hidden="true" />
          </button>
          <SettingsButton open={settingsOpen} onOpen={() => setSettingsOpen(true)} />
          {multiSelect && selectedVisibleFrames.length > 0 && (
            <span className="shrink-0 text-xs tabular-nums text-zinc-300">{t.header.selected(selectedVisibleFrames.length)}</span>
          )}
        </header>
      ) : <TopWorkspaceBar
        status={<TaskManager inline />}
        settingsButton={<SettingsButton open={settingsOpen} onOpen={() => setSettingsOpen(true)} />}
        onOpenSettings={() => setSettingsOpen(true)}
        shoot={cullingState.shoot}
        counts={counts}
        filter={cullingState.filter}
        onFilterChange={changeFilter}
        ratingFilter={cullingState.ratingFilter ?? null}
        onRatingFilterChange={(next) =>
          setCullingState((prev) => {
            const nextVisible = filterFrames(prev.frames, prev.filter, prev.searchQuery, next, prev.cameraFilter, prev.lensFilter);
            const stillVisible = nextVisible.some((f) => f.id === prev.selectedFrameId);
            return { ...prev, ratingFilter: next, selectedFrameId: stillVisible ? prev.selectedFrameId : nextVisible[0]?.id ?? null };
          })
        }
        searchQuery={cullingState.searchQuery}
        onSearchChange={(q) =>
          setCullingState((prev) => {
            const nextVisible = filterFrames(prev.frames, prev.filter, q, prev.ratingFilter, prev.cameraFilter, prev.lensFilter);
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
            const nextVisible = filterFrames(prev.frames, prev.filter, prev.searchQuery, prev.ratingFilter, next, prev.lensFilter);
            const stillVisible = nextVisible.some((f) => f.id === prev.selectedFrameId);
            return { ...prev, cameraFilter: next, selectedFrameId: stillVisible ? prev.selectedFrameId : nextVisible[0]?.id ?? null };
          })
        }
        lensFilter={cullingState.lensFilter ?? null}
        onLensFilterChange={(next) =>
          setCullingState((prev) => {
            const nextVisible = filterFrames(prev.frames, prev.filter, prev.searchQuery, prev.ratingFilter, prev.cameraFilter, next);
            const stillVisible = nextVisible.some((f) => f.id === prev.selectedFrameId);
            return { ...prev, lensFilter: next, selectedFrameId: stillVisible ? prev.selectedFrameId : nextVisible[0]?.id ?? null };
          })
        }
        cameraOptions={cameraOptions}
        lensOptions={lensOptions}
        sortOrder={cullingState.sortOrder}
        onSortOrderChange={(next) => setCullingState((prev) => ({ ...prev, sortOrder: next }))}
        keeperTarget={cullingState.keeperTarget}
        onKeeperTargetChange={(target) =>
          setCullingState((prev) => ({ ...prev, keeperTarget: target }))
        }
        editPanelSide={prefs.editPanelSide}
        onEditPanelSideChange={(side) => setPrefs((prev) => ({ ...prev, hand: side, editPanelSide: side }))}
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
        onAutoCull={() => { if (!can('smartCulling')) { setPaidDialog(messages.autoCull); return; } if (autoCullOpen) { setAutoCullHidden(false); return; } setAutoCullStart(false); setAutoCullHidden(false); setAutoCullOpen(true); }}
        settings={cullingState.settings ?? LEGACY_SETTINGS}
        onSettingsChange={(settings) => setCullingState((prev) => ({ ...prev, settings, shoot: { ...prev.shoot, lastUpdatedAt: Date.now() } }))}
        actionsDisabled={projectBusy}
        addDisabled={Boolean(loadingProgress)}
        onOpenMacroPadModal={() => { setMacroPadMode('cull'); setMacroPadModal(true); }}
        loadingProgress={loadingProgress}
        onToggleMultiSelect={() => {
          if (multiSelect) setSelectedIds(new Set());
          setMultiSelect(!multiSelect);
        }}
        multiSelect={multiSelect}
        focusMode={prefs.focusMode}
        onToggleFocusMode={() => setPrefs((prev) => ({ ...prev, focusMode: !prev.focusMode }))}
        panesCollapsed={panesCollapsed}
        onTogglePanes={togglePanes}
        onBatchLook={previewKeeperLook(cullingState.frames).total > 0 ? () => setBatchLookOpen(true) : undefined}
        onAutoAdjustKeepers={!autoAdjustController.current && previewKeeperLook(cullingState.frames).eligible > 0 ? () => setAutoAdjustOpen(true) : undefined}
        onExportKeepers={cullingState.filter === 'keep' && visibleFrames.length
          ? () => setExportFrames(visibleFrames) : undefined}
        onUndo={cullingState.undoStack.length ? () => executeCommand('cull.undo') : undefined}
        undoLabel={undoLabel(cullingState)}
        redoLabel={redoLabel(cullingState)}
        onExport={exportSelection.length ? () => setExportFrames(exportSelection) : undefined}
        exportLabel={exportSelection.length > 1 ? t.header.exportCount(exportSelection.length) : t.header.export}
        exportCount={exportSelection.length}
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
        editLabel={multiSelect && selectedVisibleFrames.length > 0 ? t.selection.editSelected : undefined}
        onEditPhoto={multiSelect && selectedVisibleFrames.length > 0
          ? startSelectedEditing
          : selectedFrame ? () => { setEditQueueIds(null); setEditing(true); } : undefined}
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
        <p>{t.notices.temporaryOriginals(temporaryOriginals.size)}</p>
        <button type="button" className="min-h-11 px-2 underline" onClick={() => setTemporaryWarningDismissed(true)}>{t.notices.dismiss}</button>
      </div>}
      {backupNotice && <div className="flex items-center justify-between gap-2 border-b border-white/8 px-3 text-sm text-zinc-300">
        <p role="status">{backupNotice}</p>
        <button type="button" className="min-h-11 px-2" onClick={() => setBackupNotice(undefined)}>{t.notices.dismiss}</button>
      </div>}

      {projectError && <p role="alert" className="bg-orange-950 px-3 py-2 text-sm text-orange-100">{projectError}</p>}

      {/* Section F: the shared photo frame docks tools on the preferred-hand
          side and Photo Info on the OTHER side, in editing and review alike. */}
      <main key={previewRevision} className={`relative flex-1 flex min-h-0 min-w-0 ${prefs.hand === 'right' ? 'workspace:flex-row-reverse' : ''}`}>
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {editing && selectedFrame && (
            <div className="flex min-h-0 min-w-0 flex-1">
              {panesCollapsed && !prefs.focusMode && prefs.hand === 'left' && (
                <WorkspacePaneRail kind="tools" side="left" onExpand={() => setWorkspacePanes({ folded: false })} />
              )}
            <PhotoEditor
              viewportTransform={{ zoom: zoomLevel, pan: panOffset }}
              onViewportTransform={(next) => {
                setZoomLevel(next.zoom);
                setPanOffset(next.pan);
              }}
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
              onPanelSideChange={(side) => setPrefs((prev) => ({ ...prev, hand: side, editPanelSide: side }))}
              hand={prefs.hand}
              onHandChange={(hand) => setPrefs((prev) => ({ ...prev, hand, editPanelSide: hand }))}
              toolsCollapsed={panesCollapsed}
              focusPhoto={prefs.focusMode}
              onExpandTools={() => setWorkspacePanes({ folded: false })}
              onFoldTools={() => setWorkspacePanes({ folded: true })}
              keeperCount={counts.keep}
              onApplyToKeepers={applyEditToKeepers}
              onUndoKeeperEdits={batchUndo ? undoKeeperEdits : undefined}
            />
              {panesCollapsed && !prefs.focusMode && prefs.hand === 'right' && (
                <WorkspacePaneRail kind="tools" side="right" onExpand={() => setWorkspacePanes({ folded: false })} />
              )}
            </div>
          )}
          {!editing && liveFrames.length === 0 && (
            <div className="grid flex-1 place-items-center p-4">
              <div className="text-center">
                <h2 className="mb-3 text-sm text-zinc-300">{t.empty.noPhotos}</h2>
                <button type="button" disabled={Boolean(loadingProgress)} onClick={() => setOpenShootModal(true)}
                  className="min-h-11 rounded-lg bg-kestrel-copper hover:bg-kestrel-copper-hover! px-4 text-sm font-semibold text-zinc-950 disabled:opacity-40">{t.empty.addPhotos}</button>
              </div>
            </div>
          )}

          {!editing && multiSelect && (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-white/10 bg-[#15171C] px-2 text-sm">
              <span>{t.header.selected(selectedIds.size)}</span>
              <div className="flex flex-wrap items-center gap-x-1">
              <button type="button" disabled={!selectedVisibleFrames.length} className="min-h-11 px-2 text-sky-200 disabled:opacity-40"
                onClick={() => setExportFrames(selectedVisibleFrames)}>
                {t.selection.exportSelected}
              </button>
              <button type="button" disabled={!selectedVisibleFrames.length} className="min-h-11 px-2 text-sky-200 disabled:opacity-40"
                onClick={() => setSelectionLookOpen(true)}>{t.selection.applyLook}</button>
              <button type="button" disabled={!!autoAdjustController.current} onClick={() => setAutoAdjustSelectedOpen(true)}
                className="min-h-11 rounded-md border border-white/15 px-2 text-xs font-medium hover:bg-white/10 disabled:opacity-40">{t.selection.autoAdjustSelected}</button>
              <button type="button" disabled={!selectedVisibleFrames.length} className="min-h-11 px-2 text-sky-200 disabled:opacity-40"
                onClick={startSelectedEditing}>{t.selection.editSelected}</button>
              <button type="button" disabled={!selectedVisibleFrames.length} className="min-h-11 px-2 text-orange-200 disabled:opacity-40"
                onClick={() => setPendingAction({ kind: 'trash', frameIds: selectedVisibleFrames.map((frame) => frame.id), allowAdvance: false })}>{t.selection.trashSelected}</button>
              <button type="button" className="min-h-11 px-2" onClick={() => {
                setMultiSelect(false);
                setSelectedIds(new Set());
              }}>{t.selection.done}</button>
              </div>
            </div>
          )}
          {!editing && liveFrames.length > 0 && !visibleFrames.length && (
            <div className="grid flex-1 place-items-center p-4">
              <div className="space-y-3 text-center">
                <p className="text-sm text-zinc-300">{cullingState.searchQuery ? t.empty.noSearchMatch : cullingState.filter === 'unreviewed' ? t.empty.caughtUp :
                  cullingState.filter === 'keep' ? t.empty.flagKeep : t.empty.trashEmpty}</p>
                {cullingState.filter === 'unreviewed' && counts.unreviewed === 0 && cullingState.undoStack.length > 0 && (
                  <button type="button" onClick={() => executeCommand('cull.undo')}
                    className="min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/10">
                    {t.empty.undoLast}
                  </button>
                )}
              </div>
            </div>
          )}
          {/* Guidance sits above the grid only: single photo and compare give the photo the room. */}
          {!editing && prefs.viewMode === 'grid' && !cullingState.shoot.inbox && !loadingProgress && guidedDismissedFor !== cullingState.shoot.id &&
            ((guided === 'reviewing' && cullingState.filter === 'unreviewed') ||
             ((guided === 'improving' || guided === 'ready') && cullingState.filter === 'keep')) && (
            <GuidedBanner step={guided} unreviewed={counts.unreviewed} keepers={counts.keep} scanned={remainingWereScanned(cullingState.frames)} uneditedKeepers={uneditedKeepers}
              onFindBestPhotos={() => {
                if (!can('smartCulling')) { setPaidDialog(messages.autoCull); return; }
                if (autoCullOpen) { setAutoCullHidden(false); return; }
                setAutoCullStart(true);
                setAutoCullHidden(false);
                setAutoCullOpen(true);
              }}
              onReviewMyself={() => changeFilter('unreviewed')}
              onSeeSuggestedEdits={() => setAutoAdjustOpen(true)}
              onEditMyself={() => changeFilter('keep')}
              onExportKeepers={() => setExportFrames(cullingState.frames.filter((frame) => !frame.removedAt && frame.decision === 'keep'))}
              onDismiss={() => setGuidedDismissedFor(cullingState.shoot.id)} />
          )}
          {!editing && prefs.viewMode === 'grid' && can('speciesId') && <SpeciesScanBanner scan={scan} />}
          {can('onlineAi') && <OnlineHelperDialog />}
          {!editing && visibleFrames.length > 0 && prefs.viewMode === 'grid' && (
            <VirtualizedContactSheet
              analysisStages={liveCullScan?.projectId === cullingState.shoot.id ? liveCullScan.stages : undefined}
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
              onOpenEditor={(frameId) => { handleSelectFrame(frameId); setEditQueueIds(null); setEditing(true); }}
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
              focusPhoto={prefs.focusMode}
              onExecuteCommand={executeCommand}
              onStepFrame={handleStepFrame}
              photoIndex={selectedVisibleIndex}
              photoCount={visibleFrames.length}
              onJumpToIndex={(index) => {
                const next = visibleFrames[index];
                if (next) handleSelectFrame(next.id);
              }}
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
            <div role="toolbar" aria-label={t.editorBar.label}
              className={`${prefs.focusMode ? 'hidden ' : ''}mobile-toolbar-scroll flex min-w-0 max-w-full shrink-0 items-center gap-1 overflow-x-auto border-t border-white/10 bg-kestrel-panel px-2`}>
              {/* Section F: one footer order across Review and Edit — navigation, actions, then zoom. */}
              <button type="button" aria-label={t.editorBar.previous} title={t.editorBar.previousTitle} disabled={(editQueueIds ? editorIndex : selectedVisibleIndex) <= 0} onClick={() => handleStepFrame(-1)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/10 disabled:opacity-30"><ChevronLeft className="h-5 w-5" aria-hidden="true" /></button>
              <button type="button" aria-label={t.editorBar.next} title={t.editorBar.nextTitle} disabled={(editQueueIds ? editorIndex : selectedVisibleIndex) < 0 || (editQueueIds ? editorIndex >= editorFrames.length - 1 : selectedVisibleIndex >= visibleFrames.length - 1)} onClick={() => handleStepFrame(1)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/10 disabled:opacity-30"><ChevronRight className="h-5 w-5" aria-hidden="true" /></button>
              <PhotoJump index={editorIndex} total={editorFrames.length}
                onJump={(index) => {
                  const next = editorFrames[index];
                  if (next) handleSelectFrame(next.id);
                }} />
              {/* On phones, Copy and Paste are in the photo's long-press menu, so this bar fits the screen. */}
              <button type="button" title={t.editorBar.copyTitle} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-white/10 max-sm:hidden"
                onClick={() => { setCopiedEdit(selectedFrame.edit ?? DEFAULT_EDIT); showToast(t.toasts.adjustmentsCopied); }}>
                <Copy className="h-4 w-4" aria-hidden="true" /> {t.editorBar.copy}
              </button>
              {!multiSelect && <button type="button" disabled={!copiedEdit} title={copiedEdit ? t.editorBar.pasteTitle : t.editorBar.pasteNothingTitle} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-white/10 disabled:opacity-40 max-sm:hidden"
                onClick={() => { if (copiedEdit) { updateFrame(selectedFrame.id, { edit: isEmptyEdit(copiedEdit) ? undefined : { ...copiedEdit } }); showToast(t.toasts.adjustmentsPasted); } }}>
                <ClipboardPaste className="h-4 w-4" aria-hidden="true" /> {t.editorBar.paste}
              </button>}
              <button type="button" aria-pressed={multiSelect} className="inline-flex min-h-11 items-center rounded-md px-2 text-xs hover:bg-white/10"
                onClick={() => {
                  cancelLinkedEdit();
                  flushLinkedEdit();
                  setEditTogether(false);
                  if (multiSelect) { setMultiSelect(false); setSelectedIds(new Set()); }
                  else { setMultiSelect(true); setSelectedIds(new Set([selectedFrame.id])); }
                }}>{multiSelect ? t.editorBar.doneSelecting : t.editorBar.selectPhotos}</button>
              {multiSelect && <>
                {selectedVisibleFrames.length > 1 && <button type="button" aria-pressed={editTogether}
                  onClick={() => { flushLinkedEdit(); setEditTogether((value) => !value); }}
                  className={`min-h-11 rounded-md border px-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-sky-300 ${editTogether ? 'border-sky-200 bg-white/15' : 'border-white/15 hover:bg-white/10'}`}>
                  {editTogether ? t.editorBar.editingTogether : t.editorBar.editTogether}
                </button>}
                <span role="status" className="shrink-0 text-xs text-zinc-300">{t.header.selected(selectedVisibleFrames.length)}</span>
                <button type="button" disabled={!selectedVisibleFrames.length} className="min-h-11 rounded-md px-2 text-xs hover:bg-white/10 disabled:opacity-40"
                  onClick={() => setSelectionLookOpen(true)}>{t.editorBar.applyLook}</button>
                <button type="button" disabled={!!autoAdjustController.current} className="min-h-11 rounded-md px-2 text-xs hover:bg-white/10 disabled:opacity-40"
                  onClick={() => setAutoAdjustSelectedOpen(true)}>{t.editorBar.autoAdjust}</button>
                <button type="button" disabled={!selectedVisibleFrames.length || !copiedEdit} className="min-h-11 rounded-md px-2 text-xs hover:bg-white/10 disabled:opacity-40"
                  onClick={() => setConfirmPasteSelection(true)}>{t.editorBar.pasteToSelected}</button>
                <button type="button" disabled={!selectedVisibleFrames.length} className="min-h-11 rounded-md px-2 text-xs text-orange-200 hover:bg-white/10 disabled:opacity-40"
                  onClick={() => setPendingAction({ kind: 'trash', frameIds: selectedVisibleFrames.map((frame) => frame.id) })}>{t.editorBar.trash}</button>
              </>}
              <div id="viewer-zoom-slot" className="ml-auto flex shrink-0 items-center" />
            </div>
          )}

        </div>

        {!prefs.focusMode && !panesCollapsed && showPhotoInfo && (
          <ExifInspector dockedSide={photoInfoDockSide(prefs.hand)} onSubjects={(frame, tags, kind) => setSubjects(frame, tags, kind)} onKeepTag={(frame, name) => keepTag(frame, name)}
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
        {!prefs.focusMode && (panesCollapsed || !showPhotoInfo) && visibleFrames.length > 0 && (
          <WorkspacePaneRail kind="info" side={photoInfoDockSide(prefs.hand)}
            onExpand={() => { setWorkspacePanes({ folded: false }); setShowPhotoInfo(true); }} />
        )}
      </main>
      {/* Independent full-width dock: side panels never constrain filmstrip width. */}
      {/* Not in grid view, where every photo is already on screen. */}
      {!prefs.focusMode && visibleFrames.length > 0 && (editing || prefs.viewMode !== 'grid') && (
        <FilmstripDock expanded={prefs.showFilmstrip} onToggle={toggleFilmstrip} onPhotoOnly={() => setPrefs((prev) => ({ ...prev, focusMode: true }))}>
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
        </FilmstripDock>
      )}
      {prefs.focusMode && (
        <div className="flex shrink-0 justify-end border-t border-white/10 bg-kestrel-panel px-3 py-1">
          <button type="button" onClick={() => setPrefs((prev) => ({ ...prev, focusMode: false }))}
            className="min-h-10 rounded-md px-3 text-sm text-zinc-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
            {t.editorBar.exitPhotoOnly}
          </button>
        </div>
      )}

      {autoAdjustSelectedOpen && <ConfirmDialog title={t.confirm.autoAdjustSelected.title} confirmLabel={t.confirm.autoAdjustSelected.confirm}
        cancelLabel={t.confirm.cancel} onCancel={() => setAutoAdjustSelectedOpen(false)}
        confirmDisabled={!selectedVisibleFrames.some((frame) => !frame.removedAt && !frame.virtualCopy &&
          !frame.editHistory?.steps.length && (!frame.edit || isEmptyEdit(frame.edit)))}
        onConfirm={() => void autoAdjustSelected()}>
        <p>{t.confirm.autoAdjustSelected.ownAdjustments}</p>
        <p>{t.confirm.autoAdjustSelected.protected}</p>
        <p>{t.confirm.autoAdjustSelected.untouched}</p>
      </ConfirmDialog>}
      {selectionLookOpen && <SelectionLookDialog frames={cullingState.frames} ids={new Set(selectedVisibleFrames.map((frame) => frame.id))}
        onClose={() => setSelectionLookOpen(false)} onApply={(look, includeEdited) => {
          const at = Date.now();
          const ids = new Set(selectedVisibleFrames.map((frame) => frame.id));
          setCullingState((prev) => ({ ...prev, frames: applySelectedLook(prev.frames, ids, look, includeEdited, at),
            shoot: { ...prev.shoot, lastUpdatedAt: at } }));
          showToast(t.toasts.appliedLook(previewSelectedLook(cullingState.frames, ids, includeEdited).eligible));
        }} />}
      {confirmPasteSelection && <ConfirmDialog title={t.confirm.pasteSelection.title(selectedVisibleFrames.length)}
        confirmLabel={t.confirm.pasteSelection.confirm} cancelLabel={t.confirm.cancel} onCancel={() => setConfirmPasteSelection(false)}
        onConfirm={pasteToSelection}>
        <p>{t.confirm.pasteSelection.what}</p>
        <p>{t.confirm.pasteSelection.safe}</p>
      </ConfirmDialog>}
      {pendingAction?.kind === 'trash' && (() => {
        const moving = pendingAction.frameIds.filter((id) => cullingState.frames.find((frame) => frame.id === id)?.decision === 'keep').length;
        return (
          <ConfirmDialog title={moving > 1 ? t.confirm.trash.titleMany(moving) : t.confirm.trash.titleOne}
            confirmLabel={t.confirm.trash.confirm} cancelLabel={t.confirm.trash.cancel} onConfirm={confirmPending} onCancel={() => setPendingAction(null)}>
            <p>{moving > 1 ? t.confirm.trash.bodyMany : t.confirm.trash.bodyOne}</p>
          </ConfirmDialog>
        );
      })()}
      {pendingAction?.kind === 'reset' && (
        <ConfirmDialog title={t.confirm.reset.title(pendingAction.frameIds.length)} confirmLabel={t.confirm.reset.confirm} cancelLabel={t.confirm.cancel}
          onConfirm={confirmPending} onCancel={() => setPendingAction(null)}>
          <p>{t.confirm.reset.body}</p>
        </ConfirmDialog>
      )}
      {pendingAction?.kind === 'remove' && (
        <ConfirmDialog title={t.confirm.remove.title} confirmLabel={t.confirm.remove.confirm} cancelLabel={t.confirm.cancel}
          onConfirm={confirmPending} onCancel={() => setPendingAction(null)}>
          <p>{t.confirm.remove.disappears(cullingState.frames.find((frame) => frame.id === pendingAction.frameIds[0])?.filename ?? t.confirm.remove.thisPhoto)}</p>
          <p><strong>{t.confirm.remove.notDeleted}</strong> {t.confirm.remove.bringBack}</p>
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
        hidden={autoCullHidden}
        onHide={() => setAutoCullHidden(true)}
        onClose={() => { setAutoCullOpen(false); setAutoCullHidden(false); }} />}

      {autoAdjustOpen && <ConfirmDialog title={t.confirm.autoAdjustKeepers.title} confirmLabel={t.confirm.autoAdjustKeepers.confirm} cancelLabel={t.confirm.cancel}
        onConfirm={() => void autoAdjustKeepers()} onCancel={() => setAutoAdjustOpen(false)}>
        <p>{t.confirm.autoAdjustKeepers.what}</p>
        <p>{t.confirm.autoAdjustKeepers.eligible(previewKeeperLook(cullingState.frames).eligible)}</p>
        <p>{t.confirm.autoAdjustKeepers.safe}</p>
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
