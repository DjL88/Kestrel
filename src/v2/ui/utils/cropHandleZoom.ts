/** A resize handle lives on the outside of the visible picture, not on the crop window.
 * Pulling it AWAY from the centre should enlarge the picture (zoom in);
 * pushing it TOWARDS the centre should reduce it, never below fit (1x).
 *
 * Uses the same normalised horizontal/vertical delta for corners, so portrait
 * and landscape behave alike and the sign is consistent on every edge.
 */
export type CropHandleSide = 'top' | 'bottom' | 'left' | 'right' | 'tl' | 'tr' | 'bl' | 'br';

const SIDES: readonly CropHandleSide[] = ['top', 'bottom', 'left', 'right', 'tl', 'tr', 'bl', 'br'];

export function cropHandleZoom(
  side: CropHandleSide, dx: number, dy: number,
  width: number, height: number, startingZoom: number,
  maximumZoom = 8,
): number {
  const maximum = Number.isFinite(maximumZoom) ? Math.max(1, maximumZoom) : 8;
  const base = Number.isFinite(startingZoom) ? Math.max(1, startingZoom) : 1;
  const unchanged = Math.min(maximum, base);
  // Invalid pointer samples and geometry are not a drag. Never convert a bad
  // coordinate into a zero delta or allow overflowing ratios into the recipe.
  if (!SIDES.includes(side) || ![dx, dy, width, height].every(Number.isFinite)
    || width <= 0 || height <= 0) return unchanged;
  const x = dx / width;
  const y = dy / height;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return unchanged;
  const outward = side === 'top' ? -y
    : side === 'bottom' ? y
    : side === 'left' ? -x
    : side === 'right' ? x
    : side === 'tl' ? (-x - y) / 2
    : side === 'tr' ? (x - y) / 2
    : side === 'bl' ? (-x + y) / 2
    : (x + y) / 2;
  if (!Number.isFinite(outward)) return unchanged;
  return Math.max(1, Math.min(maximum, base / Math.max(0.05, 1 - outward)));
}
