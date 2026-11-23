import React, { useEffect, useRef, useState } from 'react';
import type { PanelId } from './contract';
import { useWorkspace } from './stub';
import { STRINGS } from './strings';
import BrandIcon, { assistModeIconName } from './icons/BrandIcon';
import ProjectsHub from './screens/ProjectsHub';
import { FeaturePlanContext } from './shell/ProBadge';
import TopBar from './shell/TopBar';
import Rail from './shell/Rail';
import DockPanel from './shell/DockPanel';
import Canvas from './shell/Canvas';
import Filmstrip from './shell/Filmstrip';
import GridView from './shell/GridView';
import CoPilotPanel from './panels/CoPilotPanel';
import AdjustPanel from './panels/AdjustPanel';
import SizesPanel from './panels/SizesPanel';
import HistoryPanel from './panels/HistoryPanel';
import MasksPanel from './panels/MasksPanel';
import EnhancePanel from './panels/EnhancePanel';
import OverlayPanel from './panels/OverlayPanel';
import AssistPanel from './panels/AssistPanel';
import InfoPanel from './panels/InfoPanel';
import TasksPanel from './panels/TasksPanel';
import ExportDialog from './dialogs/ExportDialog';
import SettingsDialog from './dialogs/SettingsDialog';
import ShortcutGuide from './dialogs/ShortcutGuide';
import CommandPalette from './dialogs/CommandPalette';
import { effectiveKeymap, loadKeymap, resolveCommand, saveKeymap, type SavedKeymap } from './commands/keymap';
import KeyboardSettings from './dialogs/KeyboardSettings';
import type { CommandDefinition } from './commands/registry';

const IS_MAC = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

const PANEL_TITLES: Record<PanelId, string> = {
  copilot: STRINGS.copilot.heading,
  adjust: STRINGS.rail.adjust,
  formats: STRINGS.formats.heading,
  masks: STRINGS.masks.heading,
  enhance: STRINGS.enhance.heading,
  overlays: STRINGS.overlays.heading,
  assist: STRINGS.assist.heading,
  info: STRINGS.info.heading,
  history: STRINGS.history.heading,
  tasks: STRINGS.tasks.heading,
};

