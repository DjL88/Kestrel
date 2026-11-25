import { useServiceReachability } from '../../providers/useServiceReachability';
import { usageFromServer, type CloudUsage } from '../../core/cloudPlan';
import { useConnectivity } from '../../providers/useConnectivity';
import { projectsText } from '../../i18n/areas/projects';
import { stepFrom } from './utils/swipe';
import type { EnlargementPreviewResult } from '../engineClient/enlargementPreview';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { EditRecipe, PanelId, Photo } from './contract';
import { useWorkspace } from './stub';
import { resolveTheme } from './themePreference';
import { noticeDurationMs, noticeNeedsDismiss } from './utils/noticeTiming';
import { STRINGS } from './strings';
import BrandIcon, { assistModeIconName } from './icons/BrandIcon';
import ProjectsHub from './screens/ProjectsHub';
import { canHidePro, hiddenProFeatures, panelsHiddenByPro } from '../engineClient/proVisibility';
import { FeaturePlanContext, HiddenProContext } from './shell/ProBadge';
import { backupStatusText } from '../engineClient/backupWords';
import { exportTargetFor, readLastExport, requestFromSettings } from '../engineClient/exportSettings';
import { usePresence } from './shell/usePresence';
import { PresenceAvatars, PresenceCursors } from './shell/PresenceLayer';
import { NewsEmailSetting, NoticesButton, useNotices } from './shell/Notices';
import { TaskAlerts } from './shell/TaskAlerts';
import { onPushOpened, removePushOnSignOut } from '../../providers/webPush';
import SharedEditBanner from './shell/SharedEditBanner';
import SharedComments from './shell/SharedComments';
import { getActiveGroup, viewPhotos } from './utils/studioMath';
import { readSharedLink } from './dialogs/sharedLinks';
import { useSharedEditing } from './shell/useSharedEditing';
import { collabClient } from '../../providers/collabClient';
import { firebaseAuth } from '../../providers/firebaseAuth';
import { chordLabel, effectiveKeymap, loadKeymap, saveKeymap, type SavedKeymap } from './commands/keymap';
import { loadPad, resolveWithPad, savePad, type PadProfile } from './commands/pad';
import { commandById, type CommandDefinition } from './commands/registry';
import { useNativeMenu } from './commands/useNativeMenu';
import { lazyPart } from './utils/lazyPart';
import { isDesktopApp, isMobileShell } from '../../providers/desktopShell';
import type { MenuAction } from './commands/menuMap';

// Only the projects list is needed to start. The editor (shell, panels and dialogs) is its own set of chunks, fetched in
// the background once the list has drawn (preloadEditorParts), so opening a project does not wait for it either.
// Each lazy part sits inside its own Suspense boundary, so a part still arriving never blanks what is already on screen.
const TopBar = lazyPart(() => import('./shell/TopBar'));
const Rail = lazyPart(() => import('./shell/Rail'));
const DockPanel = lazyPart(() => import('./shell/DockPanel'));
const Canvas = lazyPart(() => import('./shell/Canvas'));
const CollageEditor = lazyPart(() => import('./shell/CollageEditor'));
const Filmstrip = lazyPart(() => import('./shell/Filmstrip'));
const GridView = lazyPart(() => import('./shell/GridView'));
const PairCompare = lazyPart(() => import('./shell/PairCompare'));
const CoPilotPanel = lazyPart(() => import('./panels/CoPilotPanel'));
const AdjustPanel = lazyPart(() => import('./panels/AdjustPanel'));
const SizesPanel = lazyPart(() => import('./panels/SizesPanel'));
const HistoryPanel = lazyPart(() => import('./panels/HistoryPanel'));
const MasksPanel = lazyPart(() => import('./panels/MasksPanel'));
const EnhancePanel = lazyPart(() => import('./panels/EnhancePanel'));
const OverlayPanel = lazyPart(() => import('./panels/OverlayPanel'));
const AssistPanel = lazyPart(() => import('./panels/AssistPanel'));
const InfoPanel = lazyPart(() => import('./panels/InfoPanel'));
const TasksPanel = lazyPart(() => import('./panels/TasksPanel'));
const CollageExportDialog = lazyPart(() => import('./dialogs/CollageExportDialog'));
const ExportDialog = lazyPart(() => import('./dialogs/ExportDialog'));
const EnlargementPreview = lazyPart(() => import('./dialogs/EnlargementPreview'));
const RemovedPhotosDialog = lazyPart(() => import('./dialogs/RemovedPhotosDialog'));
const ShareDialog = lazyPart(() => import('./dialogs/ShareDialog'));
const SettingsDialog = lazyPart(() => import('./dialogs/SettingsDialog'));
const ShortcutGuide = lazyPart(() => import('./dialogs/ShortcutGuide'));
const CommandPalette = lazyPart(() => import('./dialogs/CommandPalette'));
const KeyboardSettings = lazyPart(() => import('./dialogs/KeyboardSettings'));
const LightroomOfferDialog = lazyPart(() => import('./dialogs/LightroomOfferDialog'));
const QuickStartCard = lazyPart(() => import('./panels/QuickStartCard'));
const CloudOriginalPrompt = lazyPart(() => import('./dialogs/CloudOriginalPrompt'));
const EDITOR_PARTS = [TopBar, Rail, DockPanel, Canvas, CollageEditor, Filmstrip, GridView, PairCompare, CoPilotPanel, AdjustPanel, SizesPanel, HistoryPanel, MasksPanel, EnhancePanel, OverlayPanel, AssistPanel, InfoPanel, TasksPanel, CollageExportDialog, ExportDialog, RemovedPhotosDialog, ShareDialog, SettingsDialog, ShortcutGuide, CommandPalette, KeyboardSettings, LightroomOfferDialog, QuickStartCard, CloudOriginalPrompt];
function preloadEditorParts() {
  // A part already fetched, or still arriving, is not fetched again; one that failed (offline) is tried on next use.
  for (const part of EDITOR_PARTS) void part.preload().catch(() => undefined);
}

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

