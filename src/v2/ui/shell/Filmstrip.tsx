import { planFilmstrip } from '../../engineClient/burstGroups';
import EdgeProgress from './EdgeProgress';
import { minutesLeft } from '../utils/edgeActivity';
import { stackText } from '../../../i18n/areas/stack';
import { panoText } from '../../../i18n/areas/pano';
import { hdrText } from '../../../i18n/areas/hdr';
import { engineText } from '../../../i18n/areas/engine';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AssistMode, FilmstripFilter, LiveFtpInbox, LiveTether, LookPreset, Photo, PhotoSort } from '../contract';
import { STRINGS } from '../strings';
import { PHOTO_DRAG_TYPE, draggedPhotoIds } from '../utils/photoDrag';
import ProBadge, { useProHidden } from './ProBadge';
import PictureSourceBadge from './PictureSourceBadge';
import BrandIcon from '../icons/BrandIcon';
import { viewPhotos } from '../utils/studioMath';
import { TagFilterSelect } from './TagFilterSelect';
import { DecisionFilter, ViewOptions } from './PhotoViewControls';
import { SearchNote } from './SearchNote';

/** English only while the Culling Assistant is a preview (x-std-cull-rules); moves into the V2 i18n area before it is switched on. */
const CULL_ASSISTANT_LABEL = 'Culling Assistant';

interface FilmstripProps {
  photos: Photo[];
  activePhoto: Photo | null;
  selectedPhotoIds: string[];
  assistMode: AssistMode;
  bottomTab: 'filmstrip' | 'info';
  collapsed: boolean;
  height: number;
  filter: FilmstripFilter;
  search: string;
  /** Photos whose picture matches the search words (search by description); null: words only. */
  pictureIds?: ReadonlySet<string> | null;
  minRating: number;
  sort: PhotoSort;
  onSetMinRating: (rating: number) => void;
  onSetSort: (sort: PhotoSort) => void;
  tagFilter?: string | null;
  onSetTagFilter?: (tagId: string | null) => void;
  /** Saved views of these filters (a preview: absent while its flag is off). */
  savedViews?: import('./PhotoViewControls').SavedViewsControl;
  quietBadges: boolean;
  looks: LookPreset[];
  hasClipboardRecipe: boolean;
  onSetBottomTab: (tab: 'filmstrip' | 'info') => void;
  onSetCollapsed: (collapsed: boolean) => void;
  onSetHeight: (height: number) => void;
  onSetFilter: (filter: FilmstripFilter) => void;
  onSetSearch: (q: string) => void;
  onSelectPhoto: (photoId: string, modifiers?: { ctrl?: boolean; shift?: boolean }) => void;
  onClearSelection: () => void;
  onToggleFlag: (photoIds: string[]) => void;
  onSetRating: (photoIds: string[], rating: number) => void;
  onSetDecision: (photoIds: string[], decision: 'unreviewed' | 'keep' | 'reject') => void;
  onSetBurstGrouped: (burstGroupId: string, grouped: boolean) => void;
  onRemovePhotos: (photoIds: string[]) => void;
  /** Moves photos to another project; `moveTargets` are the projects offered (never this one or a deleted one). */
  onMovePhotos?: (photoIds: string[], targetProjectId: string) => void;
  moveTargets?: { id: string; name: string }[];
  onPasteRecipe: () => void;
  onApplyLook: (photoId: string, lookId: string) => void;
  onImport: () => void;
  onImportFolder: () => void;
  /** Live shoot: watch a folder for new frames, and what is being watched now. */
  onWatchFolder?: () => void;
  onStopWatchingFolder?: () => void;
  onReceiveFromCamera?: () => void;
  /** Live shoot room on other screens on this network (desktop app). */
  shootRoom?: { links: { address: string; url: string }[]; shown: number } | null;
  onOpenShootRoom?: () => void;
  onCloseShootRoom?: () => void;
  liveFolder?: { name: string; imported: number; arriving: number; problem: boolean; ftp?: LiveFtpInbox; tether?: LiveTether } | null;
  onTetherCamera?: () => void;
  /** Import and sorting work under way, shown as a thin line along the top edge (absent or null: nothing running). */
  activity?: import('../utils/edgeActivity').EdgeActivity | null;
  onRunAutoCull: () => void;
  /** Culling Assistant rules with live sliders (x-std-cull-rules); present only while that preview is on. */
  onOpenCullAssistant?: () => void;
  onExportSelected: () => void;
  /** Two selected photos open side by side. */
  onCompareSelected?: () => void;
  onCreateCollage?: (photoIds: string[]) => void;
  /** Focus stack the selected photos into a new photo (a preview feature: absent while its flag is off). */
  onFocusStack?: (photoIds: string[]) => void;
  /** Stitch the selected photos into a new panorama (a preview feature: absent while its flag is off). */
  onStitchPanorama?: (photoIds: string[]) => void;
  /** Merge the selected bracket into a new HDR photo (a preview feature: absent while its flag is off). */
  onHdrMerge?: (photoIds: string[]) => void;
  /** Composing a collage: photos drag onto its windows, and editing-only tools (Auto-Cull) are not offered. */
  collageMode?: boolean;
  /** Composing a collage: open the picker that references photographs from another project. */
  onChooseFromProject?: () => void;
}

