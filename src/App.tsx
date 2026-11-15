import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createVirtualCopy } from './core/virtualCopies';
import { PhotoEditor } from './components/PhotoEditor';
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
  const [showPhotoInfo, setShowPhotoInfo] = useState(false);
  const [copiedEdit, setCopiedEdit] = useState<PhotoEdit | null>(null);
  const [batchUndo, setBatchUndo] = useState<{
    applied: PhotoEdit;
    previous: ReadonlyMap<string, PhotoEdit | undefined>;
  } | null>(null);
  const [hydrated, setHydrated] = useState(false);

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

  // Restore saved shoot & decisions from IndexedDB on initial mount
  useEffect(() => {
    let active = true;
    const store = storeRef.current!;
    const preview = previewProviderRef.current!;

    const restore = async () => {
      const saved = await store.loadActiveState();
      if (!active) return;

      if (saved && saved.shoot && Array.isArray(saved.frames) && saved.frames.length > 0) {
        let restoredShoot = saved.shoot;
        let restoredFrames = saved.frames;

        if (restoredShoot.sourceKind === 'local-files') {
          const ok = await rehydrateLocalFramesFromStore(restoredFrames, preview, store);
          restoredShoot = { ...restoredShoot, needsFileReselect: !ok };
        } else if (restoredShoot.sourceKind === 'local-folder') {
          const handle = await store.loadDirectoryHandle(restoredShoot.id);
          if (handle) {
            const perm = await (
              handle as FileSystemDirectoryHandle & {
                queryPermission?: (desc: { mode: 'read' }) => Promise<PermissionState>;
              }
            ).queryPermission?.({ mode: 'read' });

            if (perm === 'granted') {
              const entries = await readFilesFromDirectoryHandle(handle);
              for (const entry of entries) {
                preview.registerBlob(`folder://${entry.relativePath}`, entry.file);
              }
              restoredShoot = { ...restoredShoot, needsFolderRegrant: false };
            } else {
              restoredShoot = { ...restoredShoot, needsFolderRegrant: true };
            }
          } else {
            restoredShoot = { ...restoredShoot, needsFolderRegrant: true };
          }
        }

        if (!active) return;
        setCullingState({
          shoot: restoredShoot,
          frames: restoredFrames,
          selectedFrameId: saved.selectedFrameId ?? restoredFrames[0]?.id ?? null,
          compareRightFrameId:
            saved.compareRightFrameId ?? restoredFrames[1]?.id ?? null,
          filter: saved.filter ?? 'all',
          searchQuery: saved.searchQuery ?? '',
          keeperTarget: saved.keeperTarget ?? DEFAULT_KEEPER_TARGET,
          autoAdvance: saved.autoAdvance ?? true,
          undoStack: saved.undoStack ?? [],
          redoStack: saved.redoStack ?? [],
        });
      } else {
        // Fresh 500-frame demo shoot with smooth progressive frame reveal
        const fullDemo = createDemoShootState(500);
        setLoadingProgress({ loaded: 60, total: 500 });
        setCullingState({
          ...fullDemo,
          frames: fullDemo.frames.slice(0, 60),
        });

        let loaded = 60;
        const step = () => {
          if (!active) return;
          loaded = Math.min(500, loaded + 110);
          setCullingState((prev) => ({
            ...prev,
            frames: fullDemo.frames.slice(0, loaded),
          }));
          if (loaded < 500) {
            setLoadingProgress({ loaded, total: 500 });
            setTimeout(step, 25);
          } else {
            setLoadingProgress(null);
          }
        };
        setTimeout(step, 25);
      }

      if (active) setHydrated(true);
    };

    restore();
    return () => {
      active = false;
    };
  }, []);

  // Persist cullingState whenever it changes after initial hydration
  useEffect(() => {
    if (!hydrated) return;
    const store = storeRef.current!;
    store.saveCullingState(cullingState);
  }, [cullingState, hydrated]);

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

  const updateFrame = (frameId: string, patch: Pick<PhotoFrame, 'edit' | 'subjectNames'>) => {
    setCullingState((prev) => ({
      ...prev,
      shoot: { ...prev.shoot, lastUpdatedAt: Date.now() },
      frames: prev.frames.map((frame) =>
        frame.id === frameId ? { ...frame, ...patch } : frame
      ),
    }));
  };

  const addVirtualCopy = () => {
    if (!selectedFrame) return;
    const id = `copy-${crypto.randomUUID()}`;
    const sourceId = selectedFrame.id;
    setCullingState((prev) => {
      const index = prev.frames.findIndex((frame) => frame.id === sourceId);
      if (index < 0) return prev;
      const copy = createVirtualCopy(prev.frames[index], prev.frames, id);
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
  }, [editing, openShootModal, macroPadModal, prefs.bindings, executeCommand]);

  // Shoot loading handlers
  const handleLoadDemoShoot = () => {
    setRelinkStatus(undefined);
    setBatchUndo(null);
    previewProviderRef.current?.clear();
    const demo = createDemoShootState(500);
    setCullingState(demo);
    setBannerDismissed(false);
    setOpenShootModal(false);
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleSelectLocalFiles = async (files: File[]) => {
    setRelinkStatus(undefined);
    setBatchUndo(null);
    setOpenShootModal(false);
    setBannerDismissed(false);
    setFolderError(null);
    const preview = previewProviderRef.current!;
    const store = storeRef.current!;
    preview.clear();

    setLoadingProgress({ loaded: 0, total: files.length });
    const { shoot, frames } = await loadLocalFileListShoot(
      files,
      preview,
      store,
      ({ frames: partial, loaded, total }) => {
        setLoadingProgress({ loaded, total });
        setCullingState((prev) => ({
          ...prev,
          frames: partial,
          selectedFrameId: prev.selectedFrameId ?? partial[0]?.id ?? null,
        }));
      }
    );

    setLoadingProgress(null);
    setCullingState({
      shoot,
      frames,
      selectedFrameId: frames[0]?.id ?? null,
      compareRightFrameId: frames[1]?.id ?? null,
      filter: 'all',
      searchQuery: '',
      keeperTarget: cullingState.keeperTarget,
      autoAdvance: cullingState.autoAdvance,
      undoStack: [],
      redoStack: [],
    });
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleOpenLocalFolder = async () => {
    setFolderError(null);
    try {
      const picker = (
        window as Window & {
          showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker;
      if (!picker) {
        setFolderError('Folder picker is not supported in this browser.');
        return;
      }

      const dirHandle = await picker();
      setRelinkStatus(undefined);
      setBatchUndo(null);
      setOpenShootModal(false);
      setBannerDismissed(false);

      const preview = previewProviderRef.current!;
      const store = storeRef.current!;
      preview.clear();

      const { shoot, frames } = await loadDirectoryHandleShoot(
        dirHandle,
        preview,
        store,
        ({ frames: partial, loaded, total }) => {
          setLoadingProgress({ loaded, total });
          setCullingState((prev) => ({
            ...prev,
            frames: partial,
            selectedFrameId: prev.selectedFrameId ?? partial[0]?.id ?? null,
          }));
        }
      );

      setLoadingProgress(null);
      setCullingState({
        shoot,
        frames,
        selectedFrameId: frames[0]?.id ?? null,
        compareRightFrameId: frames[1]?.id ?? null,
        filter: 'all',
        searchQuery: '',
        keeperTarget: cullingState.keeperTarget,
        autoAdvance: cullingState.autoAdvance,
        undoStack: [],
        redoStack: [],
      });
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setFolderError(
          'Folder access was blocked or cancelled. Use Select Files instead if inside a restricted frame.'
        );
      }
    }
  };

  const reconnectFileSelection = (files: File[]) => {
    const preview = previewProviderRef.current!;
    const expected = new Set(cullingState.frames.map((frame) => frame.stableKey));
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

    if (shoot.sourceKind === 'local-files') {
      relinkInput.current?.click();
      return;
    }
    if (shoot.sourceKind === 'local-folder') {
      const handle = await store.loadDirectoryHandle(shoot.id);
      if (handle) {
        const perm = await (
          handle as FileSystemDirectoryHandle & {
            requestPermission?: (desc: { mode: 'read' }) => Promise<PermissionState>;
          }
        ).requestPermission?.({ mode: 'read' });

        if (perm === 'granted') {
          const entries = await readFilesFromDirectoryHandle(handle);
          for (const entry of entries) {
            preview.registerBlob(`folder://${entry.relativePath}`, entry.file);
          }
          setCullingState((prev) => ({
            ...prev,
            shoot: { ...prev.shoot, needsFolderRegrant: false },
          }));
          return;
        }
      }
    }
    setOpenShootModal(true);
  };

  const needsAccess = Boolean(
    cullingState.shoot.needsFolderRegrant || cullingState.shoot.needsFileReselect
  );

  return (
    <div className="h-dvh w-full flex flex-col pb-[env(safe-area-inset-bottom)] bg-[#101114] text-zinc-100 overflow-hidden">
      {editing ? (
        <header className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-[#14161A] px-3 py-1">
          <button type="button" onClick={() => setEditing(false)} className="min-h-11 shrink-0 rounded-md px-2 text-sm font-medium hover:bg-white/10">Back</button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-300" title={selectedFrame?.filename}>{selectedFrame?.filename ?? 'Edit photo'}</h1>
          {!prefs.showFilmstrip && (
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
        onOpenShootModal={() => setOpenShootModal(true)}
        onOpenMacroPadModal={() => setMacroPadModal(true)}
        loadingProgress={loadingProgress}
        showFilmstrip={prefs.showFilmstrip}
        onToggleFilmstrip={toggleFilmstrip}
        showPhotoInfo={showPhotoInfo}
        onTogglePhotoInfo={() => setShowPhotoInfo((visible) => !visible)}
        autoAdvance={cullingState.autoAdvance}
        onToggleAutoAdvance={() =>
          setCullingState((prev) => ({ ...prev, autoAdvance: !prev.autoAdvance }))
        }
        onClearDecision={selectedFrame && selectedFrame.decision !== 'unreviewed' ? () => executeCommand('cull.unreviewed') : undefined}
        onRedo={cullingState.redoStack.length ? () => executeCommand('cull.redo') : undefined}
        onEditPhoto={selectedFrame && hydrated && !loadingProgress ? () => setEditing(true) : undefined}
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
      <main key={previewRevision} className="relative flex-1 flex min-h-0 min-w-0">
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {editing && selectedFrame && (
            <PhotoEditor
              key={selectedFrame.id}
              frame={selectedFrame}
              provider={previewProviderRef.current!}
              needsAccess={needsAccess}
              onEdit={(edit) => updateFrame(selectedFrame.id, { edit: isNeutralEdit(edit) ? undefined : { ...edit } })}
              copiedEdit={copiedEdit}
              onCopyEdit={setCopiedEdit}
              onCreateVirtualCopy={addVirtualCopy}
              onRemoveVirtualCopy={selectedFrame.virtualCopy ? removeVirtualCopy : undefined}
              panelSide={prefs.editPanelSide}
              onPanelSideChange={(side) => setPrefs((prev) => ({ ...prev, editPanelSide: side }))}
              showFilmstrip={prefs.showFilmstrip}
              onToggleFilmstrip={toggleFilmstrip}
              keeperCount={counts.keep}
              onApplyToKeepers={applyEditToKeepers}
              onUndoKeeperEdits={batchUndo ? undoKeeperEdits : undefined}
              onSubjectsChange={(subjectNames) => updateFrame(selectedFrame.id, { subjectNames })}
            />
          )}
          {!editing && prefs.viewMode === 'grid' && (
            <VirtualizedContactSheet
              frames={visibleFrames}
              selectedFrameId={selectedFrame?.id ?? null}
              previewProvider={previewProviderRef.current!}
              needsAccess={needsAccess}
              onSelectFrame={handleSelectFrame}
              onOpenLoupe={(frameId) => {
                handleSelectFrame(frameId);
                setPrefs((prev) => ({ ...prev, viewMode: 'loupe' }));
              }}
              onDecideFrame={(frameId, decision) =>
                handleDecideFrame(frameId, decision, false)
              }
            />
          )}

          {!editing && prefs.viewMode === 'loupe' && (
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
              showShortcutsOverlay={prefs.showShortcutsOverlay}
              onExecuteCommand={executeCommand}
              onStepFrame={handleStepFrame}
            />
          )}

          {!editing && prefs.viewMode === 'compare' && (
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
          {prefs.showFilmstrip && (editing || prefs.viewMode !== 'grid') && visibleFrames.length > 0 && (
            <Filmstrip
              frames={visibleFrames}
              selectedFrameId={selectedFrame?.id ?? null}
              compareRightFrameId={compareRightFrame?.id ?? null}
              isCompareMode={!editing && prefs.viewMode === 'compare'}
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
          <ExifInspector frame={selectedFrame} onClose={() => setShowPhotoInfo(false)} />
        )}
      </main>

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
        onLoadDemoShoot={handleLoadDemoShoot}
        onSelectLocalFiles={handleSelectLocalFiles}
        onOpenLocalFolder={handleOpenLocalFolder}
        folderError={folderError}
      />
    </div>
  );
}
