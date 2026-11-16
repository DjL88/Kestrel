export interface ViewportPoint { x: number; y: number }

export interface ViewportTransform {
  zoom: number;
  pan: ViewportPoint;
}

export const FIT_VIEW: ViewportTransform = { zoom: 1, pan: { x: 0, y: 0 } };

export function transformViewport(
  current: ViewportTransform,
  bounds: { left: number; top: number; width: number; height: number },
  nextZoom: number,
  previous: ViewportPoint,
  next: ViewportPoint = previous,
  maxZoom = 6,
): ViewportTransform {
  const zoom = Math.max(1, Math.min(maxZoom, nextZoom));
  if (zoom === 1) return FIT_VIEW;
  const ratio = zoom / current.zoom;
  const centerX = bounds.width / 2 + bounds.left;
  const centerY = bounds.height / 2 + bounds.top;
  const limit = (value: number, size: number) => Math.max(-size * zoom / 2, Math.min(size * zoom / 2, value));
  return {
    zoom,
    pan: {
      x: limit(next.x - centerX - (previous.x - centerX - current.pan.x) * ratio, bounds.width),
      y: limit(next.y - centerY - (previous.y - centerY - current.pan.y) * ratio, bounds.height),
    },
  };
}