export default function App({ useStore = useWorkspace, accountPanel }: {
  useStore?: typeof useWorkspace;
  accountPanel?: React.ReactNode;
} = {}) {
  const { store, actions } = useStore();
  const { setActivePanel } = actions;
  const hasOverlays = store.features.overlayText || store.features.watermarkCustom;
  const [shortcutGuideOpen, setShortcutGuideOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [savedKeymap, setSavedKeymap] = useState<SavedKeymap>(loadKeymap);
  const keymap = React.useMemo(() => effectiveKeymap(savedKeymap.preset, savedKeymap.overrides), [savedKeymap]);
  const changeKeymap = React.useCallback((next: SavedKeymap) => { saveKeymap(next); setSavedKeymap(next); }, []);
  const [moreOpen, setMoreOpen] = useState(false);
  const sheetDragY = useRef<number | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      if (e.matches) setActivePanel(null);
    };
    setIsMobile(mq.matches);
    if (mq.matches) setActivePanel(null);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [setActivePanel]);

  const activePhoto =
    store.photos.find((p) => p.id === store.activePhotoId) ?? store.photos[0] ?? null;
  const hoveredLook = store.looks.find((l) => l.id === store.hoveredLookId) ?? null;
  const runningTaskCount = store.tasks.filter((t) => t.status === 'running').length;

  // Auto-dismiss quiet action notice
  useEffect(() => {
    if (!store.lastActionNotice) return;
    const t = window.setTimeout(() => actions.clearNotice(), 3200);
    return () => clearTimeout(t);
  }, [store.lastActionNotice, actions]);

  // One dispatch for every command id, shared by the keydown handler below and the command search dialog,
  // so "what Cmd/Ctrl+K can run" and "what the keyboard shortcut runs" never drift apart.
  const runCommand = React.useCallback((command: CommandDefinition) => {
    const ids = store.selectedPhotoIds.length > 0 ? store.selectedPhotoIds : activePhoto ? [activePhoto.id] : [];
    switch (command.id) {
      case 'help.toggle': setShortcutGuideOpen((open) => !open); break;
      case 'app.commandSearch': setCommandPaletteOpen((open) => !open); break;
      case 'photo.flag': if (ids.length) actions.toggleFlag(ids); break;
      case 'photo.rate0': case 'photo.rate1': case 'photo.rate2':
      case 'photo.rate3': case 'photo.rate4': case 'photo.rate5':
        if (ids.length) actions.setRating(ids, Number(command.id.slice(-1)));
        break;
      case 'view.grid': actions.setGridViewOpen(!store.gridViewOpen); break;
      case 'view.compare': actions.setCompareMode(!store.compareMode); break;
      case 'view.fullscreen': actions.toggleFullScreen(); break;
      case 'edit.undo': actions.undo(); break;
      case 'edit.redo': actions.redo(); break;
      case 'edit.copy': actions.copyRecipe(); break;
      case 'edit.paste': actions.pasteRecipe(); break;
      case 'edit.selectAll': actions.selectAllPhotos(); break;
      case 'file.export': actions.setExportOpen(true); break;
      case 'app.settings': actions.setSettingsOpen(true); break;
    }
  }, [store.selectedPhotoIds, store.gridViewOpen, store.compareMode, activePhoto, actions]);

  // Desktop keyboard shortcuts + suppress browser Ctrl/Cmd+A inside editor workspace
  useEffect(() => {
    if (store.screen !== 'editor') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        Boolean(target?.isContentEditable);
      const command = resolveCommand({ event: e, keymap, isMac: IS_MAC, inField });
      if (!command) return;
      // While the guide is open only it, Export, Settings and Edit commands act; photo and view keys wait.
      if (shortcutGuideOpen && (command.group === 'photos' || command.group === 'view')) return;
      e.preventDefault();
      runCommand(command);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [store.screen, shortcutGuideOpen, keymap, runCommand]);

  const renderPanelContent = (panelId: PanelId) => {
    switch (panelId) {
      case 'copilot':
        return (
          <CoPilotPanel
            photo={activePhoto}
            assistMode={store.assistMode}
            features={store.features}
            ongoingCritique={store.settings.ongoingCritique}
            reviewing={store.reviewingPhotoIds.includes(activePhoto?.id ?? '')}
            onSetAssistMode={actions.setAssistMode}
            onOpenSettings={() => actions.setSettingsOpen(true, 'assistance')}
            onRunDeepVisionReview={actions.runDeepVisionReview}
            onApplySuggestion={actions.applyAssistSuggestion}
            onApplyAll={actions.applyAllAssistSuggestions}
            onDismissSuggestion={actions.dismissAssistSuggestion}
          />
        );
      case 'adjust':
        return (
          <AdjustPanel
            photo={activePhoto}
            selectedPhotoCount={store.selectedPhotoIds.length}
            looks={store.looks}
            cvdGuidance={store.settings.cvdGuidance}
            calmView={store.settings.calmView}
            onUpdateRecipe={actions.updateRecipe}
            onApplyLook={actions.applyLook}
            onHoverLook={actions.setHoveredLook}
            onResetPhoto={actions.resetPhotoEdits}
          />
        );
      case 'formats':
        return (
          <SizesPanel
            photo={activePhoto}
            activeSizeId={store.activeSizeId}
            selectedSizeIds={store.selectedSizeIds}
            canvasLayoutMode={store.canvasLayoutMode}
            features={store.features}
            onSetActiveGroup={actions.setActiveGroup}
            onAddEditGroup={actions.addEditGroup}
            onSetActiveSize={actions.setActiveSize}
            onSetCanvasLayoutMode={actions.setCanvasLayoutMode}
            onToggleSizeEnabled={actions.toggleSizeEnabled}
            onToggleSizeLinked={actions.toggleSizeLinked}
            onUpdateSizeCrop={actions.updateSizeCrop}
            onFlipSizes={actions.flipSelectedSizes}
            onRotateSizes={actions.rotateSelectedSizes}
            onResetSizeCrop={actions.resetSizeCrop}
            onAddCustomSize={actions.addCustomSize}
            onToggleSplitFrames={actions.toggleSplitFrames}
            onUpdateVideoZoom={actions.updateVideoZoom}
          />
        );
      case 'masks':
        return (
          <MasksPanel
            photo={activePhoto}
            activeMaskTool={store.activeMaskTool}
            onSetMaskTool={actions.setActiveMaskTool}
            onAddMaskLayer={actions.addMaskLayer}
            onToggleMaskLayer={actions.toggleMaskLayer}
            onRemoveMaskLayer={actions.removeMaskLayer}
            onSetMaskEdit={actions.setMaskEdit}
            onSetMaskFeather={actions.setMaskFeather}
          />
        );
      case 'enhance':
        return (
          <EnhancePanel
            photo={activePhoto}
            calmView={store.settings.calmView}
            onUpdateRecipe={actions.updateRecipe}
            onDenoise={actions.denoisePhoto}
            cloudEnabled={store.features.cloudAssist}
          />
        );
      case 'overlays':
        return (
          <OverlayPanel
            photo={activePhoto}
            fonts={store.fonts}
            watermarkPresets={store.watermarkPresets}
            features={store.features}
            onUpdateOverlay={actions.updateOverlay}
            onAlignOverlaysCleanly={actions.alignOverlaysCleanly}
            onAddRow={actions.addOverlayRow}
            onUpdateRow={actions.updateOverlayRow}
            onRemoveRow={actions.removeOverlayRow}
            onAddCustomFont={actions.addCustomFont}
            onListDeviceFonts={actions.listDeviceFonts}
            onHasDeviceFont={actions.hasDeviceFont}
            onImportWatermark={actions.importWatermarkImage}
            onCutOutWatermark={actions.cutOutWatermark}
            onMakeWatermarkVariant={actions.makeWatermarkVariant}
            onDeleteWatermark={actions.deleteWatermark}
          />
        );
      case 'assist':
        return (
          <AssistPanel
            photo={activePhoto}
            onRefreshReview={actions.runDeepVisionReview}
            onApplySuggestion={actions.applyAssistSuggestion}
          />
        );
      case 'history':
        return <HistoryPanel photo={activePhoto} onJumpToStep={actions.jumpToEditStep} />;
      case 'info':
        return (
          <InfoPanel
            photo={activePhoto}
            onToggleFlag={actions.toggleFlag}
            onSetRating={actions.setRating}
            onReconnectOriginal={actions.reconnectOriginal}
            onCorrectSpeciesName={actions.correctSpeciesName}
          />
        );
      case 'tasks':
        return <TasksPanel tasks={store.tasks} onCancelTask={actions.cancelTask} onClearTask={actions.clearTask} onClearCompleted={actions.clearCompletedTasks} />;
    }
  };

  const activePanelState = store.activePanel ? store.panels[store.activePanel] : null;
  const activePanelVisible = Boolean(store.activePanel && activePanelState?.visible);

  return (
    <FeaturePlanContext.Provider value={store.featurePlan}>
    <div
      className="inflight-v2 fixed inset-0 flex flex-col overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)] font-[family-name:var(--font-sans)]"
      data-v2-theme={store.settings.theme}
      onDragOver={(e) => {
        if (store.screen === 'editor' && Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(e) => {
        if (store.screen !== 'editor' || !Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        if (files.length) actions.importDroppedPhotos(files);
      }}
      onContextMenu={(e) => {
        // Suppress native browser context menu inside the studio workspace
        const target = e.target as HTMLElement | null;
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
        e.preventDefault();
      }}
    >
      {store.screen === 'hub' ? (
        <ProjectsHub
          projects={store.projects}
          hubState={store.hubState}
          theme={store.settings.theme}
          onOpenProject={actions.openProject}
          onCreateProject={actions.createProject}
          onCreateFromFolder={actions.createProjectFromFolder}
          onRenameProject={actions.renameProject}
          onArchiveProject={actions.archiveProject}
          onDeleteProject={actions.deleteProject}
          onOpenSettings={() => actions.setSettingsOpen(true, 'appearance')}
          onToggleTheme={() =>
            actions.updateSettings({ theme: store.settings.theme === 'dark' ? 'light' : 'dark' })
          }
          onSetHubState={actions.setHubState}
        />
      ) : (
        <>
          <TopBar
            photoName={activePhoto ? `${activePhoto.title} · ${activePhoto.filename}` : 'No photo'}
            assistMode={store.assistMode}
            theme={store.settings.theme}
            activePanel={store.activePanel}
            canUndo={store.canUndo}
            canRedo={store.canRedo}
            hasClipboardRecipe={Boolean(store.clipboardRecipe)}
            compareMode={store.compareMode}
            gridViewOpen={store.gridViewOpen}
            filmstripCollapsed={store.filmstripCollapsed}
            onBack={actions.backToProjects}
            onSetAssistMode={actions.setAssistMode}
            onExport={() => actions.setExportOpen(true)}
            onOpenSettings={() => actions.setSettingsOpen(true)}
            onImport={actions.importPhotos}
            onUndo={actions.undo}
            onRedo={actions.redo}
            onCopyRecipe={actions.copyRecipe}
            onPasteRecipe={actions.pasteRecipe}
            onResetPhoto={() => activePhoto && actions.resetPhotoEdits(activePhoto.id)}
            onSelectAll={actions.selectAllPhotos}
            onClearSelection={actions.clearSelection}
            onToggleFilmstrip={() => actions.setFilmstripCollapsed(!store.filmstripCollapsed)}
            onToggleGridView={() => actions.setGridViewOpen(!store.gridViewOpen)}
            onToggleCompare={() => actions.setCompareMode(!store.compareMode)}
            onDockActivePanel={(dock) => store.activePanel && actions.setPanelDock(store.activePanel, dock)}
            onResetLayout={actions.resetPanelLayout}
            onToggleTheme={() =>
              actions.updateSettings({ theme: store.settings.theme === 'dark' ? 'light' : 'dark' })
            }
            onToggleDemoUnavailable={actions.toggleDemoUnavailable}
          />

          {/* Main Workspace Row */}
          <div className={`relative flex min-h-0 flex-1 overflow-hidden ${store.settings.hand === 'left' ? 'flex-row-reverse' : ''}`}>
            <Rail
              hand={store.settings.hand}
              hiddenPanels={hasOverlays ? [] : ['overlays']}
              assistMode={store.assistMode}
              activePanel={store.activePanel}
              panels={store.panels}
              runningTaskCount={runningTaskCount}
              taskProgress={runningTaskCount ? store.tasks.filter((t) => t.status === 'running').reduce((sum, t) => sum + t.progress, 0) / runningTaskCount : 0}
              onOpenTasks={() => actions.setActivePanel(store.activePanel === 'tasks' ? null : 'tasks')}
              onOpenModeSettings={() => actions.setSettingsOpen(true, 'assistance')}
              calmView={store.settings.calmView}
              onSelectPanel={actions.setActivePanel}
              onSetPanelVisible={actions.setPanelVisible}
              onSetPanelDock={actions.setPanelDock}
              onOpenSettings={() => actions.setSettingsOpen(true)}
            />

            {/* Left-docked panel (desktop/tablet only) */}
            {!isMobile && activePanelVisible && store.activePanel && activePanelState?.dock === 'left' && (
              <DockPanel
                panelId={store.activePanel}
                title={PANEL_TITLES[store.activePanel]}
                dock="left"
                floatX={activePanelState.floatX}
                floatY={activePanelState.floatY}
                onSetDock={(dock) => actions.setPanelDock(store.activePanel!, dock)}
                onMoveFloat={(x, y) => actions.moveFloatingPanel(store.activePanel!, x, y)}
                onClose={() => actions.setActivePanel(null)}
              >
                {renderPanelContent(store.activePanel)}
              </DockPanel>
            )}

            {/* Centre column: Canvas (or GridView) + Bottom Filmstrip/Info Dock */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {store.gridViewOpen ? (
                <GridView
                  photos={store.photos}
                  activePhotoId={store.activePhotoId}
                  selectedPhotoIds={store.selectedPhotoIds}
                  filter={store.filmstripFilter}
                  search={store.filmstripSearch}
                  onSelectPhoto={actions.selectPhoto}
                  onOpenInEditor={(id) => {
                    actions.selectPhoto(id);
                    actions.setGridViewOpen(false);
                  }}
                  onToggleFlag={actions.toggleFlag}
                  onSetRating={actions.setRating}
                  onSetFilter={actions.setFilmstripFilter}
                  onSetSearch={actions.setFilmstripSearch}
                  onClose={() => actions.setGridViewOpen(false)}
                />
              ) : (
                <Canvas
                  PhotoSurface={store.PhotoSurface}
                  photo={activePhoto}
                  activeSizeId={store.activeSizeId}
                  selectedSizeIds={store.selectedSizeIds}
                  canvasLayoutMode={store.canvasLayoutMode}
                  hoveredLook={hoveredLook}
                  fonts={store.fonts}
                  watermarkPresets={store.watermarkPresets}
                  features={store.features}
                  compareMode={store.compareMode}
                  canvasZoom={store.canvasZoom}
                  isFullScreen={store.isFullScreen}
                  calmView={store.settings.calmView}
                  onSelectSize={actions.setActiveSize}
                  onSelectAllSizes={actions.selectAllEnabledSizes}
                  onSetLayoutMode={actions.setCanvasLayoutMode}
                  onMoveArtboard={actions.moveSizeArtboard}
                  onResetArtboards={actions.resetArtboardPositions}
                  onUpdateCrop={actions.updateSizeCrop}
                  onFlipSizes={actions.flipSelectedSizes}
                  onRotateSizes={actions.rotateSelectedSizes}
                  onToggleSplitFrames={actions.toggleSplitFrames}
                  onSetSplitPanOffset={actions.setSplitPanOffset}
                  onUpdateVideoZoom={actions.updateVideoZoom}
                  onUpdateOverlay={actions.updateOverlay}
                  onReconnectOriginal={actions.reconnectOriginal}
                  onToggleCompare={() => actions.setCompareMode(!store.compareMode)}
                  onSetZoom={actions.setCanvasZoom}
                  onToggleGridView={() => actions.setGridViewOpen(true)}
                  onToggleFullScreen={actions.toggleFullScreen}
                />
              )}

              <Filmstrip
                photos={store.photos}
                activePhoto={activePhoto}
                selectedPhotoIds={store.selectedPhotoIds}
                assistMode={store.assistMode}
                bottomTab={store.bottomTab}
                collapsed={store.filmstripCollapsed}
                height={store.filmstripHeight}
                filter={store.filmstripFilter}
                search={store.filmstripSearch}
                calmView={store.settings.calmView}
                looks={store.looks}
                hasClipboardRecipe={Boolean(store.clipboardRecipe)}
                onSetBottomTab={actions.setBottomTab}
                onSetCollapsed={actions.setFilmstripCollapsed}
                onSetHeight={actions.setFilmstripHeight}
                onSetFilter={actions.setFilmstripFilter}
                onSetSearch={actions.setFilmstripSearch}
                onSelectPhoto={actions.selectPhoto}
                onClearSelection={actions.clearSelection}
                onToggleFlag={actions.toggleFlag}
                onSetRating={actions.setRating}
                onSetDecision={actions.setDecision}
                onRemovePhotos={actions.removePhotos}
                onPasteRecipe={actions.pasteRecipe}
                onApplyLook={actions.applyLook}
                onImport={actions.importPhotos}
                onImportFolder={actions.importFolder}
                onRunAutoCull={actions.runAutoCull}
                onExportSelected={() => actions.setExportOpen(true)}
              />
            </div>

            {/* Right-docked panel (desktop/tablet only) */}
            {!isMobile && activePanelVisible && store.activePanel && activePanelState?.dock === 'right' && (
              <DockPanel
                panelId={store.activePanel}
                title={PANEL_TITLES[store.activePanel]}
                dock="right"
                floatX={activePanelState.floatX}
                floatY={activePanelState.floatY}
                onSetDock={(dock) => actions.setPanelDock(store.activePanel!, dock)}
                onMoveFloat={(x, y) => actions.moveFloatingPanel(store.activePanel!, x, y)}
                onClose={() => actions.setActivePanel(null)}
              >
                {renderPanelContent(store.activePanel)}
              </DockPanel>
            )}

            {/* Floating panel (desktop/tablet only) */}
            {!isMobile && activePanelVisible && store.activePanel && activePanelState?.dock === 'float' && (
              <DockPanel
                panelId={store.activePanel}
                title={PANEL_TITLES[store.activePanel]}
                dock="float"
                floatX={activePanelState.floatX}
                floatY={activePanelState.floatY}
                onSetDock={(dock) => actions.setPanelDock(store.activePanel!, dock)}
                onMoveFloat={(x, y) => actions.moveFloatingPanel(store.activePanel!, x, y)}
                onClose={() => actions.setActivePanel(null)}
              >
                {renderPanelContent(store.activePanel)}
              </DockPanel>
            )}
          </div>

          {/* Mobile tool bar (<= 767px): four large targets, like Lightroom; everything else lives in More. */}
          {isMobile && (
            <nav
              aria-label="Mobile studio tools"
              className="flex min-h-16 shrink-0 items-stretch justify-around border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1 pb-[env(safe-area-inset-bottom)]"
            >
              {(
                [
                  { id: 'copilot', label: 'Flight', icon: assistModeIconName(store.assistMode) },
                  { id: 'adjust', label: 'Adjust', icon: 'sliders' as const },
                  { id: 'formats', label: 'Formats', icon: 'all-sizes' as const },
                ] as const
              ).map((item) => {
                const active = store.activePanel === item.id && !moreOpen;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setMoreOpen(false);
                      actions.setActivePanel(item.id);
                    }}
                    className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-[var(--radius-sm)] text-xs font-medium ${
                      active ? 'text-[var(--brand-accent)]' : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    <BrandIcon name={item.icon} size={24} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                aria-pressed={moreOpen}
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((v) => !v)}
                className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-[var(--radius-sm)] text-xs font-medium ${
                  moreOpen ? 'text-[var(--brand-accent)]' : 'text-[var(--text-secondary)]'
                }`}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
                </svg>
                <span>More</span>
              </button>
            </nav>
          )}

          {isMobile && moreOpen && (
            <div
              role="dialog"
              aria-label="More tools"
              className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 grid grid-cols-3 gap-2 rounded-t-[var(--radius-xl)] border-t border-[var(--border-default)] bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-panel)]"
            >
              {(
                [
                  { id: 'overlays', label: 'Overlays', icon: 'overlay' as const },
                  { id: 'masks', label: STRINGS.rail.masks, icon: 'masks' as const },
                  { id: 'enhance', label: STRINGS.rail.enhance, icon: 'focus' as const },
                  { id: 'history', label: STRINGS.rail.history, icon: 'undo' as const },
                  { id: 'info', label: STRINGS.rail.info, icon: 'info' as const },
                  { id: 'settings', label: 'Settings', icon: 'settings' as const },
                ] as const
              )
                .filter((item) => item.id !== 'overlays' || hasOverlays)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      if (item.id === 'settings') actions.setSettingsOpen(true);
                      else actions.setActivePanel(item.id);
                    }}
                    className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-primary)]"
                  >
                    <BrandIcon name={item.icon} size={24} />
                    <span>{item.label}</span>
                  </button>
                ))}
            </div>
          )}

          {/* Mobile Drawer when a tool tab is selected on small portrait screens */}
          {isMobile && store.activePanel && (
            <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex max-h-[44dvh] flex-col rounded-t-[var(--radius-xl)] border-t border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)]">
              <div
                data-testid="mobile-sheet-handle"
                style={{ touchAction: 'none' }}
                onPointerDown={(e) => { sheetDragY.current = e.clientY; e.currentTarget.setPointerCapture?.(e.pointerId); }}
                onPointerUp={(e) => {
                  if (sheetDragY.current !== null && e.clientY - sheetDragY.current > 60) actions.setActivePanel(null);
                  sheetDragY.current = null;
                }}
                onPointerCancel={() => { sheetDragY.current = null; }}
                className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2.5"
              >
                <h2 className="text-xs font-semibold text-[var(--text-primary)]">
                  {PANEL_TITLES[store.activePanel]}
                </h2>
                <button
                  type="button"
                  aria-label="Close mobile drawer"
                  onClick={() => actions.setActivePanel(null)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded text-[var(--text-muted)]"
                >
                  <BrandIcon name="close" size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto inflight-scroll p-4">
                {renderPanelContent(store.activePanel)}
                {store.activePanel === 'copilot' && (
                  <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">{renderPanelContent('assist')}</div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Global Dialogs */}
      <ExportDialog
        open={store.exportOpen}
        photo={activePhoto}
        selectedPhotoIds={store.selectedPhotoIds}
        storageConnectors={store.settings.storageConnectors}
        features={store.features}
        onClose={() => actions.setExportOpen(false)}
        onExport={actions.runExport}
      />

      <SettingsDialog
        open={store.settingsOpen}
        activeTab={store.settingsTab}
        accountPanel={accountPanel}
        keyboardPanel={<KeyboardSettings saved={savedKeymap} isMac={IS_MAC} onChange={changeKeymap} />}
        settings={store.settings}
        assistMode={store.assistMode}
        onSetAssistMode={actions.setAssistMode}
        onClose={() => actions.setSettingsOpen(false)}
        onSelectTab={actions.setSettingsTab}
        onUpdateSettings={actions.updateSettings}
        onSignInStub={actions.signInStub}
        onSignOutStub={actions.signOutStub}
        onToggleAiProvider={actions.toggleAiProvider}
        onToggleStorageConnector={actions.toggleStorageConnector}
        onEraseDeviceData={actions.eraseDeviceData}
      />

      {shortcutGuideOpen && store.screen === 'editor' && (
        <ShortcutGuide keymap={keymap} isMac={IS_MAC} onClose={() => setShortcutGuideOpen(false)} />
      )}

      {commandPaletteOpen && store.screen === 'editor' && (
        <CommandPalette
          keymap={keymap}
          isMac={IS_MAC}
          onRunCommand={runCommand}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}

      {/* Quiet non-intrusive action confirmation toast */}
      {store.lastActionNotice && !store.settings.calmView && (
        <div
          role="status"
          aria-live="polite"
          className={`pointer-events-none fixed right-4 z-50 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] shadow-[var(--shadow-popover)] ${
            isMobile ? 'bottom-20' : 'bottom-4'
          }`}
        >
          {store.lastActionNotice}
        </div>
      )}
    </div>
    </FeaturePlanContext.Provider>
  );
}