export default function Filmstrip({
  photos,
  activePhoto,
  selectedPhotoIds,
  assistMode,
  bottomTab,
  collapsed,
  height,
  filter,
  search,
  pictureIds = null,
  minRating,
  sort,
  onSetMinRating,
  onSetSort,
  tagFilter = null,
  onSetTagFilter,
  savedViews,
  quietBadges,
  looks,
  hasClipboardRecipe,
  onSetBottomTab,
  onSetCollapsed,
  onSetHeight,
  onSetFilter,
  onSetSearch,
  onSelectPhoto,
  onClearSelection,
  onToggleFlag,
  onSetRating,
  onSetDecision,
  onSetBurstGrouped,
  onRemovePhotos,
  onMovePhotos,
  moveTargets = [],
  onPasteRecipe,
  onApplyLook,
  onImport,
  onImportFolder,
  onWatchFolder,
  onStopWatchingFolder,
  onReceiveFromCamera,
  shootRoom,
  onOpenShootRoom,
  onCloseShootRoom,
  onTetherCamera,
  liveFolder,
  activity = null,
  onRunAutoCull,
  onOpenCullAssistant,
  onExportSelected,
  onCompareSelected,
  onCreateCollage,
  onFocusStack,
  onStitchPanorama,
  onHdrMerge,
  collageMode = false,
  onChooseFromProject,
}: FilmstripProps) {
  const hideAutoCull = useProHidden('smartCulling');
  const [searchOpen, setSearchOpen] = useState(false);
  /** A phone-only batch selection mode; desktop keeps modifier-key multi-selection. */
  const [touchSelectionMode, setTouchSelectionMode] = useState(false);
  useEffect(() => { if (!onCreateCollage) setTouchSelectionMode(false); }, [onCreateCollage]);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    // A phone turned sideways is wider than 768 px but still a touch screen: it keeps Select mode. Only a mouse or
    // trackpad (which selects with modifier keys) leaves it.
    const desktop = window.matchMedia('(min-width: 768px) and (pointer: fine)');
    const reset = () => { if (desktop.matches) setTouchSelectionMode(false); };
    reset();
    desktop.addEventListener('change', reset);
    return () => desktop.removeEventListener('change', reset);
  }, []);
  const [expandedBursts, setExpandedBursts] = useState<Set<string>>(() => new Set());
  const [tileMenu, setTileMenu] = useState<{ x: number; y: number; photoId: string } | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<string[] | null>(null);
  const [moving, setMoving] = useState<string[] | null>(null);
  const resizeStart = useRef<{ y: number; h: number } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const touchPress = useRef<{ pointerId: number; x: number; y: number; photoId: string } | null>(null);
  const suppressTouchClick = useRef(false);

  const cancelLongPress = () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    touchPress.current = null;
  };

  useEffect(() => () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
  }, []);

  const startLongPress = (event: React.PointerEvent<HTMLElement>, photoId: string) => {
    if ((event.pointerType !== 'touch' && event.pointerType !== 'pen') || !event.isPrimary || event.button !== 0) return;
    cancelLongPress();
    suppressTouchClick.current = false;
    const { pointerId, clientX: x, clientY: y } = event;
    touchPress.current = { pointerId, x, y, photoId };
    longPressTimer.current = window.setTimeout(() => {
      const press = touchPress.current;
      if (!press || press.pointerId !== pointerId) return;
      suppressTouchClick.current = true;
      if (!selectedPhotoIds.includes(photoId)) onSelectPhoto(photoId);
      setTileMenu({ x: press.x, y: press.y, photoId });
      cancelLongPress();
    }, 500);
  };

  const moveLongPress = (event: React.PointerEvent<HTMLElement>) => {
    const press = touchPress.current;
    if (press && press.pointerId === event.pointerId &&
        Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) {
      cancelLongPress();
    }
  };

  useEffect(() => {
    if (!tileMenu) return;
    const close = () => {
      suppressTouchClick.current = false;
      setTileMenu(null);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    // The browser can target the release click at a menu item that appeared under the held finger.
    const suppressReleaseClick = (event: MouseEvent) => {
      if (!suppressTouchClick.current || event.detail === 0) return;
      suppressTouchClick.current = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    // A held touch or stylus can emit a compatibility mousedown on release. Only a new press dismisses the menu.
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onEscape);
    window.addEventListener('click', suppressReleaseClick, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onEscape);
      window.removeEventListener('click', suppressReleaseClick, true);
    };
  }, [tileMenu]);

  const visiblePhotos = viewPhotos(photos, { filter, search, minRating, sort, tag: tagFilter, pictureIds });
  // Next and previous photo (a macro pad dial or command search) step through the photos shown here, so the filter and rating filter are respected.
  const stepRef = useRef({ visiblePhotos, activePhoto, onSelectPhoto });
  stepRef.current = { visiblePhotos, activePhoto, onSelectPhoto };
  useEffect(() => {
    const onStep = (event: Event) => {
      const delta = (event as CustomEvent<{ delta?: number }>).detail?.delta;
      if (delta !== 1 && delta !== -1) return;
      const { visiblePhotos: list, activePhoto: current, onSelectPhoto: select } = stepRef.current;
      if (list.length === 0) return;
      const index = list.findIndex((photo) => photo.id === current?.id);
      const next = list[Math.min(list.length - 1, Math.max(0, index < 0 ? (delta === 1 ? 0 : list.length - 1) : index + delta))];
      if (next && next.id !== current?.id) {
        select(next.id);
        // Two quick presses can arrive before the next render. Move on from the photo just chosen, not the one still
        // on screen, so no step is lost and a following flag or rating lands on the photo the culler expects.
        stepRef.current = { ...stepRef.current, activePhoto: next };
      }
    };
    window.addEventListener('inflight:photo-step', onStep);
    return () => window.removeEventListener('inflight:photo-step', onStep);
  }, []);
  const openIds = new Set<string>([...selectedPhotoIds, ...(activePhoto ? [activePhoto.id] : [])]);
  const items = planFilmstrip(visiblePhotos, expandedBursts, openIds);
  const planCoverId = (list: typeof items, groupId: string) => { const controls = list.find((entry) => entry.type === 'controls' && entry.groupId === groupId); return controls && controls.type === 'controls' ? controls.cover.id : undefined; };
  const setBurstOpen = (groupId: string, open: boolean) => setExpandedBursts((current) => { const next = new Set(current); if (open) next.add(groupId); else next.delete(groupId); return next; });

  const handleResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeStart.current = { y: e.clientY, h: height };
  };

  const handleResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeStart.current) return;
    const dy = resizeStart.current.y - e.clientY;
    onSetHeight(resizeStart.current.h + dy);
  };

  const handleResizeUp = () => {
    resizeStart.current = null;
  };

  const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    // Match the pointer direction: moving the separator upwards makes the dock taller.
    onSetHeight(height + (event.key === 'ArrowUp' ? 24 : -24));
  };


  const activityMinutes = minutesLeft(activity?.remainingMs ?? null);
  const activityText = !activity ? '' : [activity.label, activity.total !== null ? `${activity.done} / ${activity.total}` : '',
    activityMinutes !== null ? STRINGS.activityBar.minutesLeft(activityMinutes) : ''].filter(Boolean).join(', ');

  return (
    <section
      aria-label={STRINGS.filmstripLabels.label1}
      className="v2-filmstrip relative z-20 flex shrink-0 flex-col border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] select-none"
    >
      <EdgeProgress active={Boolean(activity)} value={activity?.value ?? null} label={activityText} edge="top" testId="filmstrip-progress" />
      {/* Top Resize Drag Bar */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={STRINGS.filmstripLabels.label2}
          aria-valuenow={height}
          aria-valuetext={`${height} pixels high; use Up or Down arrow keys to resize`}
          tabIndex={0}
          onKeyDown={handleResizeKeyDown}
          onPointerDown={handleResizeDown}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
          onPointerCancel={handleResizeUp}
          className="flex h-2 w-full cursor-ns-resize items-center justify-center hover:bg-[var(--brand-accent-soft)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]"
        >
          <span className="h-0.5 w-10 rounded-full bg-[var(--border-default)]" />
        </div>
      )}

      {/* Dock Header Toolbar */}
      <div className="v2-filmstrip-tools flex flex-nowrap items-center justify-between gap-2 overflow-x-auto px-3 py-1.5 border-b border-[var(--border-subtle)] inflight-scroll">
        {/* Selection, import and Auto-Cull controls */}
        <div className="flex shrink-0 items-center gap-2">

          <button type="button" aria-pressed={touchSelectionMode}
            aria-label={touchSelectionMode ? 'Finish selecting photographs' : 'Select multiple photographs'}
            onClick={() => {
              if (touchSelectionMode) onClearSelection();
              else if (collapsed) onSetCollapsed(false);
              setTouchSelectionMode((mode) => !mode);
            }}
            className={`inline-flex min-h-11 shrink-0 items-center rounded px-3 text-xs font-semibold md:hidden
              ${touchSelectionMode ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]' : 'border border-[var(--border-default)] text-[var(--text-primary)]'}`}>
            {touchSelectionMode ? `Done · ${selectedPhotoIds.length}` : 'Select'}
          </button>
          {touchSelectionMode && selectedPhotoIds.length > 1 && onCreateCollage && (
            <button type="button" aria-label={`Make collage from ${selectedPhotoIds.length} selected photographs`}
              onClick={() => { setTouchSelectionMode(false); onCreateCollage(selectedPhotoIds); }}
              className="inline-flex min-h-10 shrink-0 items-center rounded bg-[var(--brand-accent)] px-3 text-xs font-semibold text-[var(--text-on-accent)] md:hidden">
              Make collage · {selectedPhotoIds.length}
            </button>
          )}

          <button
            type="button"
            onClick={onImport}
            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2 text-[0.6875rem] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-surface-hover)] whitespace-nowrap"
          >
            <BrandIcon name="image-plus" size={13} />
            <span className="v2-compact-label">{STRINGS.filmstrip.importPhotos}</span>
          </button>

          <button type="button" onClick={onImportFolder}
            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2 text-[0.6875rem] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] whitespace-nowrap"
            title={STRINGS.filmstripLabels.label4}>
            <BrandIcon name="folder-open" size={13} />
            <span className="v2-compact-label">{STRINGS.filmstripLabels.label10}</span>
          </button>

          {activity && (
            <span data-testid="filmstrip-activity"
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--brand-accent-soft)] px-2 text-[0.6875rem] font-medium text-[var(--text-primary)] whitespace-nowrap">
              <BrandIcon name="clock" size={13} />
              <span>{activity.label}</span>
              {activity.total !== null && <span className="tabular-nums">{activity.done} / {activity.total}</span>}
              {activity.value !== null && <span className="tabular-nums text-[var(--text-secondary)]">({activity.value}%)</span>}
              {activityMinutes !== null && <span className="text-[var(--text-secondary)]">· {STRINGS.activityBar.minutesLeft(activityMinutes)}{activityMinutes >= 5 ? ` · ${STRINGS.activityBar.teaTime}` : ''}</span>}
            </span>
          )}

          {liveFolder ? (
            <span role="status" data-testid="filmstrip-live-folder"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] pl-2 text-[0.6875rem] text-[var(--text-primary)] whitespace-nowrap">
              <BrandIcon name={liveFolder.problem ? 'image-off' : 'folder-arrow'} size={13} />
              <span>{liveFolder.problem ? STRINGS.liveShoot.problem(liveFolder.name) : STRINGS.liveShoot.watching(liveFolder.name, liveFolder.imported)}</span>
              {!liveFolder.problem && liveFolder.arriving > 0 && <span className="text-[var(--text-secondary)]">· {STRINGS.liveShoot.arriving(liveFolder.arriving)}</span>}
              {liveFolder.tether && (
                <span className="text-[var(--text-secondary)]" data-testid="filmstrip-usb-tether">
                  · {liveFolder.tether.fetching ? STRINGS.liveShoot.usbFetching(liveFolder.tether.fetching) : STRINGS.liveShoot.usbTethered(liveFolder.tether.camera)}
                </span>
              )}
              {liveFolder.ftp && (
                <details className="relative" data-testid="filmstrip-ftp-details">
                  <summary className="cursor-pointer list-none px-1 font-medium underline">{STRINGS.liveShoot.cameraSettings}</summary>
                  <div className="absolute bottom-full left-0 z-50 mb-1 w-72 whitespace-normal rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-3 text-xs shadow-lg">
                    <p className="mb-2">{STRINGS.liveShoot.ftpIntro}</p>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                      <dt>{STRINGS.liveShoot.ftpServer}</dt><dd className="font-mono select-all">{liveFolder.ftp.addresses.join(', ') || STRINGS.liveShoot.ftpNoAddress}</dd>
                      <dt>{STRINGS.liveShoot.ftpPort}</dt><dd className="font-mono select-all">{liveFolder.ftp.port}</dd>
                      <dt>{STRINGS.liveShoot.ftpUser}</dt><dd className="font-mono select-all">{liveFolder.ftp.user}</dd>
                      <dt>{STRINGS.liveShoot.ftpPassword}</dt><dd className="font-mono select-all">{liveFolder.ftp.password}</dd>
                      <dt>{STRINGS.liveShoot.ftpMode}</dt><dd>{STRINGS.liveShoot.ftpPassive}</dd>
                    </dl>
                    <p className="mt-2 text-[var(--text-secondary)]">{STRINGS.liveShoot.ftpPlain}</p>
                  </div>
                </details>
              )}
              <button type="button" onClick={onStopWatchingFolder} title={STRINGS.liveShoot.stopHint} data-testid="filmstrip-stop-live"
                className="ml-1 inline-flex h-full items-center rounded-r-[var(--radius-sm)] border-l border-[var(--border-default)] px-2 font-medium hover:bg-[var(--bg-surface-hover)]">
                {STRINGS.liveShoot.stop}
              </button>
            </span>
          ) : onWatchFolder && (
            <button type="button" onClick={onWatchFolder} data-testid="filmstrip-watch-folder"
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2 text-[0.6875rem] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] whitespace-nowrap"
              title={STRINGS.liveShoot.watchHint}>
              <BrandIcon name="folder-arrow" size={13} />
              <span className="v2-compact-label">{STRINGS.liveShoot.watch}</span>
            </button>
          )}
          {shootRoom ? (
            <span role="status" data-testid="filmstrip-shoot-room"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] pl-2 text-[0.6875rem] text-[var(--text-primary)] whitespace-nowrap">
              <span>{STRINGS.liveShoot.roomOpen(shootRoom.shown)}</span>
              <details className="relative" data-testid="filmstrip-room-links">
                <summary className="cursor-pointer list-none px-1 font-medium underline">{STRINGS.liveShoot.roomLinks}</summary>
                <div className="absolute bottom-full left-0 z-50 mb-1 w-80 whitespace-normal rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-3 text-xs shadow-lg">
                  <p className="mb-2">{STRINGS.liveShoot.roomLinksIntro}</p>
                  {shootRoom.links.length ? (
                    <ul className="space-y-1">
                      {shootRoom.links.map((link) => <li key={link.url} className="font-mono break-all select-all">{link.url}</li>)}
                    </ul>
                  ) : <p>{STRINGS.liveShoot.ftpNoAddress}</p>}
                  <p className="mt-2 text-[var(--text-secondary)]">{STRINGS.liveShoot.roomPlain}</p>
                </div>
              </details>
              <button type="button" onClick={onCloseShootRoom} title={STRINGS.liveShoot.roomCloseHint} data-testid="filmstrip-close-room"
                className="ml-1 inline-flex h-full items-center rounded-r-[var(--radius-sm)] border-l border-[var(--border-default)] px-2 font-medium hover:bg-[var(--bg-surface-hover)]">
                {STRINGS.liveShoot.roomClose}
              </button>
            </span>
          ) : onOpenShootRoom && (
            <button type="button" onClick={onOpenShootRoom} data-testid="filmstrip-open-room"
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2 text-[0.6875rem] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] whitespace-nowrap"
              title={STRINGS.liveShoot.roomHint}>
              <BrandIcon name="select-photos" size={13} />
              <span className="v2-compact-label">{STRINGS.liveShoot.room}</span>
            </button>
          )}
          {!liveFolder && onTetherCamera && (
            <button type="button" onClick={onTetherCamera} data-testid="filmstrip-tether-usb"
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2 text-[0.6875rem] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] whitespace-nowrap"
              title={STRINGS.liveShoot.usbHint}>
              <BrandIcon name="camera-settings" size={13} />
              <span className="v2-compact-label">{STRINGS.liveShoot.usb}</span>
            </button>
          )}
          {!liveFolder && onReceiveFromCamera && (
            <button type="button" onClick={onReceiveFromCamera} data-testid="filmstrip-receive-camera"
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2 text-[0.6875rem] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] whitespace-nowrap"
              title={STRINGS.liveShoot.receiveHint}>
              <BrandIcon name="camera-settings" size={13} />
              <span className="v2-compact-label">{STRINGS.liveShoot.receive}</span>
            </button>
          )}

          {onChooseFromProject && (
            <button type="button" onClick={onChooseFromProject} data-testid="filmstrip-from-project"
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2 text-[0.6875rem] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] whitespace-nowrap"
              title={STRINGS.collage.chooseFromAnotherProject}>
              <BrandIcon name="folder-open" size={13} />
              <span>{STRINGS.collage.fromProject}</span>
            </button>
          )}

          {!hideAutoCull && !collageMode && (
          <button
            type="button"
            onClick={onRunAutoCull}
            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--brand-accent-soft)] px-2 text-[0.6875rem] font-medium text-[var(--brand-accent)] transition-colors hover:bg-[var(--brand-accent)] hover:text-[var(--text-on-accent)] whitespace-nowrap"
          >
            <BrandIcon name="find-subject" size={13} />
            <span>
              {STRINGS.filmstrip.autoCull}
              {assistMode === 'autopilot' ? ' · Auto' : ''}
            </span>
            <ProBadge feature="smartCulling" />
          </button>
          )}
          {onOpenCullAssistant && !hideAutoCull && !collageMode && (
            <button type="button" onClick={onOpenCullAssistant} data-testid="open-cull-assistant"
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 text-[0.6875rem] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] whitespace-nowrap">
              <span>{CULL_ASSISTANT_LABEL}</span>
            </button>
          )}
        </div>

        {/* Right: Multi-select batch actions OR Search + All/Flagged filter + Hide toggle */}
        <div className="flex shrink-0 items-center gap-2">
          {selectedPhotoIds.length > 1 && (
            <div className="flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--brand-accent-soft)] px-2 py-1 text-xs text-[var(--brand-accent)]">
              <span className="font-semibold tabular-nums">
                {STRINGS.filmstrip.selectedCount(selectedPhotoIds.length)}
              </span>
              <button
                type="button"
                onClick={() => onToggleFlag(selectedPhotoIds)}
                className="rounded px-1.5 py-0.5 font-medium hover:bg-[var(--bg-surface)]"
              >
                {STRINGS.filmstrip.flagAction}
              </button>
              <button
                type="button"
                onClick={onExportSelected}
                className="rounded px-1.5 py-0.5 font-medium hover:bg-[var(--bg-surface)]"
              >
                {STRINGS.filmstripLabels.label11}
              </button>
              {selectedPhotoIds.length === 2 && onCompareSelected && (
                <button type="button" onClick={onCompareSelected} data-testid="compare-selected"
                  className="rounded px-1.5 py-0.5 font-medium hover:bg-[var(--bg-surface)]">{STRINGS.pairCompare.compareTwo}</button>
              )}
              {onCreateCollage && <button type="button" onClick={() => onCreateCollage(selectedPhotoIds)}
                className="rounded px-1.5 py-0.5 font-medium hover:bg-[var(--bg-surface)]">{STRINGS.filmstripLabels.label12}</button>}
              <button
                type="button"
                onClick={onClearSelection}
                className="rounded px-1 py-0.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                {STRINGS.filmstrip.clearSelection}
              </button>
            </div>
          )}

          {/* Decision filter, then rating and order */}
          {/* While several photos are selected, the selection's actions take this space. */}
          {selectedPhotoIds.length <= 1 && (
            <>
              <DecisionFilter photos={photos} filter={filter} onSetFilter={onSetFilter} compact />
              <ViewOptions minRating={minRating} sort={sort} onSetMinRating={onSetMinRating} onSetSort={onSetSort} savedViews={savedViews} />
              {onSetTagFilter && <TagFilterSelect photos={photos} value={tagFilter} onChange={onSetTagFilter} />}
            </>
          )}

          {/* Search icon expanding into search input */}
          {searchOpen || search ? (
            <div className="relative flex items-center">
              <BrandIcon
                name="search"
                size={13}
                className="pointer-events-none absolute left-2.5 text-[var(--text-muted)]"
              />
              <input
                type="search"
                autoFocus
                value={search}
                onChange={(e) => onSetSearch(e.target.value)}
                onBlur={() => {
                  if (!search) setSearchOpen(false);
                }}
                placeholder={STRINGS.filmstrip.searchPlaceholder}
                aria-label={STRINGS.filmstrip.searchPlaceholder}
                className="h-8 w-44 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] pl-7 pr-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
              <SearchNote photos={photos} search={search} pictureIds={pictureIds} className="ml-2 hidden max-w-[16rem] truncate md:inline" />
            </div>
          ) : (
            <button
              type="button"
              aria-label={STRINGS.filmstrip.searchToggle}
              title={STRINGS.filmstrip.searchToggle}
              onClick={() => setSearchOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
            >
              <BrandIcon name="search" size={15} />
            </button>
          )}

          {/* Collapse / Expand chevron */}
          <button
            type="button"
            aria-label={collapsed ? STRINGS.filmstrip.expand : STRINGS.filmstrip.collapse}
            title={collapsed ? STRINGS.filmstrip.expand : STRINGS.filmstrip.collapse}
            onClick={() => onSetCollapsed(!collapsed)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            <span className={`inline-flex transition-transform ${collapsed ? 'rotate-180' : ''}`}>
              <BrandIcon name="chevron" size={15} />
            </span>
          </button>
        </div>
      </div>

      {/* Filmstrip */}
      {!collapsed && (
        <div style={{ height }} className="v2-filmstrip-body w-full overflow-hidden">
          {visiblePhotos.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
              {STRINGS.filmstrip.nothingMatches}
            </div>
          ) : (
            <div
              role="listbox"
              aria-label={STRINGS.filmstripLabels.label6}
              aria-multiselectable="true"
              className="flex h-full items-center gap-2.5 overflow-x-auto inflight-scroll px-3 py-2"
            >
              {items.map((item) => {
                if (item.type === 'controls') {
                  return (
                    <div key={`burst-${item.groupId}`} role="group" aria-label={STRINGS.bursts.controls(item.count)} className="h-full w-40 shrink-0 flex flex-col justify-center gap-1.5 rounded-[var(--radius-md)] border border-dashed border-[var(--brand-accent-border)] bg-[var(--bg-surface)] p-2">
                      <p className="text-[0.6875rem] font-semibold text-[var(--text-primary)]">{STRINGS.bursts.controls(item.count)}</p>
                      <button type="button" disabled={!item.best} title={item.best ? undefined : STRINGS.bursts.flagBestNotRanked}
                        onClick={() => { if (item.best) onSetDecision([item.best.id], 'keep'); }}
                        className="min-h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 text-[0.6875rem] font-medium text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50">{STRINGS.bursts.flagBest}</button>
                      {!item.best && <span className="text-[0.625rem] leading-tight text-[var(--text-muted)]">{STRINGS.bursts.flagBestNotRanked}</span>}
                      <button type="button" onClick={() => onSetBurstGrouped(item.groupId, false)} className="min-h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 text-[0.6875rem] font-medium text-[var(--text-primary)]">{STRINGS.bursts.split}</button>
                      <button type="button" onClick={() => { onSelectPhoto(item.cover.id); setBurstOpen(item.groupId, false); }} className="min-h-8 rounded-[var(--radius-sm)] px-2 text-[0.6875rem] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">{STRINGS.bursts.collapse}</button>
                    </div>
                  );
                }
                const photo = item.photo;
                const stack = item.stack;
                const isActive = activePhoto?.id === photo.id;
                const isSelected = selectedPhotoIds.includes(photo.id);
                const flagged = photo.decision === 'keep';
                const stateLabel = STRINGS.filmstrip.tileStates[photo.state];

                return (
                  <div
                    key={photo.id}
                    role="option"
                    aria-selected={isSelected}
                    draggable={collageMode}
                    onDragStart={collageMode ? (event) => {
                      cancelLongPress();
                      event.dataTransfer.effectAllowed = 'copy';
                      event.dataTransfer.setData(PHOTO_DRAG_TYPE, JSON.stringify(draggedPhotoIds(photo.id, selectedPhotoIds)));
                      event.dataTransfer.setData('text/plain', photo.filename);
                    } : undefined}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!isSelected) onSelectPhoto(photo.id);
                      setTileMenu({
                        x: Math.min(e.clientX, window.innerWidth - 200),
                        y: Math.max(12, e.clientY - 120),
                        photoId: photo.id,
                      });
                    }}
                    onPointerDown={(event) => startLongPress(event, photo.id)}
                    onPointerMove={moveLongPress}
                    onPointerUp={cancelLongPress}
                    onPointerCancel={cancelLongPress}
                    className={`v2-strip-tile group relative flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-md)] border transition-colors w-36 shrink-0 ${
                      isActive
                        ? 'border-[var(--brand-accent)] bg-[var(--bg-surface-raised)] ring-1 ring-[var(--brand-accent)]'
                        : isSelected
                        ? 'border-[var(--brand-accent-border)] bg-[var(--bg-surface-raised)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-input)] hover:border-[var(--border-default)]'
                    }`}
                  >
                    {stack && (
                      <button
                        type="button"
                        aria-expanded={stack.expanded}
                        aria-label={stack.expanded ? STRINGS.bursts.hide : STRINGS.bursts.show(stack.count)}
                        title={stack.expanded ? STRINGS.bursts.hide : STRINGS.bursts.show(stack.count)}
                        onClick={(event) => { event.stopPropagation(); if (stack.expanded) onSelectPhoto(planCoverId(items, stack.groupId) ?? photo.id); setBurstOpen(stack.groupId, !stack.expanded); }}
                        className="absolute left-1 top-1 z-10 min-h-9 rounded bg-[var(--bg-scrim)] px-2 text-[0.625rem] font-semibold text-white"
                      >
                        {STRINGS.bursts.badge(stack.count)}{!stack.expanded ? ' ▸' : ''}
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`More actions for ${photo.filename}`}
                      title={STRINGS.filmstripLabels.label7}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!isSelected) onSelectPhoto(photo.id);
                        const bounds = event.currentTarget.getBoundingClientRect();
                        setTileMenu({ x: bounds.left, y: bounds.bottom, photoId: photo.id });
                      }}
                      className="v2-strip-tile-more absolute right-1 top-1 z-10 flex min-h-9 min-w-9 items-center justify-center rounded bg-[var(--bg-surface-raised)] text-xs font-bold text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]"
                    >
                      <span aria-hidden="true">⋯</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) =>
                        onSelectPhoto(photo.id, {
                          ctrl: touchSelectionMode || e.ctrlKey || e.metaKey,
                          shift: !touchSelectionMode && e.shiftKey,
                        })
                      }
                      className="relative flex-1 w-full overflow-hidden bg-[var(--bg-canvas)] text-left"
                    >
                      <img
                        src={photo.thumbUrl}
                        alt={photo.title}
                        referrerPolicy="no-referrer"
                        className={`h-full w-full object-cover ${
                          photo.state === 'unavailable' ? 'opacity-55' : ''
                        }`}
                      />
                      {/* Tile state word (always readable text, never colour alone) */}
                      {photo.tier && (
                        <span
                          data-testid="tier-badge"
                          title={`${STRINGS.tier.label}: ${STRINGS.tier[photo.tier]}`}
                          className="absolute right-1.5 bottom-1.5 rounded border border-[var(--brand-accent-border)] bg-[var(--bg-scrim)] px-1.5 py-0.5 text-[0.5625rem] font-semibold text-white"
                        >
                          {STRINGS.tier[photo.tier]}
                        </span>
                      )}
                      {/* Fewer badges hides the Ready label from view only: the state stays in the button's name. */}
                      {photo.state === 'ready' && quietBadges ? (
                        <span className="sr-only">{stateLabel}</span>
                      ) : (
                        <span
                          title={photo.state === 'unsupported' ? engineText.workspace.rawJpegXl : undefined}
                          className={`${photo.state === 'ready' ? 'v2-strip-tile-ready ' : ''}absolute left-1.5 bottom-1.5 rounded px-1.5 py-0.5 text-[0.5625rem] font-semibold ${
                            photo.state === 'unavailable' || photo.state === 'unsupported'
                              ? 'bg-[var(--semantic-warning)] text-[#140d0a]'
                              : photo.state === 'importing' || photo.state === 'analysing'
                              ? 'bg-[var(--semantic-info)] text-[#09121a]'
                              : 'bg-[var(--bg-scrim)] text-white'
                          }`}
                        >
                          {stateLabel}
                          {photo.state === 'unsupported' && <span className="sr-only">. {engineText.workspace.rawJpegXl}</span>}
                        </span>
                      )}
                    </button>

                    {/* Tile footer: filename + flag toggle */}
                    <div className="v2-strip-tile-footer flex h-9 shrink-0 items-center justify-between gap-1 px-1">
                      <span className="v2-strip-tile-name truncate font-mono text-[0.625rem] text-[var(--text-secondary)]" title={photo.pairedJpeg ? STRINGS.pair.title(photo.filename, photo.pairedJpeg) : undefined}>
                        {photo.pairedJpeg && <span data-testid="pair-badge" className="mr-1 rounded-sm border border-[var(--border-default)] px-0.5 font-sans font-semibold text-[var(--text-primary)]">{STRINGS.pair.badge}</span>}
                        <PictureSourceBadge picture={photo.picture?.thumb} compact className="mr-1 align-middle" />
                        {photo.filename}
                      </span>
                      <button
                        type="button"
                        aria-label={flagged ? `Unflag ${photo.filename}` : `Flag ${photo.filename}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFlag([photo.id]);
                        }}
                        className={`inline-flex min-h-9 min-w-9 items-center justify-center rounded transition-colors focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)] ${
                          flagged
                            ? 'text-[var(--brand-accent)]'
                            : 'text-[var(--text-muted)] opacity-60 hover:opacity-100 hover:text-[var(--text-primary)]'
                        }`}
                      >
                        <BrandIcon name={flagged ? 'flag' : 'flag-off'} size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* V2 photo / multi-selection context menu: actions reuse the editor store. */}
      {tileMenu && (() => {
        const menuTargetIds = selectedPhotoIds.includes(tileMenu.photoId) ? selectedPhotoIds : [tileMenu.photoId];
        const menuTargetsAllSetAside = menuTargetIds.length > 0 &&
          menuTargetIds.every((id) => photos.find((p) => p.id === id)?.decision === 'reject');
        return (
        <div
          role="menu"
          aria-label={STRINGS.filmstripLabels.label7}
          onPointerDown={(e) => {
            suppressTouchClick.current = false;
            e.stopPropagation();
          }}
          className="fixed z-50 w-56 max-h-[min(70dvh,16rem)] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] py-1.5 shadow-[var(--shadow-popover)] md:max-h-[70vh]"
          style={{ left: Math.max(8, Math.min(tileMenu.x, window.innerWidth - 232)), top: Math.max(8, Math.min(tileMenu.y, window.innerHeight - 270)) }}
        >
          <p className="px-3 py-1 text-[0.6875rem] text-[var(--text-muted)]">
            {selectedPhotoIds.includes(tileMenu.photoId) && selectedPhotoIds.length > 1
              ? `${selectedPhotoIds.length} selected photos`
              : 'Photo actions'}
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onToggleFlag(selectedPhotoIds.includes(tileMenu.photoId) ? selectedPhotoIds : [tileMenu.photoId]);
              setTileMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
          >
            <BrandIcon name="flag" size={14} />
            <span>{STRINGS.filmstripLabels.label15}</span>
          </button>
          {onCreateCollage && <button type="button" role="menuitem"
            onClick={() => { onCreateCollage(selectedPhotoIds.includes(tileMenu.photoId) ? selectedPhotoIds : [tileMenu.photoId]); setTileMenu(null); }}
            className="flex min-h-10 w-full items-center px-3 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
            {STRINGS.filmstripLabels.label16}
          </button>}
          {onFocusStack && menuTargetIds.length >= 2 && <button type="button" role="menuitem" title={stackText.menuHint}
            onClick={() => { onFocusStack(menuTargetIds); setTileMenu(null); }}
            className="flex min-h-10 w-full items-center px-3 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
            {stackText.menu(menuTargetIds.length)}
          </button>}
          {onStitchPanorama && menuTargetIds.length >= 2 && <button type="button" role="menuitem" title={panoText.menuHint}
            onClick={() => { onStitchPanorama(menuTargetIds); setTileMenu(null); }}
            className="flex min-h-10 w-full items-center px-3 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
            {panoText.menu(menuTargetIds.length)}
          </button>}
          {onHdrMerge && menuTargetIds.length >= 2 && <button type="button" role="menuitem" title={`${hdrText.whatIs} ${hdrText.menuHint}`} data-testid="v2-hdr-merge-menu"
            onClick={() => { onHdrMerge(menuTargetIds); setTileMenu(null); }}
            className="flex min-h-10 w-full items-center px-3 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
            {hdrText.menu(menuTargetIds.length)}
          </button>}
          <button type="button" role="menuitem"
            onClick={() => {
              onSetDecision(selectedPhotoIds.includes(tileMenu.photoId) ? selectedPhotoIds : [tileMenu.photoId], 'reject');
              setTileMenu(null);
            }}
            className="flex w-full px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
            {STRINGS.filmstripLabels.label17}
          </button>
          <button type="button" role="menuitem"
            onClick={() => {
              onSetDecision(selectedPhotoIds.includes(tileMenu.photoId) ? selectedPhotoIds : [tileMenu.photoId], 'unreviewed');
              setTileMenu(null);
            }}
            className="flex w-full px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
            {STRINGS.filmstripLabels.label18}
          </button>
          {photos.find((p) => p.id === tileMenu.photoId)?.burst?.ungrouped && (
            <button type="button" role="menuitem"
              onClick={() => {
                const groupId = photos.find((p) => p.id === tileMenu.photoId)?.burst?.groupId;
                if (groupId) onSetBurstGrouped(groupId, true);
                setTileMenu(null);
              }}
              className="flex w-full px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
              {STRINGS.bursts.regroup}
            </button>
          )}
          {onMovePhotos && !collageMode && (
            <button type="button" role="menuitem"
              onClick={() => { setMoving(menuTargetIds); setTileMenu(null); }}
              className="flex w-full px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
              {STRINGS.filmstripLabels.moveMenu}
            </button>
          )}
          {menuTargetsAllSetAside && (
            <button type="button" role="menuitem"
              onClick={() => {
                setRemoveConfirm(menuTargetIds);
                setTileMenu(null);
              }}
              className="flex w-full px-3 py-2 text-left text-xs text-[var(--status-danger,#e5484d)] hover:bg-[var(--bg-surface-hover)]">
              Remove {menuTargetIds.length > 1 ? `${menuTargetIds.length} photos` : 'photo'}…
            </button>
          )}
          <div className="border-t border-[var(--border-subtle)] px-3 py-2">
            <span className="mb-1 block text-[0.6875rem] text-[var(--text-secondary)]">{STRINGS.filmstripLabels.label13}</span>
            <div className="flex flex-wrap gap-1" role="group" aria-label={STRINGS.filmstripLabels.label8}>
              {[0, 1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  type="button"
                  aria-label={rating === 0 ? 'Clear rating' : `Rate ${rating} stars`}
                  title={rating === 0 ? 'Clear rating' : `${rating} stars`}
                  onClick={() => {
                    onSetRating(selectedPhotoIds.includes(tileMenu.photoId) ? selectedPhotoIds : [tileMenu.photoId], rating);
                    setTileMenu(null);
                  }}
                  className="min-h-8 min-w-7 rounded border border-[var(--border-subtle)] px-1 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
                >
                  {rating === 0 ? '–' : rating}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            disabled={!hasClipboardRecipe}
            onClick={() => {
              onPasteRecipe();
              setTileMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <BrandIcon name="paste" size={14} />
            <span>{STRINGS.filmstripLabels.label19}</span>
          </button>
          <label className="block px-3 py-1.5 text-[0.6875rem] text-[var(--text-secondary)]">
            {STRINGS.filmstripLabels.label20}
            <select
              aria-label={STRINGS.filmstripLabels.label9}
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) onApplyLook(tileMenu.photoId, event.target.value);
                setTileMenu(null);
              }}
              className="mt-1 h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)]"
            >
              <option value="" disabled>{STRINGS.filmstripLabels.label22}</option>
              {looks.map((look) => <option key={look.id} value={look.id}>{look.name}</option>)}
            </select>
          </label>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onExportSelected();
              setTileMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
          >
            <BrandIcon name="export" size={14} />
            <span>{STRINGS.filmstripLabels.label23}</span>
          </button>
        </div>
        );
      })()}

      {/* Confirm before Trash: reversible (Undo brings it straight back), but still asks first like V1. */}
      {removeConfirm && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="remove-photos-title" aria-describedby="remove-photos-body"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-scrim)] p-4"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="w-full max-w-md space-y-4 rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 shadow-[var(--shadow-panel)]">
            <h2 id="remove-photos-title" className="text-base font-bold text-[var(--text-primary)]">
              {removeConfirm.length > 1 ? `Remove ${removeConfirm.length} photos?` : 'Remove this photo?'}
            </h2>
            <p id="remove-photos-body" className="text-sm leading-relaxed text-[var(--text-secondary)]">
              This takes {removeConfirm.length > 1 ? 'these set-aside photos' : 'this set-aside photo'} out of InFlight's catalogue. Your original file on disk is never touched, and Undo (Cmd/Ctrl+Z) brings it straight back.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => setRemoveConfirm(null)}
                className="min-h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] px-4 text-xs font-medium text-[var(--text-primary)]">
                Keep photo{removeConfirm.length > 1 ? 's' : ''}
              </button>
              <button type="button" onClick={() => {
                  onRemovePhotos(removeConfirm);
                  setRemoveConfirm(null);
                }}
                className="min-h-10 rounded-[var(--radius-md)] bg-[var(--status-danger,#e5484d)] px-4 text-xs font-semibold text-white">
                {STRINGS.filmstripLabels.label21}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Move to another project: pick where; the move itself runs as a task in Tasks. In the workspace root, so the
          phone's sliding filmstrip sheet (a transformed parent) cannot clip it or carry it off screen. */}
      {moving && onMovePhotos && createPortal(
        <div role="dialog" aria-modal="true" aria-labelledby="move-photos-title" aria-describedby="move-photos-body"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-scrim)] p-4"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Escape') setMoving(null); }}
        >
          <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col gap-4 rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 shadow-[var(--shadow-panel)]">
            <h2 id="move-photos-title" className="text-base font-bold text-[var(--text-primary)]">{STRINGS.filmstripLabels.moveTitle}</h2>
            <p id="move-photos-body" className="text-sm leading-relaxed text-[var(--text-secondary)]">
              {moveTargets.length ? STRINGS.filmstripLabels.moveBody : STRINGS.filmstripLabels.moveNoProjects}
            </p>
            {moveTargets.length > 0 && (
              <ul className="min-h-0 space-y-1 overflow-y-auto" data-testid="move-targets">
                {moveTargets.map((target) => (
                  <li key={target.id}>
                    <button type="button"
                      onClick={() => { onMovePhotos(moving, target.id); setMoving(null); }}
                      className="flex min-h-11 w-full items-center rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
                      {target.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <button type="button" autoFocus onClick={() => setMoving(null)}
                className="min-h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] px-4 text-xs font-medium text-[var(--text-primary)]">
                {STRINGS.hub.modalCancel}
              </button>
            </div>
          </div>
        </div>,
        document.querySelector('.inflight-v2') ?? document.body,
      )}
    </section>
  );
}
