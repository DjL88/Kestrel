import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProjectList } from './components/ProjectList';
import { appendProjectPhotos, createEmptyProject } from './core/projects';
import { createVirtualCopy } from './core/virtualCopies';
import { PhotoExportPanel } from './components/PhotoExportPanel';
import { PhotoEditor } from './components/PhotoEditor';
import type { PhotoFraming } from './core/photoFraming';
import { isNeutralEdit, type PhotoEdit } from './core/photoEdits';
import { CompareView } from './components/CompareView';
import { ExifInspector } from './components/ExifInspector';
import { Filmstrip } from './components/Filmstrip';
import { FolderRegrantBanner } from './components/FolderRegrantBanner';
import { LoupePreview } from './components/LoupePreview';
import { MacroPadModal } from './components/MacroPadModal';
import { OpenShootModal } from './components/OpenShootModal';
import { TopWorkspaceBar } from './components/TopWorkspaceBar';
import { VirtualizedContactSheet } from './components/VirtualizedContactSheet';
import {
  DEFAULT_KEEPER_TARGET,
  applyDecisionWithHistory,
  computeCullCounts,
  createDemoShootState,
  filterFrames,
  getDefaultComparePair,
  redoDecision,
  stepSelection,
  undoDecision,
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
  const storeRef = useRef<BrowserCatalogueStore | null>(null);
  if (!storeRef.current) storeRef.current = new BrowserCatalogueStore();

  const relinkInput = useRef<HTMLInputElement>(null);
  const previewProviderRef = useRef<BrowserPreviewProvider | null>(null);
  if (!previewProviderRef.current) previewProviderRef.current = new BrowserPreviewProvider();

  const [prefs, setPrefs] = useState<UserPreferences>(() => loadPreferences());
  const [cullingState, setCullingState] = useState<CullingState>(() =>
    createDemoShootState(500)
  );
  const [editing, setEditing] = useState(false);
  const [exportFrames, setExportFrames] = useState<PhotoFrame[]>([]);
  const [showPhotoInfo, setShowPhotoInfo] = useState(false);
  const [copiedEdit, setCopiedEdit] = useState<PhotoEdit | null>(null);
  const [batchUndo, setBatchUndo] = useState<{
    applied: PhotoEdit;
    previous: ReadonlyMap<string, PhotoEdit | undefined>;
  } | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [projects, setProjects] = useState<ShootDescriptor[]>([]);
  const [projectBusy, setProjectBusy] = useState(true);
  const [projectError, setProjectError] = useState<string>();
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
        const demo = createDemoShootState(500);
        const initial = legacy?.shoot && Array.isArray(legacy.frames)
          ? { ...createDemoShootState(0), ...legacy, shoot: legacy.shoot, frames: legacy.frames }
          : demo;
        await store.saveProject(initial);
        if (initial.shoot.id !== demo.shoot.id) await store.saveProject(demo);
        if (active) setProjects(await store.listProjects());
      } catch {
        if (active) setProjectError('Could not open the local project catalogue. Reload to try again.');
      } finally {
        if (active) setProjectBusy(false);
      }
    }
    void initialiseProjects();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (projectsOpen) return;
    void storeRef.current!.saveProject(cullingState).catch(() => {
      setProjectError('Project changes could not be saved. Check available browser storage.');
    });
  }, [cullingState, projectsOpen]);

  function enterProject(state: CullingState) {
    const filter = state.filter === 'all' ? 'unreviewed' : state.filter;
    const visible = filterFrames(state.frames, filter, state.searchQuery);
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

  async function newProject(name: string) {
    setProjectBusy(true);
    setProjectError(undefined);
    try {
      const state = createEmptyProject(`project-${crypto.randomUUID()}`, name);
      await storeRef.current!.saveProject(state);
      previewProviderRef.current!.clear();
      enterProject(state);
    } catch {
      setProjectError('Could not create the project. Check available browser storage.');
    } finally {
      setProjectBusy(false);
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

  const counts = useMemo(
    () => computeCullCounts(cullingState.frames),
    [cullingState.frames]
  );

  const visibleFrames = useMemo(
    () =>
      filterFrames(
        cullingState.frames,
        cullingState.filter,
        cullingState.searchQuery
      ),
    [cullingState.frames, cullingState.filter, cullingState.searchQuery]
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
      visibleFrames.length > 0 ? visibleFrames : cullingState.frames,
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
      setCullingState((previous) => [...targets].reduce((state, frameId) =>
        applyDecisionWithHistory(state, frameId, change.flag, { allowAdvance: false }), previous));
    }
  }

  const handleStepFrame = useCallback(
    (delta: number) => {
      setZoomLevel(1);
      setPanOffset({ x: 0, y: 0 });
      setCullingState((prev) => {
        const currentVisible = filterFrames(prev.frames, prev.filter, prev.searchQuery);
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

  const handleDecideFrame = useCallback(
    (frameId: string, decision: CullDecision, allowAdvance?: boolean) => {
      setCullingState((prev) =>
        applyDecisionWithHistory(prev, frameId, decision, { allowAdvance })
      );
    },
    []
  );

  const toggleCompareView = useCallback(() => {
    setPrefs((prev) => {
      const nextMode: WorkspaceViewMode =
        prev.viewMode === 'compare' ? 'loupe' : 'compare';
      return { ...prev, viewMode: nextMode };
    });
    setCullingState((prev) => {
      const pool = filterFrames(prev.frames, prev.filter, prev.searchQuery);
      const pair = getDefaultComparePair(
        pool.length > 0 ? pool : prev.frames,
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

  const updateFrame = (frameId: string, patch: Pick<PhotoFrame, 'edit' | 'subjectNames' | 'rating' | 'framing'>) => {
    setCullingState((prev) => ({
      ...prev,
      shoot: { ...prev.shoot, lastUpdatedAt: Date.now() },
      frames: prev.frames.map((frame) =>
        frame.id === frameId ? { ...frame, ...patch } : frame
      ),
    }));
  };

  const addVirtualCopy = (framing?: PhotoFraming) => {
    if (!selectedFrame) return;
    const id = `copy-${crypto.randomUUID()}`;
    const sourceId = selectedFrame.id;
    setCullingState((prev) => {
      const index = prev.frames.findIndex((frame) => frame.id === sourceId);
      if (index < 0) return prev;
      const copy = createVirtualCopy(prev.frames[index], prev.frames, id);
      if (framing) copy.framing = framing;
      const frames = [...prev.frames.slice(0, index + 1), copy, ...prev.frames.slice(index + 1)];
      const visible = filterFrames([copy], prev.filter, prev.searchQuery).length > 0;
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
      const visible = filterFrames(frames, prev.filter, prev.searchQuery);
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
        previous.has(frame.id) ? { ...frame, edit: applied } : frame
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
          ? { ...frame, edit: batchUndo.previous.get(frame.id) }
          : frame
      ),
    }));
    setBatchUndo(null);
  };

  // Global keyboard listener wired through unified resolveKeyboardCommand
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (projectsOpen || loadingProgress || exportFrames.length) return;
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
  }, [projectsOpen, loadingProgress, exportFrames.length, showPhotoInfo, editing, openShootModal, macroPadModal, prefs.bindings, executeCommand]);

  const handleSelectLocalFiles = async (files: File[]) => {
    const existing = new Set(cullingState.frames.map((frame) => frame.stableKey));
    const additions = files.filter((file) => {
      const key = getLocalFileKey(file);
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    if (!additions.length) {
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
      const importId = crypto.randomUUID().slice(0, 8);
      setCullingState((prev) => appendProjectPhotos(prev, frames, importId));
      setPrefs((prev) => ({ ...prev, viewMode: 'grid' }));
    } catch {
      setProjectError('Could not add the photos. Try selecting the files again.');
    } finally {
      setLoadingProgress(null);
    }
  };

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

  const reconnectFileSelection = (files: File[]) => {
    const preview = previewProviderRef.current!;
    const expected = new Set(cullingState.frames.filter((frame) => frame.sourceKind === 'file').map((frame) => frame.stableKey));
    let recovered = 0;
    for (const file of files) {
      const key = getLocalFileKey(file);
      if (!expected.has(key) || preview.hasBlob(key)) continue;
      preview.registerBlob(key, file);
      recovered += 1;
    }
    const missing = [...expected].filter((key) => !preview.hasBlob(key)).length;
    setRelinkStatus(recovered ? `${missing} source files still need to be reselected.` :
      'None of the selected files match the missing originals in this shoot.');
    if (!recovered) return;
    setPreviewRevision((previous) => previous + 1);
    setCullingState((previous) => ({
      ...previous,
      shoot: { ...previous.shoot, needsFileReselect: missing > 0 },
    }));
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

  if (projectsOpen) {
    return <ProjectList projects={projects} loading={projectBusy} error={projectError}
      onOpen={(id) => void openProject(id)} onCreate={(name) => void newProject(name)} />;
  }

  return (
    <div className="h-dvh w-full flex flex-col pb-[env(safe-area-inset-bottom)] bg-[#101114] text-zinc-100 overflow-hidden">
      {editing ? (
        <header className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-[#14161A] px-3 py-1">
          <button type="button" onClick={() => setEditing(false)} className="min-h-11 shrink-0 rounded-md px-2 text-sm font-medium hover:bg-white/10">Back</button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-300" title={selectedFrame?.filename}>{selectedFrame?.filename ?? 'Edit photo'}</h1>
          {!filmstripVisible && (
            <div className="flex shrink-0">
              <button type="button" aria-label="Previous photo" disabled={selectedVisibleIndex <= 0} onClick={() => handleStepFrame(-1)}
                className="h-11 w-11 rounded-md text-lg disabled:opacity-30">‹</button>
              <button type="button" aria-label="Next photo" disabled={selectedVisibleIndex < 0 || selectedVisibleIndex >= visibleFrames.length - 1} onClick={() => handleStepFrame(1)}
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
            const nextVisible = filterFrames(prev.frames, next, prev.searchQuery);
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
        searchQuery={cullingState.searchQuery}
        onSearchChange={(q) =>
          setCullingState((prev) => {
            const nextVisible = filterFrames(prev.frames, prev.filter, q);
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
        actionsDisabled={Boolean(loadingProgress) || projectBusy}
        onOpenMacroPadModal={() => setMacroPadModal(true)}
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
        onClearDecision={selectedFrame && selectedFrame.decision !== 'unreviewed' ? () => executeCommand('cull.unreviewed') : undefined}
        onRedo={cullingState.redoStack.length ? () => executeCommand('cull.redo') : undefined}
        onEditPhoto={selectedFrame && !loadingProgress ? () => setEditing(true) : undefined}
      />}

      <input ref={relinkInput} type="file" hidden multiple accept=".jpg,.jpeg,.png,.webp,.nef"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) reconnectFileSelection(files);
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
      {projectError && <p role="alert" className="bg-orange-950 px-3 py-2 text-sm text-orange-100">{projectError}</p>}

      <main key={previewRevision} className="relative flex-1 flex min-h-0 min-w-0">
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {editing && selectedFrame && (
            <PhotoEditor
              key={selectedFrame.id}
              frame={selectedFrame}
              bindings={prefs.bindings}
              provider={previewProviderRef.current!}
              needsAccess={needsAccess}
              onEdit={(edit) => updateFrame(selectedFrame.id, { edit: isNeutralEdit(edit) ? undefined : { ...edit } })}
              copiedEdit={copiedEdit}
              onCopyEdit={setCopiedEdit}
              onCreateVirtualCopy={addVirtualCopy}
              onFramingChange={(framing) => updateFrame(selectedFrame.id, { framing })}
              onRemoveVirtualCopy={selectedFrame.virtualCopy ? removeVirtualCopy : undefined}
              panelSide={prefs.editPanelSide}
              onPanelSideChange={(side) => setPrefs((prev) => ({ ...prev, editPanelSide: side }))}
              showFilmstrip={filmstripVisible}
              onToggleFilmstrip={() => setPrefs((prev) => ({
                ...prev, showFilmstrip: !filmstripVisible, focusMode: false,
              }))}
              keeperCount={counts.keep}
              onApplyToKeepers={applyEditToKeepers}
              onUndoKeeperEdits={batchUndo ? undoKeeperEdits : undefined}
              onSubjectsChange={(subjectNames) => updateFrame(selectedFrame.id, { subjectNames })}
            />
          )}
          {!editing && cullingState.frames.length === 0 && (
            <div className="grid flex-1 place-items-center p-4">
              <div className="text-center">
                <h2 className="mb-3 text-sm text-zinc-300">This project has no photos yet</h2>
                <button type="button" disabled={Boolean(loadingProgress)} onClick={() => setOpenShootModal(true)}
                  className="min-h-11 rounded-lg bg-sky-200 px-4 text-sm font-semibold text-zinc-950 disabled:opacity-40">Add photos</button>
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
          {!editing && cullingState.frames.length > 0 && !visibleFrames.length && (
            <div className="grid flex-1 place-items-center p-4">
              <p className="text-sm text-zinc-300">{cullingState.searchQuery ? 'No photos match this search.' : cullingState.filter === 'unreviewed' ? 'You’re caught up. Your picks are in Keepers.' :
                cullingState.filter === 'keep' ? 'Flag a photo as Keep to see it here.' : 'No rejected photos.'}</p>
            </div>
          )}
          {!editing && visibleFrames.length > 0 && prefs.viewMode === 'grid' && (
            <VirtualizedContactSheet
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
              onStepSide={(side, delta) => {
                const pool =
                  visibleFrames.length > 0 ? visibleFrames : cullingState.frames;
                if (side === 'left') {
                  const nextId = stepSelection(pool, selectedFrame?.id ?? null, delta);
                  if (nextId) {
                    setCullingState((prev) => ({ ...prev, selectedFrameId: nextId }));
                  }
                } else {
                  const nextId = stepSelection(
                    pool,
                    compareRightFrame?.id ?? null,
                    delta
                  );
                  if (nextId) {
                    setCullingState((prev) => ({
                      ...prev,
                      compareRightFrameId: nextId,
                    }));
                  }
                }
              }}
              onDecideFrame={(frameId, decision) =>
                handleDecideFrame(frameId, decision, false)
              }
              onExitCompare={() =>
                setPrefs((prev) => ({ ...prev, viewMode: 'loupe' }))
              }
            />
          )}

          {/* Persistent Filmstrip in Loupe & Compare Modes */}
          {filmstripVisible && (editing || prefs.viewMode !== 'grid') && visibleFrames.length > 0 && (
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
          )}
        </div>

        {!editing && showPhotoInfo && (
          <ExifInspector onRate={(id, rating) => rateOrFlagPhotos(id, { rating })}
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

      {exportFrames.length > 0 && <PhotoExportPanel frames={exportFrames} provider={previewProviderRef.current!}
        onClose={() => setExportFrames([])} />}

      <MacroPadModal
        open={macroPadModal}
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
