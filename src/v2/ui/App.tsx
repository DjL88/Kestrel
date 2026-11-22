import React, { useEffect, useState } from 'react';
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
import MasksPanel from './panels/MasksPanel';
import EnhancePanel from './panels/EnhancePanel';
import OverlayPanel from './panels/OverlayPanel';
import AssistPanel from './panels/AssistPanel';
import InfoPanel from './panels/InfoPanel';
import TasksPanel from './panels/TasksPanel';
import ExportDialog from './dialogs/ExportDialog';
import SettingsDialog from './dialogs/SettingsDialog';

const PANEL_TITLES: Record<PanelId, string> = {
  copilot: STRINGS.copilot.heading,
  adjust: STRINGS.rail.adjust,
  formats: STRINGS.formats.heading,
  masks: STRINGS.masks.heading,
  enhance: STRINGS.enhance.heading,
  overlays: STRINGS.overlays.heading,
  assist: STRINGS.assist.heading,
  info: STRINGS.info.heading,
  tasks: STRINGS.tasks.heading,
};

export default function App({ useStore = useWorkspace }: { useStore?: typeof useWorkspace } = {}) {
  const { store, actions } = useStore();
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      if (e.matches) actions.setActivePanel(null);
    };
    setIsMobile(mq.matches);
    if (mq.matches) actions.setActivePanel(null);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [actions]);

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

  // Desktop keyboard shortcuts + suppress browser Ctrl/Cmd+A inside editor workspace
  useEffect(() => {
    if (store.screen !== 'editor') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && !inInput) {
        e.preventDefault();
        actions.selectAllPhotos();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !inInput) {
        e.preventDefault();
        if (e.shiftKey) actions.redo();
        else actions.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        actions.setExportOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        actions.setSettingsOpen(true);
        return;
      }
      if (inInput) return;

      if (e.key.toLowerCase() === 'f' && activePhoto) {
        actions.toggleFlag(store.selectedPhotoIds.length > 0 ? store.selectedPhotoIds : [activePhoto.id]);
      } else if (e.key.toLowerCase() === 'g') {
        actions.setGridViewOpen(!store.gridViewOpen);
      } else if (e.key === '\\') {
        actions.setCompareMode(!store.compareMode);
      } else if (['1', '2', '3', '4', '5'].includes(e.key) && activePhoto) {
        actions.setRating(
          store.selectedPhotoIds.length > 0 ? store.selectedPhotoIds : [activePhoto.id],
          Number(e.key)
        );
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [store.screen, store.selectedPhotoIds, store.gridViewOpen, store.compareMode, activePhoto, actions]);

  const renderPanelContent = (panelId: PanelId) => {
    switch (panelId) {
      case 'copilot':
        return (
          <CoPilotPanel
            photo={activePhoto}
            assistMode={store.assistMode}
            features={store.features}
            ongoingCritique={store.settings.ongoingCritique}
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
          />
        );
      case 'enhance':
        return (
          <EnhancePanel
            photo={activePhoto}
            calmView={store.settings.calmView}
            onUpdateRecipe={actions.updateRecipe}
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
      case 'info':
        return (
          <InfoPanel
            photo={activePhoto}
            onToggleFlag={actions.toggleFlag}
            onSetRating={actions.setRating}
            onReconnectOriginal={actions.reconnectOriginal}
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
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <Rail
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
                onSetBottomTab={actions.setBottomTab}
                onSetCollapsed={actions.setFilmstripCollapsed}
                onSetHeight={actions.setFilmstripHeight}
                onSetFilter={actions.setFilmstripFilter}
                onSetSearch={actions.setFilmstripSearch}
                onSelectPhoto={actions.selectPhoto}
                onClearSelection={actions.clearSelection}
                onToggleFlag={actions.toggleFlag}
                onSetRating={actions.setRating}
                onImport={actions.importPhotos}
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

          {/* Mobile Portrait Compact Tool Bar & Slide-Up Drawer (<= 767px) */}
          {isMobile && (
            <nav
              aria-label="Mobile studio tools"
              className="flex h-14 shrink-0 items-center justify-around border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1"
            >
              {(
                [
                  { id: 'copilot', label: 'Flight', icon: assistModeIconName(store.assistMode) },
                  { id: 'adjust', label: 'Adjust', icon: 'sliders' as const },
                  { id: 'formats', label: 'Formats', icon: 'all-sizes' as const },
                  { id: 'overlays', label: 'Overlays', icon: 'overlay' as const },
                  { id: 'assist', label: 'Assist', icon: 'assist' as const },
                ] as const
              ).map((item) => {
                const active = store.activePanel === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => actions.setActivePanel(item.id)}
                    className={`flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-sm)] text-[10px] font-medium ${
                      active ? 'text-[var(--brand-accent)]' : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    <BrandIcon name={item.icon} size={18} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => actions.setSettingsOpen(true)}
                className="flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-sm)] text-[10px] font-medium text-[var(--text-secondary)]"
              >
                <BrandIcon name="settings" size={18} />
                <span>Settings</span>
              </button>
            </nav>
          )}

          {/* Mobile Drawer when a tool tab is selected on small portrait screens */}
          {isMobile && store.activePanel && (
            <div className="fixed inset-x-0 bottom-14 z-30 flex max-h-[54vh] flex-col rounded-t-[var(--radius-xl)] border-t border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)]">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2.5">
                <h2 className="text-xs font-semibold text-[var(--text-primary)]">
                  {PANEL_TITLES[store.activePanel]}
                </h2>
                <button
                  type="button"
                  aria-label="Close mobile drawer"
                  onClick={() => actions.setActivePanel(null)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded text-[var(--text-muted)]"
                >
                  <BrandIcon name="close" size={15} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto inflight-scroll p-4">
                {renderPanelContent(store.activePanel)}
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
      />

      {/* Quiet non-intrusive action confirmation toast */}
      {store.lastActionNotice && !store.settings.calmView && (
        <div
          role="status"
          aria-live="polite"
          className={`pointer-events-none fixed right-4 z-50 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] shadow-[var(--shadow-popover)] ${
            isMobile ? 'bottom-16' : 'bottom-4'
          }`}
        >
          {store.lastActionNotice}
        </div>
      )}
    </div>
    </FeaturePlanContext.Provider>
  );
}
