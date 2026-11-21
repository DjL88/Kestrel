export interface ViewportPoint { x: number; y: number }

export interface ViewportTransform {
  zoom: number;
  pan: ViewportPoint;
}

export const FIT_VIEW: ViewportTransform = { zoom: 1, pan: { x: 0, y: 0 } };

const valid = (value: number) => Number.isFinite(value);

/** Keep invalid pointer and container measurements from sending a photo offscreen. */
export function transformViewport(
  current: ViewportTransform,
  bounds: { left: number; top: number; width: number; height: number },
  nextZoom: number,
  previous: ViewportPoint,
  next: ViewportPoint = previous,
  maxZoom = 6,
): ViewportTransform {
  if (![current.zoom, current.pan.x, current.pan.y].every(valid) || current.zoom < 1) return FIT_VIEW;
  // An old pointer event during resize must not reset the whole user's view.
  if (![bounds.left, bounds.top, bounds.width, bounds.height, previous.x, previous.y, next.x, next.y, nextZoom].every(valid)
      || bounds.width <= 0 || bounds.height <= 0) return current;
  const ceiling = valid(maxZoom) && maxZoom >= 1 ? maxZoom : 6;
  const zoom = Math.max(1, Math.min(ceiling, nextZoom));
  if (zoom === 1) return FIT_VIEW;
  const ratio = zoom / current.zoom;
  const centerX = bounds.width / 2 + bounds.left;
  const centerY = bounds.height / 2 + bounds.top;
  // At 200% zoom, a centred photo can pan only half the viewport width.
  // The old size*zoom/2 boundary let the image slide completely out of view.
  const limit = (value: number, size: number) => {
    const extent = Math.max(0, (zoom - 1) * size / 2);
    return Math.max(-extent, Math.min(extent, value));
  };
  return {
    zoom,
    pan: {
      x: limit(next.x - centerX - (previous.x - centerX - current.pan.x) * ratio, bounds.width),
      y: limit(next.y - centerY - (previous.y - centerY - current.pan.y) * ratio, bounds.height),
    },
  };
}
