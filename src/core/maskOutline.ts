/**
 * On-canvas outlines and handles for the shape masks (oval and gradient), in the displayed picture's own pixels.
 *
 * The maths mirrors `maskAlpha` in masks.ts exactly, so the outline is where the renderer's weights change:
 * - Oval: centre (cx·W, cy·H); both radii are in photo-width units (rx·W, ry·W); rotated `angle` degrees clockwise.
 *   Full strength inside the inner ellipse (scale 1 − feather), none outside the outer one.
 * - Gradient: projection t of a pixel onto start→end. Full strength before t = low, none after t = high, half at t = 0.5,
 *   where the band width is 0.05 + 0.95·feather (the same constants as the renderer).
 */

export type OutlineGeometry =
  | { kind: 'radial'; cx: number; cy: number; rx: number; ry: number; angle: number }
  | { kind: 'linear'; x1: number; y1: number; x2: number; y2: number };

export type OutlineHandleId = 'centre' | 'width' | 'height' | 'start' | 'end';

export interface OutlinePoint { x: number; y: number }

export interface OutlineHandle extends OutlinePoint { id: OutlineHandleId }

export interface OutlineLine { role: 'full' | 'half' | 'none'; x1: number; y1: number; x2: number; y2: number }

export type MaskOutline =
  | {
    kind: 'radial'; cx: number; cy: number; rx: number; ry: number; innerRx: number; innerRy: number; angle: number;
    handles: OutlineHandle[];
  }
  | { kind: 'linear'; lines: OutlineLine[]; spine: { x1: number; y1: number; x2: number; y2: number }; handles: OutlineHandle[] };

/** The renderer's gradient band, from the mask's 0 to 1 feather. */
export function gradientBand(feather: number): { low: number; high: number } {
  const f = Number.isFinite(feather) ? Math.max(0, Math.min(1, feather)) : 0;
  const width = 0.05 + 0.95 * f;
  return { low: 0.5 - width / 2, high: 0.5 + width / 2 };
}

/** The outline of a shape mask drawn over a picture `width` × `height` pixels, or null when it cannot be drawn honestly. */
export function maskOutline(geometry: OutlineGeometry, feather: number, width: number, height: number): MaskOutline | null {
  if (!(width > 0) || !(height > 0)) return null;
  const f = Number.isFinite(feather) ? Math.max(0, Math.min(1, feather)) : 0;
  if (geometry.kind === 'radial') {
    const { cx, cy, rx, ry, angle } = geometry;
    if (![cx, cy, rx, ry, angle].every(Number.isFinite) || rx <= 0 || ry <= 0) return null;
    const centre = { x: cx * width, y: cy * height };
    const rad = (angle * Math.PI) / 180;
    const along = { x: Math.cos(rad), y: Math.sin(rad) };
    const across = { x: -Math.sin(rad), y: Math.cos(rad) };
    const outerX = rx * width;
    const outerY = ry * width;
    const inner = Math.min(0.999, 1 - f);
    return {
      kind: 'radial', cx: centre.x, cy: centre.y, rx: outerX, ry: outerY, innerRx: outerX * inner, innerRy: outerY * inner, angle,
      handles: [
        { id: 'centre', ...centre },
        { id: 'width', x: centre.x + along.x * outerX, y: centre.y + along.y * outerX },
        { id: 'height', x: centre.x + across.x * outerY, y: centre.y + across.y * outerY },
      ],
    };
  }
  const { x1, y1, x2, y2 } = geometry;
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const start = { x: x1 * width, y: y1 * height };
  const end = { x: x2 * width, y: y2 * height };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  // A collapsed gradient has no direction; never draw it as if it covered something.
  if (length < 1e-6) return null;
  const normal = { x: -dy / length, y: dx / length };
  const reach = Math.hypot(width, height) * 2;
  const { low, high } = gradientBand(f);
  const lineAt = (t: number, role: OutlineLine['role']): OutlineLine => {
    const px = start.x + dx * t;
    const py = start.y + dy * t;
    return { role, x1: px - normal.x * reach, y1: py - normal.y * reach, x2: px + normal.x * reach, y2: py + normal.y * reach };
  };
  return {
    kind: 'linear',
    lines: [lineAt(low, 'full'), lineAt(0.5, 'half'), lineAt(high, 'none')],
    spine: { x1: start.x, y1: start.y, x2: end.x, y2: end.y },
    handles: [{ id: 'start', ...start }, { id: 'end', ...end }],
  };
}

export type GeometryPatch = Partial<Record<'cx' | 'cy' | 'rx' | 'ry' | 'angle' | 'x1' | 'y1' | 'x2' | 'y2', number>>;

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/**
 * The shape change for dragging `handle` to `point` (picture pixels). Values use the same bounds as the panel sliders:
 * positions 0 to 1, radii 0.01 to 1, angle −180 to 180. A drag that would collapse a gradient returns no change.
 */
export function dragOutlineHandle(
  geometry: OutlineGeometry, handle: OutlineHandleId, point: OutlinePoint, width: number, height: number,
): GeometryPatch {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return {};
  const nx = clamp(point.x / width, 0, 1);
  const ny = clamp(point.y / height, 0, 1);
  if (geometry.kind === 'radial') {
    if (handle === 'centre') return { cx: round3(nx), cy: round3(ny) };
    const ox = point.x - geometry.cx * width;
    const oy = point.y - geometry.cy * height;
    if (handle === 'width') {
      const distance = Math.hypot(ox, oy);
      if (distance < 1e-6) return {};
      return { rx: round3(clamp(distance / width, 0.01, 1)), angle: Math.round((Math.atan2(oy, ox) * 180) / Math.PI) };
    }
    if (handle === 'height') {
      // Only the part of the drag across the oval's own axis changes its height, so the angle never jumps.
      const rad = (geometry.angle * Math.PI) / 180;
      const across = -ox * Math.sin(rad) + oy * Math.cos(rad);
      return { ry: round3(clamp(Math.abs(across) / width, 0.01, 1)) };
    }
    return {};
  }
  if (handle !== 'start' && handle !== 'end') return {};
  const x = round3(nx);
  const y = round3(ny);
  const other = handle === 'start' ? { x: geometry.x2, y: geometry.y2 } : { x: geometry.x1, y: geometry.y1 };
  if (x === other.x && y === other.y) return {};
  return handle === 'start' ? { x1: x, y1: y } : { x2: x, y2: y };
}

/** Arrow-key nudges: one step is 1% of the picture's width or height (Shift: 5%). */
export function nudgeOutlineHandle(
  geometry: OutlineGeometry, handle: OutlineHandleId, direction: { x: number; y: number }, large: boolean, width: number, height: number,
): GeometryPatch {
  const outline = maskOutline(geometry, 0, width, height);
  const at = outline?.handles.find(candidate => candidate.id === handle);
  if (!at) return {};
  const step = large ? 0.05 : 0.01;
  return dragOutlineHandle(geometry, handle, { x: at.x + direction.x * step * width, y: at.y + direction.y * step * height }, width, height);
}
