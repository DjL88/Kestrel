import React from 'react';
import { engineText } from '../../../i18n/areas/engine';
import type { Photo } from '../contract';
import { STRINGS } from '../strings';
import { PHOTO_DRAG_TYPE } from '../utils/photoDrag';
import PictureSourceBadge from './PictureSourceBadge';
import BrandIcon from '../icons/BrandIcon';

/**
 * What a tile asks the strip to do. The object is made once by the strip and reads the strip's latest state through a
 * ref, so passing it never makes a tile draw again.
 */
export interface TileActions {
  select: (photoId: string, modifiers?: { ctrl?: boolean; shift?: boolean }) => void;
  toggleFlag: (photoId: string) => void;
  /** Open the tile's menu at this point; the photo is selected first unless it already is. */
  openMenu: (x: number, y: number, photoId: string) => void;
  dragIds: (photoId: string) => string[];
  longPressStart: (event: React.PointerEvent<HTMLElement>, photoId: string) => void;
  longPressMove: (event: React.PointerEvent<HTMLElement>) => void;
  longPressCancel: () => void;
  toggleStack: (groupId: string, expanded: boolean, photoId: string) => void;
}

export interface FilmstripTileProps {
  photo: Photo;
  stack?: { groupId: string; count: number; expanded: boolean };
  active: boolean;
  selected: boolean;
  quietBadges: boolean;
  collageMode: boolean;
  touchSelectionMode: boolean;
  actions: TileActions;
  /** Set when the strip only draws the tiles in view: where this tile sits along it. */
  style?: React.CSSProperties;
  posInSet?: number;
  setSize?: number;
}

/** One photo in the filmstrip. */
function FilmstripTile({ photo, stack, active, selected, quietBadges, collageMode, touchSelectionMode, actions, style, posInSet, setSize }: FilmstripTileProps) {
  const flagged = photo.decision === 'keep';
  const stateLabel = STRINGS.filmstrip.tileStates[photo.state];
  return (
    <div
      role="option"
      aria-selected={selected}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      data-photo-id={photo.id}
      // Tiles on screen get their thumbnails first (useThumbnailsOnScreen); it watches tiles as the strip draws them.
      data-thumb-id={photo.id}
      style={style}
      draggable={collageMode}
      onDragStart={collageMode ? (event) => {
        actions.longPressCancel();
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData(PHOTO_DRAG_TYPE, JSON.stringify(actions.dragIds(photo.id)));
        event.dataTransfer.setData('text/plain', photo.filename);
      } : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        actions.openMenu(Math.min(e.clientX, window.innerWidth - 200), Math.max(12, e.clientY - 120), photo.id);
      }}
      onPointerDown={(event) => actions.longPressStart(event, photo.id)}
      onPointerMove={actions.longPressMove}
      onPointerUp={actions.longPressCancel}
      onPointerCancel={actions.longPressCancel}
      className={`v2-strip-tile group relative flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-md)] border transition-colors shrink-0 ${
        active
          ? 'border-[var(--brand-accent)] bg-[var(--bg-surface-raised)] ring-1 ring-[var(--brand-accent)]'
          : selected
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
          onClick={(event) => { event.stopPropagation(); actions.toggleStack(stack.groupId, stack.expanded, photo.id); }}
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
          const bounds = event.currentTarget.getBoundingClientRect();
          actions.openMenu(bounds.left, bounds.bottom, photo.id);
        }}
        className="v2-strip-tile-more absolute right-1 top-1 z-10 flex min-h-9 min-w-9 items-center justify-center rounded bg-[var(--bg-surface-raised)] text-xs font-bold text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      <button
        type="button"
        onClick={(e) =>
          actions.select(photo.id, {
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
            actions.toggleFlag(photo.id);
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
}

/** What a tile shows of its photo. The photo list is rebuilt when any photo changes, so a tile compares these, not the object. */
const shownOf = (photo: Photo) => [
  photo.id, photo.thumbUrl, photo.title, photo.filename, photo.state, photo.tier ?? '', photo.decision, photo.pairedJpeg ?? '',
  photo.picture?.thumb ? JSON.stringify(photo.picture.thumb) : '',
];

export function sameTile(a: FilmstripTileProps, b: FilmstripTileProps): boolean {
  if (a.active !== b.active || a.selected !== b.selected || a.quietBadges !== b.quietBadges || a.collageMode !== b.collageMode
    || a.touchSelectionMode !== b.touchSelectionMode || a.actions !== b.actions || a.posInSet !== b.posInSet || a.setSize !== b.setSize) return false;
  if ((a.style?.left ?? null) !== (b.style?.left ?? null)) return false;
  if ((a.stack?.groupId ?? '') !== (b.stack?.groupId ?? '') || (a.stack?.count ?? 0) !== (b.stack?.count ?? 0) || (a.stack?.expanded ?? false) !== (b.stack?.expanded ?? false)) return false;
  if (a.photo === b.photo) return true;
  const [x, y] = [shownOf(a.photo), shownOf(b.photo)];
  return x.every((value, index) => value === y[index]);
}

export default React.memo(FilmstripTile, sameTile);
