/** A resize handle lives on the outside of the visible picture, not on the crop window.
 * Pulling it AWAY from the centre should enlarge the picture (zoom in);
 * pushing it TOWARDS the centre should reduce it, never below fit (1x).
 *
 * Uses the same normalised horizontal/vertical delta for corners, so portrait
 * and landscape behave alike and the sign is consistent on every edge.
 */
export type CropHandleSide = 'top' | 'bottom' | 'left' | 'right' | 'tl' | 'tr' | 'bl' | 'br';

export function cropHandleZoom(
  side: CropHandleSide, dx: number, dy: number,
  width: number, height: number, startingZoom: number,
  maximumZoom = 8,
): number {
  const x = Number.isFinite(dx) && Number.isFinite(width) && width > 0 ? dx / width : 0;
  const y = Number.isFinite(dy) && Number.isFinite(height) && height > 0 ? dy / height : 0;
  const outward = side === 'top' ? -y
    : side === 'bottom' ? y
    : side === 'left' ? -x
    : side === 'right' ? x
    : side === 'tl' ? (-x - y) / 2
    : side === 'tr' ? (x - y) / 2
    : side === 'bl' ? (-x + y) / 2
    : (x + y) / 2;
  const base = Number.isFinite(startingZoom) ? Math.max(1, startingZoom) : 1;
  const maximum = Number.isFinite(maximumZoom) ? Math.max(1, maximumZoom) : 8;
  return Math.max(1, Math.min(maximum, base / Math.max(0.05, 1 - outward)));
}