export default function App({ useStore = useWorkspace, accountPanel, serviceBase }: {
  useStore?: typeof useWorkspace;
  accountPanel?: React.ReactNode;
  serviceBase?: string;
} = {}) {
  const { store, actions } = useStore();
  // Shared projects (#1387): contacted only when the person opens Share.
  const [shareOpen, setShareOpen] = useState(false);
  // The enlargement preview: the export's own picture of one format. Null result while it is being made.
  const [enlargement, setEnlargement] = useState<{ photoId: string; sizeId: string; result: EnlargementPreviewResult | null } | null>(null);
  const enlargementRequest = React.useRef(0);
  const openEnlargement = (photoId: string, sizeId: string) => {
    const request = ++enlargementRequest.current;
    setEnlargement({ photoId, sizeId, result: null });
    void actions.previewEnlargement?.(photoId, sizeId).then((result) => {
      // A preview closed (or replaced) before it finished is dropped, and its picture released.
      if (request !== enlargementRequest.current) { if (result.ok) URL.revokeObjectURL(result.url); return; }
      setEnlargement((current) => current ? { ...current, result } : current);
    });
  };
  const closeEnlargement = () => {
    enlargementRequest.current += 1;
    setEnlargement((current) => { if (current?.result?.ok) URL.revokeObjectURL(current.result.url); return null; });
  };
  const [shareVersion, setShareVersion] = useState(0);
  const [cursorsHidden, setCursorsHidden] = useState(false);
  const closeShare = React.useCallback(() => { setShareOpen(false); setShareVersion((n) => n + 1); }, []);
  const sharing = React.useMemo(() => collabClient(import.meta.env.VITE_KESTREL_CONTROL_PLANE_URL, () => firebaseAuth.idToken()), []);
  // Settings → Account: this month's cloud allowances and balance, read when the Account tab or the Task Manager opens. Signed out, an
  // older server or no network: nothing shows (the sample workspace keeps its own figures).
  const [cloudUsage, setCloudUsage] = React.useState<CloudUsage | undefined>(undefined);
  React.useEffect(() => {
    const wanted = (store.settingsOpen && store.settingsTab === 'account') || store.activePanel === 'tasks';
    if (!wanted) return;
    let live = true;
    sharing.usage().then((body) => { if (live) setCloudUsage(usageFromServer(body, Date.now()) ?? undefined); }).catch(() => { if (live) setCloudUsage(undefined); });
    return () => { live = false; };
  }, [sharing, store.settingsOpen, store.settingsTab, store.activePanel]);
  const gallerySiteUrl = import.meta.env.VITE_KESTREL_SITE_URL || (/^https?:$/.test(window.location.protocol) ? window.location.origin : '');
  const signedInName = React.useCallback(async () => {
    const session = await firebaseAuth.current().catch(() => null);
    return session ? (session.displayName?.trim() || session.email?.split('@')[0] || null) : null;
  }, []);
  // Team notifications (G20): the in-app inbox, for a signed-in person on a build with sharing.
  const notices = useNotices(sharing, signedInName);
  /** A notice opens its photo when that shared project is the one open here; otherwise it only stays in the list. */
  const goToNoticePhoto = (projectId: string, photoKey: string) => {
    if (!store.activeProjectId || readSharedLink(store.activeProjectId) !== projectId) return false;
    const photo = store.photos.find((candidate) => candidate.sharedKey === photoKey);
    if (photo) actions.selectPhoto(photo.id);
    return Boolean(photo);
  };
  // Push alerts (G20): signing out removes this browser's alerts; a tapped alert opens its notice here.
  const goToNoticeRef = React.useRef(goToNoticePhoto);
  goToNoticeRef.current = goToNoticePhoto;
  const reloadNotices = notices.reload;
  React.useEffect(() => {
    const stopSignOut = removePushOnSignOut(sharing);
    const stopOpened = onPushOpened((target) => { void reloadNotices(); if (target.photoId) goToNoticeRef.current(target.projectId, target.photoId); });
    return () => { stopSignOut(); stopOpened(); };
  }, [sharing, reloadNotices]);
  const connectivity = useConnectivity();
  const service = useServiceReachability(serviceBase);
  const health = projectsText.connections.health;
  const serviceLabel = service.state === 'reachable' ? health.ok : service.state === 'unreachable' ? health.error : health.unknown;
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches : false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    update();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    // Compatibility with older WebKit versions in the desktop shell.
    media.addListener?.(update);
    return () => media.removeListener?.(update);
  }, []);
  const activeTheme = resolveTheme(store.settings.theme, systemDark);
  useEffect(() => {
    // After the first paint, when the browser is idle: fetch the editor so opening a project is immediate.
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) { idle(preloadEditorParts, { timeout: 2000 }); return; }
    const timer = window.setTimeout(preloadEditorParts, 300);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const favicon = document.querySelector<HTMLLinkElement>('link[data-inflight-theme-icon]');
    if (favicon) favicon.href = activeTheme === 'dark' ? '/brand/favicon-dark.svg' : '/brand/favicon-light.svg';
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (theme) theme.content = activeTheme === 'dark' ? '#0e1116' : '#f8f6f2';
  }, [activeTheme]);

  const { setActivePanel } = actions;
  const hasOverlays = store.features.overlayText || store.features.watermarkCustom;
  const hiddenPro = React.useMemo(() => hiddenProFeatures(store.featurePlan, store.features, store.settings.hideProFeatures), [store.featurePlan, store.features, store.settings.hideProFeatures]);
  const proChoiceOffered = canHidePro(store.featurePlan, store.features);
  const [shortcutGuideOpen, setShortcutGuideOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [savedKeymap, setSavedKeymap] = useState<SavedKeymap>(loadKeymap);
  const keymap = React.useMemo(() => effectiveKeymap(savedKeymap.preset, savedKeymap.overrides), [savedKeymap]);
  const [pad, setPad] = useState<PadProfile>(loadPad);
  const changePad = React.useCallback((next: PadProfile) => { savePad(next); setPad(next); }, []);
  const changeKeymap = React.useCallback((next: SavedKeymap) => { saveKeymap(next); setSavedKeymap(next); }, []);
  const [maskGuide, setMaskGuide] = useState<{ photoId: string; maskId: string } | null>(null);
  // The selected mask's hatched coverage overlay (O). Its outline stays on the canvas either way.
  const [maskOverlayVisible, setMaskOverlayVisible] = useState(true);
  // A line round the mask by default, so the edit inside stays visible; the hatched area is one press away.
  const [maskOverlayStyle, setMaskOverlayStyle] = useState<'outline' | 'fill'>('outline');
  // White balance from the picture: the eyedropper's waiting state, and the last result in words.
  const [whitePickFor, setWhitePickFor] = useState<string | null>(null);
  const [whiteNote, setWhiteNote] = useState<{ photoId: string; text: string } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [addingFormatFor, setAddingFormatFor] = useState<string | null>(null);
  const [collageEditingId, setCollageEditingId] = useState<string | null>(null);
  const [collageSourceOpen, setCollageSourceOpen] = useState(false);
  const sheetDragY = useRef<number | null>(null);
  // Phone tool sheet: the workspace keeps the sheet's height free at its bottom, so the photo and filmstrip sit above an
  // open sheet instead of underneath it (owner wireframe "Phone · Adjust open"). Measured, because the sheet's height
  // follows its content.
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [sheetHeight, setSheetHeight] = useState(0);
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

  useEffect(() => setCollageEditingId(null), [store.activeProjectId]);

  const activePhoto =
    store.photos.find((p) => p.id === store.activePhotoId) ?? store.photos[0] ?? null;
  const runNeutralWhite = React.useCallback(async (photoId: string, at?: { x: number; y: number }) => {
    if (!actions.neutralWhiteBalance) return;
    setWhitePickFor(null);
    const result = await actions.neutralWhiteBalance(photoId, at).catch(() => 'unreadable' as const);
    setWhiteNote({ photoId, text: STRINGS.adjust.neutral[result] });
  }, [actions]);
  const whitePickActive = whitePickFor !== null && whitePickFor === activePhoto?.id;
  const neutralPick = React.useMemo(() => (whitePickActive && activePhoto
    ? { onPick: (at: { x: number; y: number }) => { void runNeutralWhite(activePhoto.id, at); }, onCancel: () => setWhitePickFor(null) }
    : undefined), [whitePickActive, activePhoto, runNeutralWhite]);
  // Compare with exactly two photos selected shows them side by side; with one, it stays before and after.
  const pairPhotos = React.useMemo(() => {
    if (!store.compareMode || store.collage || store.selectedPhotoIds.length !== 2) return null;
    const found = store.selectedPhotoIds.map((id) => store.photos.find((p) => p.id === id));
    return found[0] && found[1] ? ([found[0], found[1]] as [Photo, Photo]) : null;
  }, [store.compareMode, store.collage, store.selectedPhotoIds, store.photos]);
  const [pairSwapped, setPairSwapped] = useState(false);
  const xmpInputRef = useRef<HTMLInputElement>(null);
  const lightroomInputRef = useRef<HTMLInputElement>(null);
  const dismissLightroomOffer = useCallback(() => actions.dismissLightroomOffer?.(), [actions]);
  const peers = usePresence(sharing, store.collage ? null : store.activeProjectId, activePhoto?.sharedKey ?? null, signedInName, shareVersion);
  const [zoomedPastPreview, setZoomedPastPreview] = React.useState<string | null>(null);
  const sharedEditing = useSharedEditing(sharing, store.collage ? null : store.activeProjectId, activePhoto?.id ?? null, activePhoto?.sharedKey, actions, activePhoto, shareVersion);
  // Someone else has this photo out, or both sides changed it: the editing panels are view-only until that is settled.
  const editLocked = sharedEditing.state.kind === 'theirs' || sharedEditing.state.kind === 'conflict' || sharedEditing.state.kind === 'view-only';
  // Watch (Co-pilot): a suggestion's steps so far, shown through the same non-destructive preview as a hovered Look.
  const [stepPreview, setStepPreview] = useState<Partial<EditRecipe> | null>(null);
  useEffect(() => setStepPreview(null), [store.activePhotoId]);
  const hoveredLook = store.looks.find((l) => l.id === store.hoveredLookId)
    ?? (stepPreview && Object.keys(stepPreview).length ? { id: 'watch-steps', name: '', category: '', description: '', previewFilter: '', recipeDelta: stepPreview } : null);
  const runningTaskCount = store.tasks.filter((t) => t.status === 'running').length;

  // Action messages: a problem waits until it is dismissed; a confirmation stays long enough to read, and pauses
  // while the pointer or focus is on it. Calm View never hides them (it only quietens the rest of the workspace).
  const [noticePaused, setNoticePaused] = useState(false);
  const noticeSticky = store.lastActionNotice ? noticeNeedsDismiss(store.lastActionNotice) : false;
  useEffect(() => {
    if (!store.lastActionNotice || noticeSticky || noticePaused) return;
    const t = window.setTimeout(() => actions.clearNotice(), noticeDurationMs(store.lastActionNotice));
    return () => clearTimeout(t);
  }, [store.lastActionNotice, noticeSticky, noticePaused, actions]);
  useEffect(() => { setNoticePaused(false); }, [store.lastActionNotice]);

  // One dispatch for every command id, shared by the keydown handler below and the command search dialog,
  // so "what Cmd/Ctrl+K can run" and "what the keyboard shortcut runs" never drift apart.
  // The photos the filmstrip and grid show, in their order. Select all and Shift ranges act on these only, so a filter
  // such as Flagged never lets an edit or an export reach photos that are hidden.
  const shownPhotoIds = React.useMemo(() => viewPhotos(store.photos, {
    filter: store.filmstripFilter, search: store.filmstripSearch, minRating: store.filmstripMinRating,
    sort: store.filmstripSort, tag: store.filmstripTag ?? null,
  }).map((photo) => photo.id), [store.photos, store.filmstripFilter, store.filmstripSearch, store.filmstripMinRating, store.filmstripSort, store.filmstripTag]);
  const selectShownPhoto = React.useCallback((photoId: string, modifiers?: { ctrl?: boolean; shift?: boolean }) =>
    actions.selectPhoto(photoId, modifiers?.shift ? { ...modifiers, order: shownPhotoIds } : modifiers), [actions, shownPhotoIds]);
  const selectAllShown = React.useCallback(() => actions.selectAllPhotos(shownPhotoIds), [actions, shownPhotoIds]);

  // Settings → Keyboard: after a rating or decision on one photo, move on to the next, as when culling in Photo Mechanic
  // or Lightroom with Caps Lock on. A choice on several selected photos never moves.
  const advanceAfterDecision = (ids: string[]) => {
    if (store.settings.advanceAfterDecision && ids.length === 1 && ids[0] === activePhoto?.id) {
      window.dispatchEvent(new CustomEvent('inflight:photo-step', { detail: { delta: 1 } }));
    }
  };
  const runCommand = React.useCallback((command: CommandDefinition) => {
    // In a two-photo compare, keys act on the chosen side only, never on both photos at once.
    const ids = pairPhotos && activePhoto && pairPhotos.some((p) => p.id === activePhoto.id) ? [activePhoto.id]
      : store.selectedPhotoIds.length > 0 ? store.selectedPhotoIds : activePhoto ? [activePhoto.id] : [];
    switch (command.id) {
      case 'help.toggle': setShortcutGuideOpen((open) => !open); break;
      case 'app.commandSearch': setCommandPaletteOpen((open) => !open); break;
      case 'photo.flag': if (ids.length) { actions.toggleFlag(ids); advanceAfterDecision(ids); } break;
      case 'photo.reject': if (ids.length) { actions.setDecision(ids, 'reject'); advanceAfterDecision(ids); } break;
      case 'photo.unflag': if (ids.length) { actions.setDecision(ids, 'unreviewed'); advanceAfterDecision(ids); } break;
      case 'photo.rate0': case 'photo.rate1': case 'photo.rate2':
      case 'photo.rate3': case 'photo.rate4': case 'photo.rate5':
        if (ids.length) { actions.setRating(ids, Number(command.id.slice(-1))); advanceAfterDecision(ids); }
        break;
      case 'photo.next': window.dispatchEvent(new CustomEvent('inflight:photo-step', { detail: { delta: 1 } })); break;
      case 'photo.prev': window.dispatchEvent(new CustomEvent('inflight:photo-step', { detail: { delta: -1 } })); break;
      case 'view.grid': actions.setGridViewOpen(!store.gridViewOpen); break;
      case 'view.compare': actions.setCompareMode(!store.compareMode); break;
      case 'view.fullscreen': actions.toggleFullScreen(); break;
      case 'view.maskOverlay': setMaskOverlayVisible((visible) => !visible); break;
      case 'edit.undo': actions.undo(); break;
      case 'edit.redo': actions.redo(); break;
      case 'edit.copy': actions.copyRecipe(); break;
      case 'edit.paste': if (!editLocked) actions.pasteRecipe(); break;
      case 'edit.selectAll': selectAllShown(); break;
      case 'file.export': actions.setExportOpen(true); break;
      case 'app.settings': actions.setSettingsOpen(true); break;
    }
  }, [store.selectedPhotoIds, store.gridViewOpen, store.compareMode, store.collage, store.settings.advanceAfterDecision, activePhoto, actions, pairPhotos, editLocked, selectAllShown]);

  // File > Export again with last settings (G09): the wizard's last settings on the current selection, through the same
  // request builder, so it gives exactly the files the wizard would. Nothing exported yet: open the wizard instead.
  const quickExport = () => {
    if (!activePhoto || store.collage) return;
    let last = null;
    try { last = readLastExport(window.localStorage); } catch { last = null; }
    if (!last) { actions.setExportOpen(true); return; }
    actions.runExport(requestFromSettings(last, exportTargetFor(activePhoto, store.selectedPhotoIds, isDesktopApp() && !isMobileShell())));
  };

  // The desktop app's native menu (File, Edit, Photo, View, Settings). Some of its accelerators (Cmd/Ctrl+E, +A, +O, +M)
  // are taken before the page sees the key, so the menu choice must run the action itself.
  useNativeMenu((action: MenuAction) => {
    const ids = store.selectedPhotoIds.length > 0 ? store.selectedPhotoIds : activePhoto ? [activePhoto.id] : [];
    const inEditor = store.screen === 'editor';
    switch (action.kind) {
      case 'command': if (inEditor) runCommand(commandById(action.id)); break;
      case 'rate': if (inEditor && ids.length) actions.setRating(ids, action.rating); break;
      case 'decision': if (inEditor && ids.length) actions.setDecision(ids, action.value); break;
      case 'import': actions.importPhotos(); break;
      case 'deselectAll': if (inEditor) actions.clearSelection(); break;
      case 'toggleFilmstrip': if (inEditor) actions.setFilmstripCollapsed(!store.filmstripCollapsed); break;
      case 'settings': actions.setSettingsOpen(true, action.tab); break;
      case 'removedPhotos': if (inEditor) actions.setRemovedOpen(true); break;
      case 'backupNow': if (inEditor && !store.collage) actions.backUpProjectNow(); break;
      case 'quickExport': if (inEditor) quickExport(); break;
      case 'backupFile': if (inEditor && !store.collage) actions.saveProjectBackupFile(); break;
      case 'saveXmp': if (inEditor && !store.collage) actions.saveXmpSidecars(store.selectedPhotoIds); break;
      case 'readXmp': if (inEditor && !store.collage) xmpInputRef.current?.click(); break;
      case 'readLightroom': if (inEditor && !store.collage) lightroomInputRef.current?.click(); break;
      case 'openExport': if (inEditor && !store.collage) actions.exportOpenFormats?.(); break;
      case 'resetPhoto': if (inEditor && activePhoto && !editLocked) actions.resetPhotoEdits(activePhoto.id); break;
      case 'backToProjects': if (inEditor) actions.backToProjects(); break;
    }
  });

  // Desktop keyboard shortcuts + suppress browser Ctrl/Cmd+A inside editor workspace
  useEffect(() => {
    if (store.screen !== 'editor') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        // A slider keeps the arrow keys (the Compare handle, range inputs).
        target?.getAttribute('role') === 'slider' ||
        Boolean(target?.isContentEditable);
      const command = resolveWithPad({ event: e, keymap, pad, isMac: IS_MAC, inField });
      if (!command) return;
      // While the guide is open only it, Export, Settings and Edit commands act; photo and view keys wait.
      if (shortcutGuideOpen && (command.group === 'photos' || command.group === 'view')) return;
      e.preventDefault();
      runCommand(command);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [store.screen, shortcutGuideOpen, keymap, pad, runCommand]);

  const EDITING_PANELS: PanelId[] = ['adjust', 'masks', 'enhance', 'copilot'];
  const renderPanelContent = (panelId: PanelId) => <React.Suspense fallback={null}>{renderPanelBody(panelId)}</React.Suspense>;
  const renderPanelBody = (panelId: PanelId) => {
    const inner = renderPanelInner(panelId);
    const comments = (panelId === 'copilot' || panelId === 'info') && sharedEditing.state.kind !== 'off' ? (
      <SharedComments client={sharing} project={store.activeProjectId ? readSharedLink(store.activeProjectId) : null} photoKey={activePhoto?.sharedKey} photoId={activePhoto?.id ?? null}
        recipe={activePhoto ? getActiveGroup(activePhoto).recipe : null} canEdit={!editLocked} onApply={(id, delta, label) => actions.updateRecipe(id, delta, label)} />
    ) : null;
    if (!EDITING_PANELS.includes(panelId)) return <>{comments}{inner}</>;
    return (
      <>
        {comments}
        <SharedEditBanner state={sharedEditing.state} onKeepMine={sharedEditing.keepMine} onKeepTheirs={sharedEditing.keepTheirs} onKeepBoth={sharedEditing.keepBoth} onRetry={sharedEditing.retry} />
        {editLocked ? <fieldset disabled className="contents" data-testid="shared-edit-locked">{inner}</fieldset> : inner}
      </>
    );
  };
  const renderPanelInner = (panelId: PanelId) => {
    switch (panelId) {
      case 'copilot':
        return (
          <CoPilotPanel
            photo={activePhoto}
            assistMode={store.assistMode}
            features={store.features}
            ongoingCritique={store.settings.ongoingCritique}
            cvdGuidance={store.settings.cvdGuidance}
            reviewing={store.reviewingPhotoIds.includes(activePhoto?.id ?? '')}
            onSetAssistMode={actions.setAssistMode}
            onOpenSettings={() => actions.setSettingsOpen(true, 'assistance')}
            onRunDeepVisionReview={actions.runDeepVisionReview}
            onApplySuggestion={actions.applyAssistSuggestion}
            onRequestLocalAuto={actions.requestLocalAuto}
            onDismissSuggestion={actions.dismissAssistSuggestion}
            onStepPreview={setStepPreview}
          />
        );
      case 'adjust':
        return (
          <AdjustPanel
            photo={activePhoto}
            selectedPhotoCount={store.selectedPhotoIds.length}
            looks={store.looks}
            cvdGuidance={store.settings.cvdGuidance}
            hideReadouts={store.settings.calmReadouts}
            showAdvanced={store.settings.advancedControls}
            onUpdateRecipe={actions.updateRecipe}
            onDetectColourEdges={actions.detectColourEdges}
            onApplyLensProfile={actions.applyLensProfile}
            onApplyLook={actions.applyLook}
            onHoverLook={actions.setHoveredLook}
            onResetPhoto={actions.resetPhotoEdits}
            onNeutralWhite={actions.neutralWhiteBalance ? (id) => { void runNeutralWhite(id); } : undefined}
            whitePicking={whitePickActive}
            onSetWhitePicking={actions.neutralWhiteBalance && store.PhotoSurface ? (on) => { setWhiteNote(null); setWhitePickFor(on && activePhoto ? activePhoto.id : null); } : undefined}
            whiteNote={whiteNote && whiteNote.photoId === activePhoto?.id ? whiteNote.text : null}
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
            onRenameEditGroup={actions.renameEditGroup}
            onSetActiveSize={actions.setActiveSize}
            onSetCanvasLayoutMode={actions.setCanvasLayoutMode}
            onToggleSizeEnabled={actions.toggleSizeEnabled}
            onToggleSizeLinked={actions.toggleSizeLinked}
            onUpdateSizeCrop={actions.updateSizeCrop}
            onFlipSizes={actions.flipSelectedSizes}
            onRotateSizes={actions.rotateSelectedSizes}
            onResetSizeCrop={actions.resetSizeCrop}
            addingCustom={activePhoto != null && addingFormatFor === activePhoto.id}
            onSetAddingCustom={(open) => setAddingFormatFor(open ? activePhoto?.id ?? null : null)}
            onAddCustomSize={actions.addCustomSize}
            onSetOriginalOutputSize={actions.setOriginalOutputSize}
            onResetOriginalOutputSize={actions.resetOriginalOutputSize}
            onToggleSplitFrames={actions.toggleSplitFrames}
            onSetSplitFrameCount={actions.setSplitFrameCount}
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
            onSetMaskGeometry={actions.setMaskGeometry}
            onSetMaskParts={actions.setMaskParts}
            onPreviewMask={setMaskGuide}
            tapSelect={store.tapSelect}
            tapActions={actions}
          />
        );
      case 'enhance':
        return (
          <EnhancePanel
            photo={activePhoto}
            hideReadouts={store.settings.calmReadouts}
            onUpdateRecipe={actions.updateRecipe}
            onDenoise={actions.denoisePhoto}
            cloudEnabled={store.features.cloudAssist}
            onPreviewEnlargement={actions.previewEnlargement && activePhoto ? () => openEnlargement(activePhoto.id, store.activeSizeId) : undefined}
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
            onMoveRow={actions.moveOverlayRow}
            onAddTextWatermark={actions.addTextWatermark}
            onAddWatermarkVersion={actions.addWatermarkVersion}
            onSetWatermarkSlot={actions.setWatermarkSlot}
            onAddCustomFont={actions.addCustomFont}
            onListDeviceFonts={actions.listDeviceFonts}
            onHasDeviceFont={actions.hasDeviceFont}
            onImportWatermark={actions.importWatermarkImage}
            onCutOutWatermark={actions.cutOutWatermark}
            onMakeWatermarkVariant={actions.makeWatermarkVariant}
            onDeleteWatermark={actions.deleteWatermark}
            templates={store.overlayTemplates}
            selectedPhotoIds={store.selectedPhotoIds}
            onSaveTemplate={actions.saveOverlayTemplate}
            onApplyTemplate={actions.applyOverlayTemplate}
            onManageTemplates={() => actions.setSettingsOpen(true, 'presets')}
            projectPhotos={store.photos.map((candidate) => ({ id: candidate.id, filename: candidate.filename }))}
            calmView={store.settings.calmReadouts}
            onAddImageLayer={actions.addImageLayer}
            onAddPhotoLayer={actions.addPhotoLayer}
            onUpdateLayer={actions.updateLayer}
            onRemoveLayer={actions.removeLayer}
            onMoveLayer={actions.moveLayer}
          />
        );
      case 'assist':
        return (
          <AssistPanel
            photo={activePhoto}
            cvdGuidance={store.settings.cvdGuidance}
            onRefreshReview={actions.runDeepVisionReview}
            onApplySuggestion={actions.applyAssistSuggestion}
          />
        );
      case 'history':
        return <HistoryPanel photo={activePhoto} activeSizeId={store.activeSizeId} onForkFromStep={actions.jumpToEditStep} onSwitchVersion={actions.switchEditVersion} onUndo={editLocked ? undefined : actions.undo}
          onRenameVersion={actions.renameEditVersion} onSaveCheckpoint={actions.saveEditCheckpoint} onRestoreCheckpoint={actions.restoreEditCheckpoint}
          onDeleteCheckpoint={actions.deleteEditCheckpoint} onRestoreFormatCrop={actions.restoreFormatCrop} />;
      case 'info':
        return (
          <InfoPanel
            photo={activePhoto}
            onToggleFlag={actions.toggleFlag}
            onSetRating={actions.setRating}
            onReconnectOriginal={actions.reconnectOriginal}
            onSaveDngCopy={actions.saveDngCopy}
            onCorrectSpeciesName={actions.correctSpeciesName}
            onCorrectVehicle={actions.correctVehicle}
          />
        );
      case 'tasks':
        return <TasksPanel tasks={store.tasks} onCancelTask={actions.cancelTask} onClearTask={actions.clearTask} onClearCompleted={actions.clearCompletedTasks} cloudUsage={cloudUsage ?? store.settings.account.cloud} />;
    }
  };

  const activePanelState = store.activePanel ? store.panels[store.activePanel] : null;
  // Composing collage pages has its own tools; the photo editor's panels return when one photo is opened to edit.
  const composingCollage = Boolean(store.collage && !collageEditingId);
  const sheetOpen = isMobile && Boolean(store.activePanel) && !composingCollage;
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheetOpen || !sheet) { setSheetHeight(0); return; }
    const measure = () => setSheetHeight(sheet.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [sheetOpen]);

  const activePanelVisible = Boolean(store.activePanel && activePanelState?.visible) && !composingCollage;

  // On wide screens, detached panels are independent of the active dock/rail tab.
  // Compact desktop and tablet layouts show only one floating panel at a time.
  const [wideWorkspace, setWideWorkspace] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1200px)').matches
  );
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1200px)');
    const update = () => setWideWorkspace(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const floatingPanelIds = (Object.keys(store.panels) as PanelId[])
    .filter((id) => store.panels[id].visible && store.panels[id].dock === 'float');
  const shownFloatingPanelIds = wideWorkspace
    ? floatingPanelIds
    : floatingPanelIds.includes(store.activePanel as PanelId)
      ? [store.activePanel as PanelId]
      : floatingPanelIds.slice(-1);

  // Owner decision (24 Nov): pinch zoom belongs to the canvas only. A trackpad pinch over the panels, toolbars, menus or
  // filmstrip zoomed the whole page, so the menus slid about and out of reach. The canvas handles its own pinch first (it
  // zooms the photo); everywhere else the gesture is simply ignored. Chromium and WebView2 report a trackpad pinch as
  // Ctrl+wheel, Safari as gesture events. Touch-screen pinch is stopped by `touch-action` in v2.css. Browser zoom from
  // the keyboard (Ctrl/Cmd + and -) and the system's zoom and text size are untouched.
  useEffect(() => {
    const stopPageZoom = (event: Event) => event.preventDefault();
    const stopPinchWheel = (event: WheelEvent) => { if (event.ctrlKey) event.preventDefault(); };
    const events = ['gesturestart', 'gesturechange', 'gestureend'] as const;
    events.forEach((name) => document.addEventListener(name, stopPageZoom, { passive: false }));
    document.addEventListener('wheel', stopPinchWheel, { passive: false });
    return () => {
      events.forEach((name) => document.removeEventListener(name, stopPageZoom));
      document.removeEventListener('wheel', stopPinchWheel);
    };
  }, []);

  return (
    <FeaturePlanContext.Provider value={store.featurePlan}>
      <HiddenProContext.Provider value={hiddenPro}>
    <div
      className="inflight-v2 fixed inset-0 flex flex-col overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)] font-[family-name:var(--font-sans)]"
      data-v2-theme={activeTheme}
      data-v2-motion={store.settings.calmMotion ? 'calm' : undefined}
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
      {connectivity === 'offline' && (
        <div role="status" data-testid="offline-status" className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-xs text-[var(--text-secondary)]">
          <BrandIcon name="alert" size={14} />
          <span>{projectsText.connections.health.offline} · {projectsText.connections.advice.offline}</span>
        </div>
      )}
      {serviceBase && connectivity !== 'offline' && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-xs text-[var(--text-secondary)]">
          <span role="status" data-testid="service-reachability">
            {['InFlight API', serviceLabel].join(' · ')}
          </span>
          <button type="button" disabled={service.state === 'checking'} aria-busy={service.state === 'checking'}
            onClick={service.check} className="rounded px-2 py-1 hover:bg-[var(--bg-surface-hover)] disabled:opacity-50">
            {projectsText.connections.check}
          </button>
        </div>
      )}
      {store.screen === 'hub' ? (
        <ProjectsHub
          projects={store.projects}
          hubState={store.hubState}
          theme={activeTheme}
          onOpenProject={actions.openProject}
          onCreateProject={actions.createProject}
          onCreateFromFolder={actions.createProjectFromFolder}
          onQuickStart={actions.startQuickStart}
          onRenameProject={actions.renameProject}
          onRestoreBackup={actions.restoreProjectBackup}
          onArchiveProject={actions.archiveProject}
          onDeleteProject={actions.deleteProject}
          onRestoreDeletedProject={actions.restoreDeletedProject}
          onDeleteProjectForever={actions.deleteProjectForever}
          onDuplicateProject={actions.duplicateProject}
          onOpenSettings={() => actions.setSettingsOpen(true, 'appearance')}
          onToggleTheme={() =>
            actions.updateSettings({ theme: activeTheme === 'dark' ? 'light' : 'dark' })
          }
          onSetHubState={actions.setHubState}
        />
      ) : (
        <React.Suspense fallback={null}>
          <input ref={xmpInputRef} type="file" multiple accept=".xmp,.zip,application/rdf+xml,application/zip" hidden
            data-testid="xmp-input" aria-hidden="true" tabIndex={-1}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = '';
              if (files.length) actions.readXmpSidecars(files, store.selectedPhotoIds);
            }} />
          <input ref={lightroomInputRef} type="file" accept=".lrcat" hidden
            data-testid="lightroom-input" aria-hidden="true" tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) actions.readLightroomCatalogue(file);
            }} />
          <TopBar
            // Owner decision 24 Nov 2026: header menus in a browser; the installed desktop app uses its native menu bar.
            showMenus={!isDesktopApp()}
            keymap={keymap}
            photoName={store.collage && !collageEditingId ? `Collage · ${store.collage.pages.length} page${store.collage.pages.length === 1 ? '' : 's'}` : activePhoto ? `${activePhoto.title} · ${activePhoto.filename}` : 'No photo'}
            photoPosition={!store.collage && activePhoto ? STRINGS.mobile.photoPosition(store.photos.findIndex((p) => p.id === activePhoto.id) + 1, store.photos.length) : undefined}
            assistMode={store.assistMode}
            theme={activeTheme}
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
            onQuickExport={store.screen === 'editor' && !store.collage && activePhoto ? quickExport : undefined}
            onShare={store.collage ? undefined : () => setShareOpen(true)}
            presence={<>
              <PresenceAvatars peers={peers} hidden={cursorsHidden} onToggleHidden={() => setCursorsHidden((v) => !v)} onGoTo={(key) => { const photo = store.photos.find((candidate) => candidate.sharedKey === key); if (photo) actions.selectPhoto(photo.id); }} />
              <NoticesButton notices={notices} client={sharing} signedIn={signedInName} onGoToPhoto={goToNoticePhoto} />
            </>}
            onOpenRemoved={() => actions.setRemovedOpen(true)}
            onSaveXmp={store.screen === 'editor' && !store.collage ? () => actions.saveXmpSidecars(store.selectedPhotoIds) : undefined}
            onBackUpNow={store.screen === 'editor' && !store.collage ? actions.backUpProjectNow : undefined}
            onSaveBackupFile={store.screen === 'editor' && !store.collage ? actions.saveProjectBackupFile : undefined}
            backupNote={store.backup ? backupStatusText(store.backup) : undefined}
            onReadXmp={store.screen === 'editor' && !store.collage ? () => xmpInputRef.current?.click() : undefined}
            onReadLightroom={store.screen === 'editor' && !store.collage ? () => lightroomInputRef.current?.click() : undefined}
            onExportOpenFormats={store.screen === 'editor' && !store.collage ? actions.exportOpenFormats : undefined}
            onOpenSettings={() => actions.setSettingsOpen(true)}
            onImport={actions.importPhotos}
            onUndo={actions.undo}
            onRedo={actions.redo}
            onCopyRecipe={actions.copyRecipe}
            onPasteRecipe={actions.pasteRecipe}
            onResetPhoto={() => activePhoto && actions.resetPhotoEdits(activePhoto.id)}
            onSelectAll={selectAllShown}
            onClearSelection={actions.clearSelection}
            onToggleFilmstrip={() => actions.setFilmstripCollapsed(!store.filmstripCollapsed)}
            onToggleGridView={() => actions.setGridViewOpen(!store.gridViewOpen)}
            onToggleCompare={() => actions.setCompareMode(!store.compareMode)}
            onDockActivePanel={(dock) => store.activePanel && actions.setPanelDock(store.activePanel, dock)}
            onResetLayout={actions.resetPanelLayout}
            onToggleTheme={() =>
              actions.updateSettings({ theme: activeTheme === 'dark' ? 'light' : 'dark' })
            }
            hasActivePhoto={Boolean(activePhoto)}
            onToggleDemoUnavailable={useStore === useWorkspace ? actions.toggleDemoUnavailable : undefined}
          />

          {/* Main Workspace Row */}
          <div className={`relative flex min-h-0 flex-1 overflow-hidden ${store.settings.hand === 'left' ? 'flex-row-reverse' : ''} ${sheetHeight ? 'v2-sheet-open' : ''}`}
            style={sheetHeight ? { paddingBottom: sheetHeight } : undefined}>
            {(!store.collage || collageEditingId) && <Rail
              hand={store.settings.hand}
              hiddenPanels={[...(hasOverlays ? [] : ['overlays' as const]), ...panelsHiddenByPro(hiddenPro)]}
              assistMode={store.assistMode}
              activePanel={store.activePanel}
              panels={store.panels}
              runningTaskCount={runningTaskCount}
              taskProgress={runningTaskCount ? store.tasks.filter((t) => t.status === 'running').reduce((sum, t) => sum + t.progress, 0) / runningTaskCount : 0}
              onOpenTasks={() => actions.setActivePanel(store.activePanel === 'tasks' ? null : 'tasks')}
              quietBadges={store.settings.calmBadges}
              onSelectPanel={actions.setActivePanel}
              onSetPanelVisible={actions.setPanelVisible}
              onSetPanelDock={actions.setPanelDock}
              onOpenAllPhotos={() => actions.setGridViewOpen(!store.gridViewOpen)}
              allPhotosOpen={store.gridViewOpen}
            />}

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
              {store.collage && collageEditingId && <button type="button" className="min-h-10 shrink-0 border-b border-[var(--border-default)] bg-[var(--bg-surface)] px-4 text-left text-sm font-semibold text-[var(--brand-accent)]" onClick={() => setCollageEditingId(null)}>← Back to collage pages</button>}
              {store.collage && !collageEditingId ? (
                <CollageEditor document={store.collage} photos={store.photos} projects={store.projects.filter((p) => p.id !== store.activeProjectId)}
                  onBrowseProject={actions.browseCollageProjectPhotos} onAddFromProject={actions.addCollageProjectPhotos} PhotoSurface={store.PhotoSurface}
                  onChange={(next) => actions.updateCollage?.(next)}
                  onEditPhoto={(id) => { actions.selectPhoto(id); setCollageEditingId(id); }}
                  onImport={actions.importPhotos}
                  sourcePickerOpen={collageSourceOpen} onSourcePickerChange={setCollageSourceOpen} />
              ) : pairPhotos ? (
                <PairCompare photos={pairSwapped ? [pairPhotos[1], pairPhotos[0]] : pairPhotos} chosenId={store.activePhotoId}
                  PhotoSurface={store.PhotoSurface} onChoose={actions.focusPhoto}
                  onSetDecision={actions.setDecision} onSetRating={actions.setRating}
                  onSwap={() => setPairSwapped((value) => !value)}
                  onEdit={(id) => { actions.setCompareMode(false); actions.selectPhoto(id); }}
                  onClose={() => actions.setCompareMode(false)} />
              ) : store.gridViewOpen ? (
                <GridView
                  photos={store.photos}
                  activePhotoId={store.activePhotoId}
                  selectedPhotoIds={store.selectedPhotoIds}
                  filter={store.filmstripFilter}
                  search={store.filmstripSearch}
                  minRating={store.filmstripMinRating}
                  sort={store.filmstripSort}
                  onSetMinRating={actions.setFilmstripMinRating}
                  onSetSort={actions.setFilmstripSort}
                  tagFilter={store.filmstripTag ?? null}
                  onSetTagFilter={actions.setFilmstripTag}
                  onSelectPhoto={selectShownPhoto}
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
                  onZoomPastPreview={setZoomedPastPreview}
                  PhotoSurface={store.PhotoSurface}
                  maskGuideId={maskGuide?.photoId === activePhoto?.id ? maskGuide?.maskId : undefined}
                  maskOverlayVisible={maskOverlayVisible}
                  maskOverlayStyle={maskOverlayStyle}
                  onSetMaskOverlayStyle={setMaskOverlayStyle}
                  maskOverlayKey={keymap['view.maskOverlay'] ? chordLabel(keymap['view.maskOverlay'], IS_MAC) : undefined}
                  onToggleMaskOverlay={() => setMaskOverlayVisible((visible) => !visible)}
                  onSetMaskGeometry={actions.setMaskGeometry}
                  tapSession={store.tapSelect?.session}
                  onTapSelect={actions.tapSelectAt}
                  neutralPick={neutralPick}
                  onOpenFormats={activePhoto ? () => {
                    actions.setPanelVisible('formats', true);
                    setAddingFormatFor(activePhoto.id);
                  } : undefined}
                  onDuplicateSize={(sizeId) => activePhoto && actions.duplicateSize(activePhoto.id, sizeId)}
                  onRemoveSize={(sizeId) => activePhoto && actions.removeSize(activePhoto.id, sizeId)}
                  onStepPhoto={(delta) => {
                    const next = stepFrom(store.photos, activePhoto?.id, delta);
                    if (next) actions.selectPhoto(next.id);
                  }}
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
                  hideHints={store.settings.calmHints}
                  onSelectSize={actions.setActiveSize}
                  onClearSizeSelection={actions.clearSizeSelection}
                  onSelectAllSizes={actions.selectAllEnabledSizes}
                  onSetLayoutMode={actions.setCanvasLayoutMode}
                  onMoveArtboard={actions.moveSizeArtboard}
                  onResetArtboards={actions.resetArtboardPositions}
                  onUpdateCrop={actions.updateSizeCrop}
                  onFlipSizes={actions.flipSelectedSizes}
                  onRotateSizes={actions.rotateSelectedSizes}
                  onToggleSplitFrames={actions.toggleSplitFrames}
                  onSetSplitFrameCount={actions.setSplitFrameCount}
                  onSetSplitPanOffset={actions.setSplitPanOffset}
                  onUpdateVideoZoom={actions.updateVideoZoom}
                  onUpdateOverlay={actions.updateOverlay}
                  onReconnectOriginal={actions.reconnectOriginal}
                  onDevelopFullSize={actions.developFullSize}
                  onToggleCompare={() => actions.setCompareMode(!store.compareMode)}
                  onSetZoom={actions.setCanvasZoom}
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
                minRating={store.filmstripMinRating}
                sort={store.filmstripSort}
                onSetMinRating={actions.setFilmstripMinRating}
                onSetSort={actions.setFilmstripSort}
                tagFilter={store.filmstripTag ?? null}
                onSetTagFilter={actions.setFilmstripTag}
                quietBadges={store.settings.calmBadges}
                looks={store.looks}
                hasClipboardRecipe={Boolean(store.clipboardRecipe)}
                onSetBottomTab={actions.setBottomTab}
                onSetCollapsed={actions.setFilmstripCollapsed}
                onSetHeight={actions.setFilmstripHeight}
                onSetFilter={actions.setFilmstripFilter}
                onSetSearch={actions.setFilmstripSearch}
                onSelectPhoto={selectShownPhoto}
                onClearSelection={actions.clearSelection}
                onToggleFlag={actions.toggleFlag}
                onSetRating={actions.setRating}
                onSetDecision={actions.setDecision}
                onSetBurstGrouped={actions.setBurstGrouped}
                onRemovePhotos={actions.removePhotos}
                onMovePhotos={actions.movePhotos}
                moveTargets={store.projects.filter((project) => project.id !== store.activeProjectId && !project.trashed)
                  .map((project) => ({ id: project.id, name: project.name }))}
                onPasteRecipe={actions.pasteRecipe}
                onApplyLook={actions.applyLook}
                onImport={actions.importPhotos}
                onImportFolder={actions.importFolder}
                onRunAutoCull={actions.runAutoCull}
                onCreateCollage={store.collage ? undefined : actions.createCollageFromSelection}
                collageMode={composingCollage}
                onChooseFromProject={composingCollage && store.projects.some((p) => p.id !== store.activeProjectId) ? () => setCollageSourceOpen(true) : undefined}
                onExportSelected={() => actions.setExportOpen(true)}
                onCompareSelected={() => { actions.setGridViewOpen(false); actions.setCompareMode(true); }}
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

            {/* Undocked windows: independent on large displays, one on compact screens. */}
            {!isMobile && !composingCollage && shownFloatingPanelIds.map((panelId) => {
              const state = store.panels[panelId];
              return (
                <DockPanel
                  key={panelId}
                  panelId={panelId}
                  title={PANEL_TITLES[panelId]}
                  dock="float"
                  floatX={state.floatX}
                  floatY={state.floatY}
                  onSetDock={(dock) => actions.setPanelDock(panelId, dock)}
                  onMoveFloat={(x, y) => actions.moveFloatingPanel(panelId, x, y)}
                  onClose={() => actions.setPanelVisible(panelId, false)}
                >
                  {renderPanelContent(panelId)}
                </DockPanel>
              );
            })}
          </div>

          {/* Mobile tool bar (<= 767px): four large targets, like Lightroom; everything else lives in More. */}
          {isMobile && !composingCollage && (
            <nav
              aria-label={STRINGS.mobile.toolBar}
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
                    className={`v2-current-mark-top relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-[var(--radius-sm)] text-xs font-medium ${
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
                className={`v2-current-mark-top relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-[var(--radius-sm)] text-xs font-medium ${
                  moreOpen ? 'text-[var(--brand-accent)]' : 'text-[var(--text-secondary)]'
                }`}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
                </svg>
                <span>{STRINGS.mobile.more}</span>
              </button>
            </nav>
          )}

          {isMobile && moreOpen && !composingCollage && (
            <div
              role="dialog"
              aria-label={STRINGS.mobile.moreTools}
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
                .filter((item) => (item.id !== 'overlays' || hasOverlays) && !panelsHiddenByPro(hiddenPro).includes(item.id as never))
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
          {isMobile && store.activePanel && !composingCollage && (
            <div ref={sheetRef} className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex max-h-[44dvh] flex-col rounded-t-[var(--radius-xl)] border-t border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)]">
              <div
                data-testid="mobile-sheet-handle"
                style={{ touchAction: 'none' }}
                onPointerDown={(e) => {
                  // A press on a button in the handle (Close) is that button's: capturing it here would send its release to the
                  // handle, and the button's click would never fire.
                  if ((e.target as HTMLElement).closest('button')) return;
                  sheetDragY.current = e.clientY;
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                }}
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
                  aria-label={STRINGS.mobile.closeDrawer}
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
        </React.Suspense>
      )}

      {/* Global Dialogs: each in its own boundary, so one still arriving hides nothing else. */}
      {enlargement && <React.Suspense fallback={null}><EnlargementPreview result={enlargement.result} onClose={closeEnlargement}
        formatLabel={store.photos.find((photo) => photo.id === enlargement.photoId)?.sizes.find((size) => size.id === enlargement.sizeId)?.label ?? ''} /></React.Suspense>}
      {store.collage && store.exportOpen && <React.Suspense fallback={null}><CollageExportDialog key={store.activeProjectId} document={store.collage} onClose={() => actions.setExportOpen(false)} onExport={actions.exportCollage} /></React.Suspense>}
      <React.Suspense fallback={null}><ExportDialog key={JSON.stringify([activePhoto?.id, activePhoto?.activeGroupId])}
        open={store.exportOpen && !store.collage}
        photo={activePhoto}
        selectedPhotoIds={store.selectedPhotoIds}
        onClose={() => actions.setExportOpen(false)}
        onExport={actions.runExport}
      /></React.Suspense>

      <TaskAlerts />
      <PresenceCursors peers={peers} photoId={activePhoto?.sharedKey ?? null} hidden={cursorsHidden} />
      <React.Suspense fallback={null}><CloudOriginalPrompt
        client={sharing}
        localProjectId={store.collage ? null : store.activeProjectId}
        photo={zoomedPastPreview && activePhoto?.id === zoomedPastPreview ? activePhoto : null}
        attachOriginal={actions.attachCloudOriginal}
        onDone={() => setZoomedPastPreview(null)}
      /></React.Suspense>
      <React.Suspense fallback={null}><ShareDialog
        open={shareOpen}
        client={sharing}
        localProjectId={store.activeProjectId}
        projectName={store.projects.find((project) => project.id === store.activeProjectId)?.name ?? ''}
        selectedPhotoIds={store.selectedPhotoIds}
        displayName={signedInName}
        renderPreview={actions.renderGalleryPreview}
        siteUrl={gallerySiteUrl}
        photoName={(id) => store.photos.find((photo) => photo.id === id)?.filename ?? id}
        onGoToPhoto={(id) => { closeShare(); actions.selectPhoto(id); }}
        localPhotos={store.photos}
        readOriginal={actions.readVerifiedOriginal}
        importCloud={actions.importCloudPreviews}
        attachOriginal={actions.attachCloudOriginal}
        photoDecision={(id) => store.photos.find((photo) => photo.id === id)?.decision ?? null}
        onFlagPhoto={(id) => actions.setDecision([id], 'keep')}
        onClose={closeShare}
      /></React.Suspense>

      <React.Suspense fallback={null}><QuickStartCard
        quickStart={store.screen === 'editor' && !store.exportOpen ? store.quickStart : null}
        onExport={() => { actions.dismissQuickStart?.(); actions.setExportOpen(true); }}
        onDone={() => actions.dismissQuickStart?.()}
      /></React.Suspense>

      <React.Suspense fallback={null}><LightroomOfferDialog
        offer={store.screen === 'editor' ? store.lightroomOffer : null}
        onChooseFolder={() => actions.chooseLightroomFolder?.()}
        onClose={dismissLightroomOffer}
      /></React.Suspense>

      <React.Suspense fallback={null}><RemovedPhotosDialog
        open={store.removedOpen}
        photos={store.removedPhotos}
        onRestore={actions.restorePhotos}
        onClose={() => actions.setRemovedOpen(false)}
      /></React.Suspense>

      <React.Suspense fallback={null}><SettingsDialog
        open={store.settingsOpen}
        activeTab={store.settingsTab}
        templates={store.overlayTemplates}
        onRenameTemplate={actions.renameOverlayTemplate}
        onDeleteTemplate={actions.deleteOverlayTemplate}
        accountPanel={accountPanel ? <>{accountPanel}<NewsEmailSetting client={sharing} signedIn={signedInName} /></> : undefined}
        keyboardPanel={<React.Suspense fallback={null}><KeyboardSettings saved={savedKeymap} isMac={IS_MAC} onChange={changeKeymap} pad={pad} onPadChange={changePad} /></React.Suspense>}
        settings={store.settings}
        cloudUsage={cloudUsage}
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
        proChoiceOffered={proChoiceOffered}
      /></React.Suspense>

      {shortcutGuideOpen && store.screen === 'editor' && (
        <React.Suspense fallback={null}><ShortcutGuide keymap={keymap} isMac={IS_MAC} onClose={() => setShortcutGuideOpen(false)} /></React.Suspense>
      )}

      {commandPaletteOpen && store.screen === 'editor' && (
        <React.Suspense fallback={null}><CommandPalette
          keymap={keymap}
          isMac={IS_MAC}
          onRunCommand={runCommand}
          onClose={() => setCommandPaletteOpen(false)}
        /></React.Suspense>
      )}

      {/* Action message: quiet, readable, and never gone before it can be read. */}
      {store.lastActionNotice && (
        <div
          role={noticeSticky ? 'alert' : 'status'}
          aria-live={noticeSticky ? 'assertive' : 'polite'}
          onMouseEnter={() => setNoticePaused(true)}
          onMouseLeave={() => setNoticePaused(false)}
          onFocus={() => setNoticePaused(true)}
          onBlur={() => setNoticePaused(false)}
          className={`fixed right-4 z-50 flex max-w-[min(28rem,calc(100vw-2rem))] items-start gap-2 rounded-[var(--radius-md)] border bg-[var(--bg-surface-raised)] py-2 pl-3.5 pr-1.5 text-xs font-medium text-[var(--text-primary)] shadow-[var(--shadow-popover)] ${
            noticeSticky ? 'border-[var(--semantic-warning)]' : 'border-[var(--border-default)]'
          } ${isMobile ? 'bottom-20' : 'bottom-4'}`}
        >
          {noticeSticky && <BrandIcon name="alert" size={14} className="mt-0.5 shrink-0 text-[var(--semantic-warning)]" />}
          <span className="min-w-0 flex-1 py-0.5 leading-relaxed">{store.lastActionNotice}</span>
          <button
            type="button"
            onClick={() => actions.clearNotice()}
            aria-label={STRINGS.settings.appearance.dismissNotice}
            title={STRINGS.settings.appearance.dismissNotice}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            <BrandIcon name="close" size={12} />
          </button>
        </div>
      )}
    </div>
      </HiddenProContext.Provider>
    </FeaturePlanContext.Provider>
  );
}
