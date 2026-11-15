import type { PixelRect } from './photoFraming';
import type { ViewportTransform } from './viewportTransform';

export function visiblePhotoDetail(
  width: number, height: number, viewportWidth: number, viewportHeight: number, transform: ViewportTransform,
) {
  const fit = Math.min(viewportWidth / width, viewportHeight / height);
  if (!fit || transform.zoom <= 1) return null;
  const { zoom, pan } = transform;
  const left = (viewportWidth - width * fit) / 2;
  const top = (viewportHeight - height * fit) / 2;
  const projectedLeft = viewportWidth / 2 - width * fit * zoom / 2 + pan.x;
  const projectedTop = viewportHeight / 2 - height * fit * zoom / 2 + pan.y;
  const scale = fit * zoom;
  const x = Math.max(0, Math.floor(-projectedLeft / scale));
  const y = Math.max(0, Math.floor(-projectedTop / scale));
  const right = Math.min(width, Math.ceil((viewportWidth - projectedLeft) / scale));
  const bottom = Math.min(height, Math.ceil((viewportHeight - projectedTop) / scale));
  if (right <= x || bottom <= y) return null;
  const region: PixelRect = { x, y, width: right - x, height: bottom - y };
  return { region, scale, style: { left: left + x * fit, top: top + y * fit, width: region.width * fit, height: region.height * fit } };
}
