import type { CropTransform } from '../ui/contract';

/**
 * One description of where the picture sits in a format, shared by every view that draws it: the single view, the
 * All formats board, each pane of a split format, and (through `exportCrop`) the exported file. Each view used to build
 * its own CSS, and they drifted (G02): the edge insets moved with the zoomed picture in the single view, were missing
 * on the board and in split panes, and export clamped the split offset where the canvas did not.
 *
 * A pane shows one of `paneCount` side-by-side frames of one continuous picture. The picture element spans the whole
 * composition (`paneCount` frames wide), covers it, and is moved by the crop about the composition's centre, exactly as
 * `cropPlacement` and `renderV2Export` draw the exported composition.
 */
export interface PaneImageStyle {
  /** The picture element's width as a share of the pane: the whole composition. Absent for a single frame. */
  width?: string;
  transform: string;
}

const finite = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);

/** The crop export draws: the split offset moves the picture across the whole composition, unclamped, as on the canvas. */
export function exportCrop(crop: CropTransform, splitOffset = 0): CropTransform {
  const offset = finite(splitOffset);
  return offset === 0 ? crop : { ...crop, panX: finite(crop.panX) + offset };
}

/** CSS for the picture inside pane `paneIndex` of `paneCount` (1 for an unsplit format). */
export function paneImageStyle(crop: CropTransform, paneIndex = 0, paneCount = 1, splitOffset = 0): PaneImageStyle {
  const count = Math.max(1, Math.floor(paneCount));
  const index = Math.min(count - 1, Math.max(0, Math.floor(paneIndex)));
  const moved = exportCrop(crop, count > 1 ? splitOffset : 0);
  const sx = (moved.flipH ? -1 : 1) * moved.zoom;
  const sy = (moved.flipV ? -1 : 1) * moved.zoom;
  // translate() percentages resolve against the element, which is the whole composition, so the pane's own place in it
  // is -index/count of that width.
  const panX = moved.panX - (index * 100) / count;
  const transform = `translate(${panX}%, ${moved.panY}%) rotate(${moved.rotateDeg}deg) scale(${sx}, ${sy})`;
  return count > 1 ? { width: `${count * 100}%`, transform } : { transform };
}

/**
 * The edge insets as a CSS clip for pane `paneIndex`, in the frame's own (untransformed) coordinates, as export clips
 * them. The insets are shares of the whole composition, so with several panes a left inset may cover the first pane
 * and part of the next. Undefined when nothing is clipped.
 */
export function paneInsetClip(crop: CropTransform, paneIndex = 0, paneCount = 1): string | undefined {
  const count = Math.max(1, Math.floor(paneCount));
  const index = Math.min(count - 1, Math.max(0, Math.floor(paneIndex)));
  const bound = (value: number) => Math.min(100, Math.max(0, value));
  const top = bound(finite(crop.insetTop));
  const bottom = bound(finite(crop.insetBottom));
  const left = bound(finite(crop.insetLeft) * count - index * 100);
  const right = bound(finite(crop.insetRight) * count - (count - 1 - index) * 100);
  if (!top && !right && !bottom && !left) return undefined;
  return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
}
