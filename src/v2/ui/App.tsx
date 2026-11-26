import { useServiceReachability } from '../../providers/useServiceReachability';
import { usageFromServer, type CloudUsage } from '../../core/cloudPlan';
import { useConnectivity } from '../../providers/useConnectivity';
import { CloudStatus, type CloudStatusState } from './shell/CloudStatus';
import { projectsText } from '../../i18n/areas/projects';
import { stepFrom } from './utils/swipe';
import type { EnlargementPreviewResult } from '../engineClient/enlargementPreview';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { EditRecipe, PanelId, Photo } from './contract';
import { useWorkspace } from './stub';
import { resolveTheme } from './themePreference';
import { noticeDurationMs, noticeNeedsDismiss } from './utils/noticeTiming';
import { phoneNoticeBottom } from './utils/noticePlacement';
import { trueDetailJob } from './utils/trueDetailJob';
import { PHONE_LANDSCAPE_QUERY, SHORT_LANDSCAPE_QUERY } from './utils/layoutQueries';
import { STRINGS } from './strings';
import BrandIcon, { assistModeIconName } from './icons/BrandIcon';
import ProjectsHub from './screens/ProjectsHub';
import { canHidePro, hiddenProFeatures, panelsHiddenByPro } from '../engineClient/proVisibility';
import { FeaturePlanContext, HiddenProContext } from './shell/ProBadge';
import { backupStatusText } from '../engineClient/backupWords';
import { exportTargetFor, readLastExport, requestFromSettings } from '../engineClient/exportSettings';
import { readCaptionTemplate } from '../../core/captionTemplate';
import { usePresence } from './shell/usePresence';
import { PresenceAvatars, PresenceCursors } from './shell/PresenceLayer';
import { CommunicationPreferences, NoticesButton, useNotices } from './shell/Notices';
import { AccountButton } from './shell/AccountButton';
import { TaskAlerts } from './shell/TaskAlerts';
import { onPushOpened, removePushOnSignOut } from '../../providers/webPush';
import SharedEditBanner from './shell/SharedEditBanner';
import SharedComments from './shell/SharedComments';
import { getActiveGroup, viewPhotos } from './utils/studioMath';
import { readSharedLink } from './dialogs/sharedLinks';
import { useSharedEditing } from './shell/useSharedEditing';
import { collabClient } from '../../providers/collabClient';
import { firebaseAuth, isSignInConfigured } from '../../providers/firebaseAuth';
import { CANVAS_ZOOM_EVENT } from './utils/canvasTrackpadZoom';
import { nudgeSliderInUse, trackSliderInUse } from './utils/sliderNudge';
import { nextToReview } from '../../core/savedViews';
import { workflowText } from '../../i18n/areas/workflow';
import type { SavedViewsControl } from './shell/PhotoViewControls';
import { chordLabel, effectiveKeymap, keyAlreadyHandled, loadKeymap, saveKeymap, type SavedKeymap } from './commands/keymap';
import { loadPad, padInForce, resolveWithPad, savePad, type PadProfile } from './commands/pad';
import { loadGamepadProfile, saveGamepadProfile, type GamepadProfile, type GamepadSlot } from './commands/gamepad';
import { useGamepad } from './commands/useGamepad';
import { filmstripActivity, tasksWheelProgress } from './utils/edgeActivity';
import { commandById, type CommandDefinition } from './commands/registry';
import { useNativeMenu, useNativeMenuState } from './commands/useNativeMenu';
import { menuState } from './commands/menuState';
import { lazyPart } from './utils/lazyPart';
import { radiusToSize, sizeToRadius } from '../engineClient/healOps';
import { DEFAULT_HEAL_RADIUS, MAX_HEAL_SPOTS } from '../../core/heal';
import { healText } from '../../i18n/areas/heal';
import { isDesktopApp, isMobileShell } from '../../providers/desktopShell';
import { useCloudTopUp } from './useCloudTopUp';
import { applyAccountSetup, onSetupBridge, takeSetupAgain, takeSetupResult } from '../setupBridge';
import { readSetup, syncSetupWithAccount } from '../../providers/quickSetupMemory';
import { setupFinished } from '../../core/quickSetup';
import { launchedBefore } from '../../providers/launchMemory';
const QuickSetup = React.lazy(() => import('./screens/QuickSetup'));
import type { MenuAction } from './commands/menuMap';
import type { FeedbackRequest } from './shell/ContributorFeedback';
import { describeFeedbackScreen, describeFeedbackTarget } from '../../core/feedbackTarget';
import { activeLanguage } from '../../core/locale';

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
const HealSection = lazyPart(() => import('./panels/HealSection'));
const EnhancePanel = lazyPart(() => import('./panels/EnhancePanel'));
const OverlayPanel = lazyPart(() => import('./panels/OverlayPanel'));
const AssistPanel = lazyPart(() => import('./panels/AssistPanel'));
const InfoPanel = lazyPart(() => import('./panels/InfoPanel'));
const TasksPanel = lazyPart(() => import('./panels/TasksPanel'));
const CollageExportDialog = lazyPart(() => import('./dialogs/CollageExportDialog'));
const ExportDialog = lazyPart(() => import('./dialogs/ExportDialog'));
const EnlargementPreview = lazyPart(() => import('./dialogs/EnlargementPreview'));
const PrintDialog = lazyPart(() => import('./dialogs/PrintDialog'));
const RemovedPhotosDialog = lazyPart(() => import('./dialogs/RemovedPhotosDialog'));
const CullAssistantDialog = lazyPart(() => import('./dialogs/CullAssistantDialog'));
const ShareDialog = lazyPart(() => import('./dialogs/ShareDialog'));
const SettingsDialog = lazyPart(() => import('./dialogs/SettingsDialog'));
const ShortcutGuide = lazyPart(() => import('./dialogs/ShortcutGuide'));
const CommandPalette = lazyPart(() => import('./dialogs/CommandPalette'));
const KeyboardSettings = lazyPart(() => import('./dialogs/KeyboardSettings'));
const GamepadSettings = lazyPart(() => import('./dialogs/GamepadSettings'));
const LightroomOfferDialog = lazyPart(() => import('./dialogs/LightroomOfferDialog'));
const ContributorFeedback = lazyPart(() => import('./shell/ContributorFeedback'));
const QuickStartCard = lazyPart(() => import('./panels/QuickStartCard'));
const SpeciesPlacePrompt = lazyPart(() => import('./panels/SpeciesPlacePrompt'));
const CloudOriginalPrompt = lazyPart(() => import('./dialogs/CloudOriginalPrompt'));
const EDITOR_PARTS = [TopBar, Rail, DockPanel, Canvas, CollageEditor, Filmstrip, GridView, PairCompare, CoPilotPanel, AdjustPanel, SizesPanel, HistoryPanel, MasksPanel, EnhancePanel, OverlayPanel, AssistPanel, InfoPanel, TasksPanel, CollageExportDialog, ExportDialog, RemovedPhotosDialog, ShareDialog, SettingsDialog, ShortcutGuide, CommandPalette, KeyboardSettings, GamepadSettings, LightroomOfferDialog, QuickStartCard, CloudOriginalPrompt];
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
  /** Canvas only: the header, the tool rail, every panel and the filmstrip are hidden, leaving just the photo and its
   * zoom bar. Separate from full screen (which hides the window's own frame); the two can be used together. */
  const [canvasOnly, setCanvasOnly] = useState(false);
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
  // Print and soft proof: the export's own picture of the shown format, so the print is what export would save.
  const [printing, setPrinting] = useState<{ result: EnlargementPreviewResult | null } | null>(null);
  const printRequest = React.useRef(0);
  const openPrint = (photoId: string, sizeId: string) => {
    const request = ++printRequest.current;
    setPrinting({ result: null });
    void actions.previewEnlargement?.(photoId, sizeId).then((result) => {
      if (request !== printRequest.current) { if (result.ok) URL.revokeObjectURL(result.url); return; }
      setPrinting((current) => current ? { result } : current);
    });
  };
  const closePrint = () => {
    printRequest.current += 1;
    setPrinting((current) => { if (current?.result?.ok) URL.revokeObjectURL(current.result.url); return null; });
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
  // A paid top-up: read the balance again once the server has credited it. Mobile app stores handle their own purchases later.
  const rereadUsage = React.useCallback(() => { sharing.usage().then((body) => setCloudUsage(usageFromServer(body, Date.now()) ?? undefined)).catch(() => undefined); }, [sharing]);
  const cloudTopUp = useCloudTopUp(rereadUsage);
  const gallerySiteUrl = import.meta.env.VITE_KESTREL_SITE_URL || (/^https?:$/.test(window.location.protocol) ? window.location.origin : '');
  const signedInName = React.useCallback(async () => {
    const session = await firebaseAuth.current().catch(() => null);
    return session ? (session.displayName?.trim() || session.email?.split('@')[0] || null) : null;
  }, []);
  // Top right of the home page and editor: who is signed in. Read again when Settings closes (where sign-in happens).
  const [accountName, setAccountName] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!accountPanel || !isSignInConfigured() || store.settingsOpen) return;
    let live = true;
    void signedInName().then((name) => { if (live) setAccountName(name); }, () => undefined);
    return () => { live = false; };
  }, [accountPanel, signedInName, store.settingsOpen]);
  // Contributors (owner, 26 Nov 2026): an admin-granted free Pro whose holders get "Feedback on this" on right-click.
  // Asked of the server once signed in, and again when Settings closes (where sign-in happens). Offline: not offered.
  const [contributor, setContributor] = React.useState(false);
  const [feedbackRequest, setFeedbackRequest] = React.useState<FeedbackRequest | null>(null);
  React.useEffect(() => {
    if (!isSignInConfigured() || store.settingsOpen || !accountName) { if (!accountName) setContributor(false); return; }
    let live = true;
    void (async () => {
      const [{ parseControlPlaneUrl }, { readContributorStatus }] = await Promise.all([import('../../core/licenceOnline'), import('../../providers/contributorFeedback')]);
      const origin = parseControlPlaneUrl(import.meta.env.VITE_KESTREL_CONTROL_PLANE_URL);
      const token = await firebaseAuth.idToken().catch(() => null);
      const yes = origin && token ? await readContributorStatus(origin, token) : false;
      if (live) setContributor(yes);
    })().catch(() => undefined);
    return () => { live = false; };
  }, [accountName, store.settingsOpen]);
  const closeFeedback = React.useCallback(() => setFeedbackRequest(null), []);
  const sendFeedback = React.useCallback(async (request: FeedbackRequest, comment: string) => {
    const [{ parseControlPlaneUrl }, { sendContributorFeedback }] = await Promise.all([import('../../core/licenceOnline'), import('../../providers/contributorFeedback')]);
    const origin = parseControlPlaneUrl(import.meta.env.VITE_KESTREL_CONTROL_PLANE_URL);
    const token = await firebaseAuth.idToken().catch(() => null);
    await sendContributorFeedback(origin, token, {
      comment, target: request.target, text: request.text, screen: request.screen, language: request.language,
      appVersion: import.meta.env.VITE_KESTREL_BUILD_REVISION?.slice(0, 40) ?? '',
    });
  }, []);
  const accountButton = accountPanel && isSignInConfigured()
    ? <AccountButton name={accountName} onOpen={() => actions.setSettingsOpen(true, 'account')} />
    : undefined;
  // Quick setup (src/core/quickSetup.ts): apply what it chose, open Settings at Pro or Storage when asked, run it again
  // from Settings (and carry on after its language step restarts the app), and, once signed in, pick up the answers
  // saved on the account (another device, an earlier sign-in) instead of asking again.
  const [setupOpen, setSetupOpen] = React.useState(() => launchedBefore() && readSetup()?.status === 'in-progress');
  const setupActions = React.useRef(actions);
  setupActions.current = actions;
  React.useEffect(() => {
    const consume = () => {
      const result = takeSetupResult();
      if (result) {
        if (Object.keys(result.settings).length > 0) setupActions.current.updateSettings(result.settings);
        if (result.openTab) setupActions.current.setSettingsOpen(true, result.openTab);
      }
      if (takeSetupAgain()) { setupActions.current.setSettingsOpen(false); setSetupOpen(true); }
    };
    consume();
    return onSetupBridge(consume);
  }, []);
  const setupSynced = React.useRef(false);
  React.useEffect(() => {
    if (!accountName || setupSynced.current) return;
    setupSynced.current = true;
    // Saved answers on the account are applied; signed in (from Settings too) with none anywhere, setup is offered once.
    void syncSetupWithAccount().then((answers) => {
      if (answers) void applyAccountSetup(answers);
      else if (answers === null && !setupFinished(readSetup())) setSetupOpen(true);
    });
  }, [accountName]);
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
  // A small cloud beside the account button replaces the old full-width "InFlight API" bar (owner, 26 Nov 2026).
  const cloudState: CloudStatusState = connectivity === 'offline' ? 'offline'
    : service.state === 'reachable' ? 'reachable' : service.state === 'unreachable' ? 'unreachable'
    : service.state === 'checking' ? 'checking' : 'unknown';
  const cloudLabel = cloudState === 'offline' ? health.offline : cloudState === 'reachable' ? health.ok
    : cloudState === 'unreachable' ? health.error : health.unknown;
  const cloudStatus = connectivity === 'offline' || serviceBase ? (
    <CloudStatus state={cloudState} label={cloudLabel}
      detail={cloudState === 'offline' ? `${health.offline}. ${projectsText.connections.advice.offline}`
        : `InFlight service: ${cloudLabel}.${cloudState === 'reachable' || cloudState === 'checking' ? '' : ` ${projectsText.connections.check}`}`}
      onCheck={serviceBase ? service.check : undefined} />
  ) : null;
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
    if (favicon) favicon.href = `${import.meta.env.BASE_URL || '/'}brand/favicon-${activeTheme === 'dark' ? 'dark' : 'light'}.svg`;
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
  // Preview features with their own commands. A preview that is off has no keys and is not listed anywhere.
  const commandPreviews = React.useMemo(() => ({ nextToReview: store.features.nextToReview === true }), [store.features.nextToReview]);
  const keymap = React.useMemo(() => effectiveKeymap(savedKeymap.preset, savedKeymap.overrides, commandPreviews), [savedKeymap, commandPreviews]);
  const [pad, setPad] = useState<PadProfile>(loadPad);
  const changePad = React.useCallback((next: PadProfile) => { savePad(next); setPad(next); }, []);
  // Pad keys are on out of the box (plug and play) and can be turned off in Settings > Keyboard; the set-up is kept either way.
  const padKeysOn = store.settings.padKeysEnabled !== false;
  const activePad = React.useMemo(() => padInForce(pad, padKeysOn), [pad, padKeysOn]);
  const [gamepadProfile, setGamepadProfile] = useState<GamepadProfile>(loadGamepadProfile);
  const changeGamepadProfile = React.useCallback((next: GamepadProfile) => { saveGamepadProfile(next); setGamepadProfile(next); }, []);
  const [gamepadSeen, setGamepadSeen] = useState<{ name: string | null; lastSlot: GamepadSlot | null }>({ name: null, lastSlot: null });
  const changeKeymap = React.useCallback((next: SavedKeymap) => { saveKeymap(next); setSavedKeymap(next); }, []);
  const [maskGuide, setMaskGuide] = useState<{ photoId: string; maskId: string } | null>(null);
  // Spot healing: shown on the photo while its section in the Masks panel is on screen.
  const [healShown, setHealShown] = useState(false);
  const [healUi, setHealUi] = useState<{ photoId: string; placing: boolean; selectedId: string | null; note?: string; busy?: boolean } | null>(null);
  const [healSize, setHealSize] = useState(() => radiusToSize(DEFAULT_HEAL_RADIUS));
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
  const [cullAssistantOpen, setCullAssistantOpen] = useState(false);
  const closeCullAssistant = React.useCallback(() => setCullAssistantOpen(false), []);
  const sheetDragY = useRef<number | null>(null);
  // Phone tool sheet: the workspace keeps the sheet's height free at its bottom, so the photo and filmstrip sit above an
  // open sheet instead of underneath it (owner wireframe "Phone · Adjust open"). Measured, because the sheet's height
  // follows its content.
  // A callback ref, not useRef: the sheet's content loads lazily, so the sheet can appear after the effect below has run,
  // and it must be measured when it actually mounts.
  const [sheetEl, setSheetEl] = useState<HTMLDivElement | null>(null);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [sheetWidth, setSheetWidth] = useState(0);
  // A touch phone held sideways gets its own layout (V2-WORKSPACE 26.4); see utils/layoutQueries.ts.
  const [isPhoneLandscape, setIsPhoneLandscape] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_LANDSCAPE_QUERY).matches : false
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(PHONE_LANDSCAPE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsPhoneLandscape(e.matches);
    setIsPhoneLandscape(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    // Turning the device only changes the layout: the open tool moves between the docked panel and the bottom sheet.
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // A phone (portrait, or a short landscape screen) and an upright tablet or unfolded foldable open with no panel, so the
  // photo has the screen until a tool is chosen (owner, 26 Nov). Exactly once, at start: turning the device keeps
  // whatever tool is open, with its selection and zoom. The guard matters because `setActivePanel` is rebuilt whenever
  // the workspace's looks or templates change, which would otherwise close the open tool in the middle of an edit.
  const startLayoutApplied = useRef(false);
  useEffect(() => {
    if (startLayoutApplied.current || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    startLayoutApplied.current = true;
    const startsWithoutPanel = [
      '(max-width: 767px)',
      SHORT_LANDSCAPE_QUERY,
      '(min-width: 768px) and (max-width: 1023px) and (orientation: portrait)',
    ].some((query) => window.matchMedia(query).matches);
    if (startsWithoutPanel) setActivePanel(null);
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
  // Spot healing on the photo in view. Placing and the selected spot belong to one photo; switching photos clears them.
  const healFor = activePhoto && healUi?.photoId === activePhoto.id ? healUi : null;
  const placeHealSpot = React.useCallback(async (photoId: string, at: { x: number; y: number }) => {
    if (!actions.addHealSpot) return;
    setHealUi((current) => ({ photoId, placing: current?.photoId === photoId ? current.placing : true, selectedId: current?.photoId === photoId ? current.selectedId : null, busy: true }));
    const outcome = await actions.addHealSpot(photoId, at, healSize).catch(() => ({ result: 'unreadable' as const }));
    setHealUi((current) => {
      const base = current?.photoId === photoId ? current : { photoId, placing: true, selectedId: null };
      if (outcome.result === 'added') return { ...base, selectedId: outcome.spotId, busy: false, note: healText.added };
      const note = outcome.result === 'full' ? healText.full(MAX_HEAL_SPOTS) : outcome.result === 'no-source' ? healText.noSource : healText.unreadable;
      return { ...base, busy: false, note };
    });
  }, [actions, healSize]);
  const healCanvas = React.useMemo(() => (healShown && activePhoto && actions.addHealSpot ? {
    spots: activePhoto.healSpots ?? [],
    selectedId: healFor?.selectedId ?? null,
    placing: Boolean(healFor?.placing),
    newRadius: sizeToRadius(healSize),
    onPlace: (at: { x: number; y: number }) => { void placeHealSpot(activePhoto.id, at); },
    onSelect: (spotId: string) => setHealUi((current) => ({ ...(current?.photoId === activePhoto.id ? current : { placing: false }), photoId: activePhoto.id, selectedId: spotId, note: undefined })),
    onMoveSource: (spotId: string, source: { sx: number; sy: number }) => actions.updateHealSpot?.(activePhoto.id, spotId, { source }),
    onStopPlacing: () => setHealUi((current) => (current ? { ...current, placing: false } : current)),
  } : undefined), [healShown, activePhoto, actions, healFor, healSize, placeHealSpot]);
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
  const sharedEditing = useSharedEditing(sharing, store.collage ? null : store.activeProjectId, activePhoto?.id ?? null, activePhoto?.sharedKey, actions, activePhoto, shareVersion, store.photos);
  // Someone else has this photo out, or both sides changed it: the editing panels are view-only until that is settled.
  const editLocked = sharedEditing.state.kind === 'theirs' || sharedEditing.state.kind === 'conflict' || sharedEditing.state.kind === 'view-only';
  // Watch (Co-pilot): a suggestion's steps so far, shown through the same non-destructive preview as a hovered Look.
  const [stepPreview, setStepPreview] = useState<Partial<EditRecipe> | null>(null);
  useEffect(() => setStepPreview(null), [store.activePhotoId]);
  const hoveredLook = store.looks.find((l) => l.id === store.hoveredLookId)
    ?? (stepPreview && Object.keys(stepPreview).length ? { id: 'watch-steps', name: '', category: '', description: '', previewFilter: '', recipeDelta: stepPreview } : null);
  const runningTaskCount = store.tasks.filter((t) => t.status === 'running').length;
  const wheel = tasksWheelProgress(store.tasks);

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
  // On a phone a notice must never cover the filmstrip (long-press on a thumbnail), the tool bar or an open tool sheet:
  // it sits just above the highest of them, measured, because their heights change (a sheet opens, the strip resizes).
  const [noticeBottom, setNoticeBottom] = useState<number | null>(null);
  useEffect(() => {
    if (!isMobile || !store.lastActionNotice) { setNoticeBottom(null); return; }
    const bottomParts = () => [
      document.querySelector<HTMLElement>('.inflight-v2 .v2-filmstrip'),
      document.querySelector<HTMLElement>(`.inflight-v2 nav[aria-label="${STRINGS.mobile.toolBar}"]`),
      document.querySelector<HTMLElement>('.inflight-v2 [data-testid="mobile-sheet-handle"]')?.parentElement ?? null,
    // Shown, by its box: offsetParent is null for the fixed tool sheet, which left the notice over an open sheet.
    ].filter((el): el is HTMLElement => Boolean(el && el.getBoundingClientRect().height > 0));
    const place = () => setNoticeBottom(phoneNoticeBottom(window.innerHeight, bottomParts().map((el) => el.getBoundingClientRect().top)));
    place();
    window.addEventListener('resize', place);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    bottomParts().forEach((el) => observer?.observe(el));
    return () => { window.removeEventListener('resize', place); observer?.disconnect(); };
  }, [isMobile, store.lastActionNotice, store.activePanel, store.filmstripCollapsed, sheetHeight]); // sheetHeight: a tool sheet opened, closed or changed size

  // One dispatch for every command id, shared by the keydown handler below and the command search dialog,
  // so "what Cmd/Ctrl+K can run" and "what the keyboard shortcut runs" never drift apart.
  // The photos the filmstrip and grid show, in their order. Select all and Shift ranges act on these only, so a filter
  // such as Flagged never lets an edit or an export reach photos that are hidden.
  // Photos found by what the picture shows (search by description), added to the word matches.
  const pictureIds = React.useMemo(() => (store.searchPictureIds ? new Set(store.searchPictureIds) : null), [store.searchPictureIds]);
  const shownPhotos = React.useMemo(() => viewPhotos(store.photos, {
    filter: store.filmstripFilter, search: store.filmstripSearch, minRating: store.filmstripMinRating,
    sort: store.filmstripSort, tag: store.filmstripTag ?? null, pictureIds,
  }), [store.photos, store.filmstripFilter, store.filmstripSearch, store.filmstripMinRating, store.filmstripSort, store.filmstripTag, pictureIds]);
  const shownPhotoIds = React.useMemo(() => shownPhotos.map((photo) => photo.id), [shownPhotos]);
  // The photos either side of the open one, in the filmstrip's order: their eye, subject and focus point are found in
  // the background, so 100% and Zoom to eye are instant when they are opened.
  const activePhotoId = activePhoto?.id;
  const neighbourPhotos = React.useMemo(() => {
    const at = shownPhotos.findIndex((photo) => photo.id === activePhotoId);
    if (at < 0) return [];
    return [shownPhotos[at + 1], shownPhotos[at - 1], shownPhotos[at + 2]]
      .filter((photo): photo is NonNullable<typeof photo> => Boolean(photo))
      .map((photo) => ({ id: photo.id, previewUrl: photo.previewUrl }));
  }, [shownPhotos, activePhotoId]);
  // Saved views (preview, off by default): the filters in force, and putting a saved set back through the same setters.
  const savedViewsControl = React.useMemo<SavedViewsControl | undefined>(() => !store.features.savedViews ? undefined : {
    current: { filter: store.filmstripFilter, search: store.filmstripSearch, minRating: store.filmstripMinRating, sort: store.filmstripSort, tag: store.filmstripTag ?? null },
    onApply: (criteria) => {
      actions.setFilmstripFilter(criteria.filter);
      actions.setFilmstripSearch(criteria.search);
      actions.setFilmstripMinRating(criteria.minRating);
      actions.setFilmstripSort(criteria.sort);
      actions.setFilmstripTag?.(criteria.tag);
    },
  }, [store.features.savedViews, store.filmstripFilter, store.filmstripSearch, store.filmstripMinRating, store.filmstripSort, store.filmstripTag, actions]);
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
      case 'photo.rateUp': case 'photo.rateDown':
        if (ids.length) {
          const rating = Math.min(5, Math.max(0, (activePhoto?.rating ?? 0) + (command.id === 'photo.rateUp' ? 1 : -1)));
          actions.setRating(ids, rating);
        }
        break;
      case 'photo.next': window.dispatchEvent(new CustomEvent('inflight:photo-step', { detail: { delta: 1 } })); break;
      case 'photo.prev': window.dispatchEvent(new CustomEvent('inflight:photo-step', { detail: { delta: -1 } })); break;
      case 'photo.nextToReview': case 'photo.prevToReview': {
        if (!store.features.nextToReview) break;
        const delta = command.id === 'photo.nextToReview' ? 1 : -1;
        const target = nextToReview(shownPhotos, activePhoto?.id, delta);
        if (target) actions.selectPhoto(target.id);
        else actions.showNotice?.(delta === 1 ? workflowText.noneAhead : workflowText.noneBehind);
        break;
      }
      case 'view.grid': actions.setGridViewOpen(!store.gridViewOpen); break;
      case 'view.loupe': if (store.gridViewOpen) actions.setGridViewOpen(false); break;
      case 'view.filmstrip': actions.setFilmstripCollapsed(!store.filmstripCollapsed); break;
      case 'view.compare': actions.setCompareMode(!store.compareMode); break;
      case 'view.fullscreen': actions.toggleFullScreen(); break;
      case 'view.canvasOnly': setCanvasOnly((on) => !on); break;
      case 'view.maskOverlay': setMaskOverlayVisible((visible) => !visible); break;
      case 'view.zoomIn': case 'view.zoomOut': case 'view.zoomFit': case 'view.zoom100':
        window.dispatchEvent(new CustomEvent(CANVAS_ZOOM_EVENT, { detail: { action: ({ 'view.zoomIn': 'in', 'view.zoomOut': 'out', 'view.zoomFit': 'fit', 'view.zoom100': 'actual' } as const)[command.id] } }));
        break;
      case 'adjust.sliderUp': nudgeSliderInUse('up'); break;
      case 'adjust.sliderDown': nudgeSliderInUse('down'); break;
      case 'adjust.sliderUpMore': nudgeSliderInUse('upMore'); break;
      case 'adjust.sliderDownMore': nudgeSliderInUse('downMore'); break;
      case 'edit.undo': actions.undo(); break;
      case 'edit.redo': actions.redo(); break;
      case 'edit.copy': actions.copyRecipe(); break;
      case 'edit.paste': if (!editLocked) actions.pasteRecipe(); break;
      case 'edit.selectAll': selectAllShown(); break;
      case 'edit.selectNone': actions.clearSelection(); break;
      case 'file.export': actions.setExportOpen(true); break;
      case 'app.settings': actions.setSettingsOpen(true); break;
    }
  }, [store.selectedPhotoIds, store.gridViewOpen, store.filmstripCollapsed, store.compareMode, store.collage, store.settings.advanceAfterDecision, store.features.nextToReview, shownPhotos, activePhoto, actions, pairPhotos, editLocked, selectAllShown]);

  // File > Export again with last settings (G09): the wizard's last settings on the current selection, through the same
  // request builder, so it gives exactly the files the wizard would. Nothing exported yet: open the wizard instead.
  const quickExport = () => {
    if (!activePhoto || store.collage) return;
    let last = null;
    try { last = readLastExport(window.localStorage); } catch { last = null; }
    if (!last) { actions.setExportOpen(true); return; }
    let captions = null;
    try { captions = readCaptionTemplate(window.localStorage); } catch { captions = null; }
    const request = requestFromSettings(last, exportTargetFor(activePhoto, store.selectedPhotoIds, isDesktopApp() && !isMobileShell()));
    actions.runExport(captions?.enabled ? { ...request, captions } : request);
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
      case 'fullscreen': actions.toggleFullScreen(); break;
    }
  });
  // Grey out the native menu items that cannot act on what is on screen now (no photo, nothing copied, nothing to undo).
  useNativeMenuState(menuState({
    inEditor: store.screen === 'editor',
    collage: Boolean(store.collage),
    photoCount: store.photos.length,
    selectedCount: store.selectedPhotoIds.length,
    hasActivePhoto: Boolean(activePhoto),
    gridOpen: store.gridViewOpen,
    canUndo: store.canUndo,
    canRedo: store.canRedo,
    hasCopiedEdits: Boolean(store.clipboardRecipe),
    editLocked,
  }));

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
      // A control already used this key (the Adjust tabs' arrows, Space on a focused button): never run a shortcut too.
      if (keyAlreadyHandled(target, e)) return;
      let command = resolveWithPad({ event: e, keymap, pad: activePad, isMac: IS_MAC, inField });
      // A dial keeps turning the slider while that slider has focus (it counts as a field, so other keys leave it alone).
      if (!command && target instanceof HTMLInputElement && target.type === 'range') {
        const dial = resolveWithPad({ event: e, keymap, pad: activePad, isMac: IS_MAC, inField: false });
        if (dial?.group === 'adjust') command = dial;
      }
      if (!command) return;
      // While the guide is open only it, Export, Settings and Edit commands act; photo and view keys wait.
      if (shortcutGuideOpen && (command.group === 'photos' || command.group === 'view' || command.group === 'adjust')) return;
      e.preventDefault();
      runCommand(command);
    };

    window.addEventListener('keydown', handleKeyDown);
    const stopTracking = trackSliderInUse();
    return () => { window.removeEventListener('keydown', handleKeyDown); stopTracking(); };
  }, [store.screen, shortcutGuideOpen, keymap, activePad, runCommand]);

  // Game controllers (Settings > Keyboard > Game controller, off by default). The same commands as the keys, in the
  // editor only, never while Settings is open (so each button can be checked there) or a photo key while the guide is open.
  useGamepad({
    enabled: store.settings.gamepadEnabled !== false,
    profile: gamepadProfile,
    onConnection: (name) => setGamepadSeen((seen) => (seen.name === name ? seen : { name, lastSlot: name ? seen.lastSlot : null })),
    onInput: (fire, name) => { if (store.settingsOpen) setGamepadSeen({ name, lastSlot: fire.slot }); },
    onFire: (fire) => {
      if (!fire.command || store.screen !== 'editor' || store.settingsOpen || commandPaletteOpen) return;
      const command = commandById(fire.command);
      if (shortcutGuideOpen && (command.group === 'photos' || command.group === 'view' || command.group === 'adjust')) return;
      runCommand(command);
    },
  });

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
        <SharedEditBanner state={sharedEditing.state} onKeepMine={sharedEditing.keepMine} onKeepTheirs={sharedEditing.keepTheirs} onKeepBoth={sharedEditing.keepBoth} onRetry={sharedEditing.retry}
          outbox={sharedEditing.outbox} onShowPhoto={(id) => actions.selectPhoto(id)} />
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
            onResetStyle={actions.resetEditStyle}
            aiOpinion={store.aiSecondOpinion}
            assistantSuggestions={store.assistantSuggestions}
            onApplyAssistantSuggestions={actions.applyAssistantSuggestions}
            onDismissAssistantSuggestions={actions.dismissAssistantSuggestions}
            aiOpinionActions={{
              onAgree: actions.agreeAiSecondOpinion, onAsk: actions.askAiSecondOpinion, onCancel: actions.cancelAiSecondOpinion,
              onApply: actions.applyAiSecondOpinion, onDismiss: actions.dismissAiSecondOpinion,
              onOpenSettings: () => actions.setSettingsOpen(true, 'aiProviders'),
            }}
            cloudRecipe={actions.prepareCloudRecipe && actions.sendCloudRecipe && actions.setCloudRecipeFullFile && actions.cloudRecipeFullFileOn
              ? { prepare: actions.prepareCloudRecipe, send: actions.sendCloudRecipe, setFullFile: actions.setCloudRecipeFullFile, fullFileOn: actions.cloudRecipeFullFileOn }
              : undefined}
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
            userLookActions={actions.saveUserLook && actions.renameUserLook && actions.deleteUserLook && actions.exportUserLooks && actions.importUserLooks
              ? { onSave: actions.saveUserLook, onRename: actions.renameUserLook, onDelete: actions.deleteUserLook, onExport: actions.exportUserLooks, onImport: actions.importUserLooks }
              : undefined}
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
          <div className="space-y-4">
          {activePhoto && actions.addHealSpot && (
            <HealSection
              photo={activePhoto}
              placing={Boolean(healFor?.placing)}
              onSetPlacing={(placing) => setHealUi((current) => ({ photoId: activePhoto.id, selectedId: current?.photoId === activePhoto.id ? current.selectedId : null, placing, note: undefined }))}
              newSize={healSize}
              onSetNewSize={setHealSize}
              selectedId={healFor?.selectedId ?? null}
              onSelect={(spotId) => setHealUi((current) => ({ photoId: activePhoto.id, placing: current?.photoId === activePhoto.id ? current.placing : false, selectedId: spotId, note: undefined }))}
              note={healFor?.note}
              busy={healFor?.busy}
              onUpdate={(photoId, spotId, change) => actions.updateHealSpot?.(photoId, spotId, change)}
              onNextSource={(photoId, spotId) => {
                if (!actions.nextHealSource) return;
                setHealUi((current) => (current ? { ...current, busy: true } : current));
                void actions.nextHealSource(photoId, spotId).catch(() => false).then((moved) =>
                  setHealUi((current) => (current ? { ...current, busy: false, note: moved ? undefined : healText.noOther } : current)));
              }}
              onRemove={(photoId, spotId) => {
                actions.removeHealSpot?.(photoId, spotId);
                setHealUi((current) => (current?.selectedId === spotId ? { ...current, selectedId: null } : current));
              }}
              onClear={(photoId) => { actions.clearHealSpots?.(photoId); setHealUi((current) => (current ? { ...current, selectedId: null } : current)); }}
              onShown={setHealShown}
            />
          )}
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
          </div>
        );
      case 'enhance':
        return (
          <EnhancePanel
            photo={activePhoto}
            hideReadouts={store.settings.calmReadouts}
            onUpdateRecipe={actions.updateRecipe}
            onDenoise={actions.denoisePhoto}
            trueDetail={trueDetailJob(store.tasks, activePhoto?.id)}
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
        return <HistoryPanel photo={activePhoto} activeSizeId={store.activeSizeId} onGoToStep={actions.jumpToEditStep} onForkVersion={editLocked ? undefined : actions.forkEditVersion} onSwitchVersion={actions.switchEditVersion} onUndo={editLocked ? undefined : actions.undo}
          onSaveCheckpoint={actions.saveEditCheckpoint} onRestoreCheckpoint={actions.restoreEditCheckpoint}
          onDeleteCheckpoint={actions.deleteEditCheckpoint} onRestoreFormatCrop={actions.restoreFormatCrop} />;
      case 'info':
        return (
          <InfoPanel
            photo={activePhoto}
            onToggleFlag={actions.toggleFlag}
            onSetRating={actions.setRating}
            onReconnectOriginal={actions.reconnectOriginal}
            onSaveDngCopy={actions.saveDngCopy}
            onHdrMerge={store.features.hdrMerge && !store.collage ? actions.hdrMergePhotos : undefined}
            externalEditor={store.externalEditor}
            onEditInOtherApp={actions.editInOtherApp}
            onStopExternalEdit={actions.stopExternalEdit}
            onCorrectSpeciesName={actions.correctSpeciesName}
            onCorrectVehicle={actions.correctVehicle}
            speciesPlace={store.speciesPlace}
            onSetSpeciesArea={actions.setSpeciesArea}
          />
        );
      case 'tasks':
        return <TasksPanel tasks={store.tasks} onCancelTask={actions.cancelTask} onClearTask={actions.clearTask} onClearCompleted={actions.clearCompletedTasks} cloudUsage={cloudUsage ?? store.settings.account.cloud} />;
    }
  };

  const activePanelState = store.activePanel ? store.panels[store.activePanel] : null;
  // Composing collage pages has its own tools; the photo editor's panels return when one photo is opened to edit.
  const composingCollage = Boolean(store.collage && !collageEditingId);
  // Phone layouts: upright (bottom tool bar and bottom sheet) and sideways (tools on the right, side panels).
  const phoneLandscape = isPhoneLandscape && !composingCollage;
  const phoneLayout = isMobile || phoneLandscape;
  const sheetOpen = phoneLayout && Boolean(store.activePanel) && !composingCollage;
  // Canvas only applies to one photo open in the editor; the grid, a collage and the project list keep their bars.
  const canvasOnlyShown = canvasOnly && store.screen === 'editor' && Boolean(activePhoto) && !store.gridViewOpen && !store.collage;
  useEffect(() => {
    const sheet = sheetEl;
    if (!sheetOpen || !sheet) { setSheetHeight(0); setSheetWidth(0); return; }
    const measure = () => { setSheetHeight(sheet.offsetHeight); setSheetWidth(sheet.offsetWidth); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [sheetOpen, phoneLandscape, sheetEl]);

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
      className="inflight-v2 v2-safe-root fixed inset-0 flex flex-col overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)] font-[family-name:var(--font-sans)]"
      data-v2-theme={activeTheme}
      data-v2-layout={store.screen === 'editor' && phoneLandscape && !canvasOnlyShown ? 'phone-landscape' : undefined}
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
        // A part with its own menu (filmstrip, rail, collage) has already handled it; elsewhere a contributor gets
        // "Feedback on this" (Shift+F10 or the menu key opens it from the keyboard, on the focused element).
        if (contributor && !feedbackRequest && !e.defaultPrevented) {
          setFeedbackRequest({
            ...describeFeedbackTarget(target), x: e.clientX, y: e.clientY, language: activeLanguage(),
            screen: describeFeedbackScreen({ screen: store.screen, activePanel: store.activePanel, settingsOpen: store.settingsOpen, settingsTab: store.settingsTab }),
          });
        }
        e.preventDefault();
      }}
    >
      {store.screen === 'hub' ? (
        <ProjectsHub
          projects={store.projects}
          hubState={store.hubState}
          theme={activeTheme}
          onOpenProject={actions.openProject}
          onCreateProject={actions.createProject}
          defaultAssistMode={store.settings.defaultAssistMode}
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
          account={<>{cloudStatus}{accountButton}</>}
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
          {phoneLandscape && !canvasOnlyShown && (
            <nav aria-label={STRINGS.mobile.navigation} data-testid="phone-landscape-nav"
              className="fixed inset-y-0 left-0 z-40 flex w-[calc(3.25rem+env(safe-area-inset-left))] flex-col items-center gap-1 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] pt-[max(0.5rem,env(safe-area-inset-top))]">
              {([
                { icon: 'arrow-left', label: STRINGS.topBar.backToProjects, enabled: true, action: actions.backToProjects },
                { icon: 'undo', label: STRINGS.topBar.editActions.undo, enabled: store.canUndo, action: actions.undo },
                { icon: 'refresh', label: STRINGS.topBar.editActions.redo, enabled: store.canRedo, action: actions.redo },
              ] as const).map(({ icon, label, enabled, action }) => (
                <button key={label} type="button" aria-label={label} title={label} disabled={!enabled} onClick={() => action()}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40">
                  <BrandIcon name={icon} size={20} />
                </button>
              ))}
              <span className="flex-1" aria-hidden="true" />
              <button type="button" onClick={actions.toggleFullScreen}
                aria-label={store.isFullScreen ? STRINGS.canvas.fullScreenExit : STRINGS.canvas.fullScreenEnter}
                title={store.isFullScreen ? STRINGS.canvas.fullScreenExit : STRINGS.canvas.fullScreenEnter}
                className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
                <BrandIcon name={store.isFullScreen ? 'collapse' : 'expand'} size={18} />
              </button>
            </nav>
          )}
          {!phoneLandscape && !canvasOnlyShown && <TopBar
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
            onPrint={store.screen === 'editor' && !store.collage && activePhoto && actions.previewEnlargement ? () => openPrint(activePhoto.id, store.activeSizeId) : undefined}
            onShare={store.collage ? undefined : () => setShareOpen(true)}
            presence={<>
              <PresenceAvatars peers={peers} hidden={cursorsHidden} onToggleHidden={() => setCursorsHidden((v) => !v)} onGoTo={(key) => { const photo = store.photos.find((candidate) => candidate.sharedKey === key); if (photo) actions.selectPhoto(photo.id); }} />
              <NoticesButton notices={notices} client={sharing} signedIn={signedInName} onGoToPhoto={goToNoticePhoto} />
              {cloudStatus}
              {accountButton}
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
          />}

          {/* Main Workspace Row */}
          <div className={`relative flex min-h-0 flex-1 overflow-hidden ${store.settings.hand === 'left' ? 'flex-row-reverse' : ''} ${sheetOpen ? 'v2-sheet-open' : ''}`}
            style={phoneLandscape ? (sheetWidth ? { paddingRight: sheetWidth } : undefined) : sheetHeight ? { paddingBottom: sheetHeight } : undefined}>
            {(!store.collage || collageEditingId) && !phoneLandscape && !canvasOnlyShown && <Rail
              hand={store.settings.hand}
              hiddenPanels={[...(hasOverlays ? [] : ['overlays' as const]), ...panelsHiddenByPro(hiddenPro)]}
              assistMode={store.assistMode}
              activePanel={store.activePanel}
              panels={store.panels}
              runningTaskCount={runningTaskCount}
              taskProgress={wheel.percent}
              taskCount={wheel.total !== null ? { done: wheel.done ?? 0, total: wheel.total } : null}
              onOpenTasks={() => actions.setActivePanel(store.activePanel === 'tasks' ? null : 'tasks')}
              quietBadges={store.settings.calmBadges}
              onSelectPanel={actions.setActivePanel}
              onSetPanelVisible={actions.setPanelVisible}
              onSetPanelDock={actions.setPanelDock}
              onOpenAllPhotos={() => actions.setGridViewOpen(!store.gridViewOpen)}
              allPhotosOpen={store.gridViewOpen}
            />}

            {/* Left-docked panel (desktop/tablet only) */}
            {!phoneLayout && !canvasOnlyShown && activePanelVisible && store.activePanel && activePanelState?.dock === 'left' && (
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
                  pictureIds={pictureIds}
                  minRating={store.filmstripMinRating}
                  sort={store.filmstripSort}
                  onSetMinRating={actions.setFilmstripMinRating}
                  onSetSort={actions.setFilmstripSort}
                  tagFilter={store.filmstripTag ?? null}
                  onSetTagFilter={actions.setFilmstripTag}
                  savedViews={savedViewsControl}
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
                  heal={healCanvas}
                  onOpenFormats={activePhoto ? () => {
                    actions.setPanelVisible('formats', true);
                    setAddingFormatFor(activePhoto.id);
                  } : undefined}
                  onDuplicateSize={(sizeId) => activePhoto && actions.duplicateSize(activePhoto.id, sizeId)}
                  onRemoveSize={(sizeId) => activePhoto && actions.removeSize(activePhoto.id, sizeId)}
                  swipeBetweenPhotos={store.settings.swipeBetweenPhotos !== false}
                  onStepPhoto={(delta) => {
                    // In the order the filmstrip shows (its sort and filter), not the store's: a swipe goes to the photo beside this one.
                    const next = stepFrom(shownPhotoIds.map((id) => ({ id })), activePhoto?.id, delta);
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
                  neighbourPhotos={neighbourPhotos}
                  canvasOnly={canvasOnlyShown}
                  onToggleCanvasOnly={() => setCanvasOnly((on) => !on)}
                />
              )}

              {!canvasOnlyShown && <Filmstrip
                photos={store.photos}
                activePhoto={activePhoto}
                selectedPhotoIds={store.selectedPhotoIds}
                assistMode={store.assistMode}
                bottomTab={store.bottomTab}
                collapsed={store.filmstripCollapsed}
                height={store.filmstripHeight}
                filter={store.filmstripFilter}
                search={store.filmstripSearch}
                pictureIds={pictureIds}
                minRating={store.filmstripMinRating}
                sort={store.filmstripSort}
                onSetMinRating={actions.setFilmstripMinRating}
                onSetSort={actions.setFilmstripSort}
                tagFilter={store.filmstripTag ?? null}
                onSetTagFilter={actions.setFilmstripTag}
                savedViews={savedViewsControl}
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
                onWatchFolder={actions.watchFolder}
                onStopWatchingFolder={actions.stopWatchingFolder}
                onReceiveFromCamera={actions.receiveFromCamera}
                shootRoom={store.shootRoom}
                onOpenShootRoom={actions.openShootRoom}
                onCloseShootRoom={actions.closeShootRoom}
                onTetherCamera={actions.tetherCamera}
                liveFolder={store.liveFolder}
                activity={filmstripActivity(store.tasks)}
                onRunAutoCull={actions.runAutoCull}
                onOpenCullAssistant={actions.rankCulling ? () => setCullAssistantOpen(true) : undefined}
                onCreateCollage={store.collage ? undefined : actions.createCollageFromSelection}
                onStitchPanorama={store.features.panorama && !store.collage ? actions.stitchPanorama : undefined}
                onFocusStack={store.features.focusStack && !store.collage ? actions.focusStackPhotos : undefined}
                onHdrMerge={store.features.hdrMerge && !store.collage ? actions.hdrMergePhotos : undefined}
                collageMode={composingCollage}
                onChooseFromProject={composingCollage && store.projects.some((p) => p.id !== store.activeProjectId) ? () => setCollageSourceOpen(true) : undefined}
                onExportSelected={() => actions.setExportOpen(true)}
                onCompareSelected={() => { actions.setGridViewOpen(false); actions.setCompareMode(true); }}
              />}
            </div>

            {/* Right-docked panel (desktop/tablet only) */}
            {!phoneLayout && !canvasOnlyShown && activePanelVisible && store.activePanel && activePanelState?.dock === 'right' && (
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
            {!phoneLayout && !composingCollage && !canvasOnlyShown && shownFloatingPanelIds.map((panelId) => {
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

          {/* Phone tool bar. Upright (<= 767px): four large targets along the bottom, like Lightroom; everything else lives
              in More. Sideways (V2-WORKSPACE 26.4): a column on the right, thumb side, with Export on top and Masks added,
              because a landscape phone has the height for one more. */}
          {phoneLayout && !composingCollage && !canvasOnlyShown && (
            <nav
              aria-label={STRINGS.mobile.toolBar}
              className={phoneLandscape
                ? 'fixed inset-y-0 right-0 z-40 flex w-[calc(4.5rem+env(safe-area-inset-right))] flex-col items-stretch gap-1 border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-1 pr-[calc(0.25rem+env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))]'
                : 'v2-safe-bottom-fill flex min-h-16 shrink-0 items-stretch justify-around border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1'}
            >
              {phoneLandscape && (
                <button type="button" onClick={() => actions.setExportOpen(true)}
                  className="mb-1 inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--brand-accent)] px-2 text-xs font-semibold text-[var(--text-on-accent)] hover:bg-[var(--brand-accent-hover)]">
                  {STRINGS.topBar.exportButton}
                </button>
              )}
              {(
                [
                  { id: 'copilot', label: 'Flight', icon: assistModeIconName(store.assistMode) },
                  { id: 'adjust', label: 'Adjust', icon: 'sliders' as const },
                  { id: 'formats', label: 'Formats', icon: 'all-sizes' as const },
                  ...(phoneLandscape ? [{ id: 'masks' as const, label: STRINGS.rail.masks, icon: 'masks' as const }] : []),
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
                    className={`${phoneLandscape ? 'v2-current-mark min-h-[52px]' : 'v2-current-mark-top min-h-[56px] flex-1'} relative flex flex-col items-center justify-center gap-1 rounded-[var(--radius-sm)] text-xs font-medium ${
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
                className={`${phoneLandscape ? 'v2-current-mark min-h-[52px]' : 'v2-current-mark-top min-h-[56px] flex-1'} relative flex flex-col items-center justify-center gap-1 rounded-[var(--radius-sm)] text-xs font-medium ${
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

          {phoneLayout && moreOpen && !composingCollage && (
            <div
              role="dialog"
              aria-label={STRINGS.mobile.moreTools}
              className={phoneLandscape
                ? 'fixed inset-y-0 right-[calc(4.5rem+env(safe-area-inset-right))] z-40 grid w-64 auto-rows-min grid-cols-2 content-start gap-2 overflow-y-auto border-l border-[var(--border-default)] bg-[var(--bg-surface)] p-3 pt-[max(0.75rem,env(safe-area-inset-top))]'
                : "v2-safe-x fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 grid grid-cols-3 gap-2 rounded-t-[var(--radius-xl)] border-t border-[var(--border-default)] bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-panel)]"}
            >
              {(
                [
                  // A phone has no rail, so the all-photos grid (for culling a whole shoot) is offered here as well.
                  { id: 'allphotos', label: STRINGS.shellLabels.allPhotos, icon: 'image' as const },
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
                      else if (item.id === 'allphotos') { actions.setActivePanel(null); actions.setGridViewOpen(true); }
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
          {phoneLayout && store.activePanel && !composingCollage && (
            <div ref={setSheetEl} className={phoneLandscape
              ? 'fixed inset-y-0 right-[calc(4.5rem+env(safe-area-inset-right))] z-30 flex w-[17rem] flex-col border-l border-[var(--border-default)] bg-[var(--bg-surface)] pt-[env(safe-area-inset-top)] shadow-[var(--shadow-panel)]'
              : "v2-safe-x fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex max-h-[44dvh] flex-col rounded-t-[var(--radius-xl)] border-t border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)]"}>
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
      {printing && <React.Suspense fallback={null}><PrintDialog result={printing.result} onClose={closePrint} /></React.Suspense>}
      {enlargement && <React.Suspense fallback={null}><EnlargementPreview result={enlargement.result} onClose={closeEnlargement}
        formatLabel={store.photos.find((photo) => photo.id === enlargement.photoId)?.sizes.find((size) => size.id === enlargement.sizeId)?.label ?? ''} /></React.Suspense>}
      {store.collage && store.exportOpen && <React.Suspense fallback={null}><CollageExportDialog key={store.activeProjectId} document={store.collage} onClose={() => actions.setExportOpen(false)} onExport={actions.exportCollage} /></React.Suspense>}
      <React.Suspense fallback={null}><ExportDialog key={JSON.stringify([activePhoto?.id, activePhoto?.activeGroupId])}
        open={store.exportOpen && !store.collage}
        photo={activePhoto}
        selectedPhotoIds={store.selectedPhotoIds}
        onClose={() => actions.setExportOpen(false)}
        onExport={actions.runExport}
        brandKits={store.brandKits}
        onSaveBrandKit={actions.saveBrandKit}
        onEditBrandKit={actions.editBrandKit}
        onDeleteBrandKit={actions.deleteBrandKit}
        onPrint={activePhoto && actions.previewEnlargement ? () => { actions.setExportOpen(false); openPrint(activePhoto.id, store.activeSizeId); } : undefined}
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

      {store.screen === 'editor' && store.speciesPlace?.prompt && actions.setSpeciesArea && (
        <React.Suspense fallback={null}><SpeciesPlacePrompt place={store.speciesPlace} onChoose={actions.setSpeciesArea} /></React.Suspense>
      )}

      {contributor && feedbackRequest && <React.Suspense fallback={null}><ContributorFeedback request={feedbackRequest} onClose={closeFeedback} onSend={sendFeedback} /></React.Suspense>}

      <React.Suspense fallback={null}><LightroomOfferDialog
        offer={store.screen === 'editor' ? store.lightroomOffer : null}
        onChooseFolder={() => actions.chooseLightroomFolder?.()}
        onClose={dismissLightroomOffer}
      /></React.Suspense>

      {actions.rankCulling && actions.applyCullRules && cullAssistantOpen && <React.Suspense fallback={null}><CullAssistantDialog
        open={cullAssistantOpen}
        rank={actions.rankCulling}
        onApply={actions.applyCullRules}
        onClose={closeCullAssistant}
      /></React.Suspense>}

      <React.Suspense fallback={null}><RemovedPhotosDialog
        open={store.removedOpen}
        photos={store.removedPhotos}
        onRestore={actions.restorePhotos}
        onClose={() => actions.setRemovedOpen(false)}
      /></React.Suspense>

      {setupOpen && (
        <div role="dialog" aria-modal="true" aria-label={STRINGS.setup.title} data-testid="quick-setup-dialog"
          className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 text-[var(--text-primary)]">
            <React.Suspense fallback={null}>
              <QuickSetup online={typeof navigator === 'undefined' || navigator.onLine} signedInName={accountName}
                onSignIn={() => { setSetupOpen(false); actions.setSettingsOpen(true, 'account'); }} onClose={() => setSetupOpen(false)} />
            </React.Suspense>
          </div>
        </div>
      )}
      <React.Suspense fallback={null}><SettingsDialog
        open={store.settingsOpen}
        activeTab={store.settingsTab}
        templates={store.overlayTemplates}
        onRenameTemplate={actions.renameOverlayTemplate}
        onDeleteTemplate={actions.deleteOverlayTemplate}
        accountPanel={accountPanel ? <>{accountPanel}<CommunicationPreferences client={sharing} signedIn={signedInName} /></> : undefined}
        keyboardPanel={<React.Suspense fallback={null}><KeyboardSettings saved={savedKeymap} isMac={IS_MAC} onChange={changeKeymap} pad={pad} onPadChange={changePad} padKeysOn={padKeysOn} onPadKeysOnChange={(on: boolean) => actions.updateSettings({ padKeysEnabled: on })} previews={commandPreviews} /></React.Suspense>}
        gamepadPanel={<React.Suspense fallback={null}><GamepadSettings profile={gamepadProfile} onChange={changeGamepadProfile} controllerName={gamepadSeen.name} lastSlot={gamepadSeen.lastSlot} /></React.Suspense>}
        settings={store.settings}
        cloudUsage={cloudUsage}
        cloudTopUp={cloudUsage && !isMobileShell() ? cloudTopUp : undefined}
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
        <React.Suspense fallback={null}><ShortcutGuide keymap={keymap} pad={activePad} isMac={IS_MAC} onClose={() => setShortcutGuideOpen(false)} previews={commandPreviews} /></React.Suspense>
      )}

      {commandPaletteOpen && store.screen === 'editor' && (
        <React.Suspense fallback={null}><CommandPalette
          keymap={keymap}
          isMac={IS_MAC}
          onRunCommand={runCommand}
          onClose={() => setCommandPaletteOpen(false)}
          previews={commandPreviews}
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
          className={`${phoneLandscape ? '' : 'v2-safe-right '}fixed right-4 z-50 flex max-w-[min(28rem,calc(100vw-2rem))] items-start gap-2 rounded-[var(--radius-md)] border bg-[var(--bg-surface-raised)] py-2 pl-3.5 pr-1.5 text-xs font-medium text-[var(--text-primary)] shadow-[var(--shadow-popover)] ${
            noticeSticky ? 'border-[var(--semantic-warning)]' : 'border-[var(--border-default)]'
          } ${isMobile ? (noticeBottom === null ? 'bottom-20' : '') : 'v2-safe-bottom bottom-4'}`}
          style={phoneLandscape ? { right: 'calc(5.5rem + env(safe-area-inset-right))' } : isMobile && noticeBottom !== null ? { bottom: noticeBottom } : undefined}
          data-testid="action-notice"
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
