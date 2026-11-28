/**
 * Pure helpers for the mask brush on the V2 canvas (src/v2/ui/shell/BrushLayer.tsx). Points are 0 to 1 across the framed
 * photo; `aspect` is its height divided by its width, so distances are measured in widths of the photo, the unit the
 * brush radius uses (src/core/maskTypes.ts BrushStroke).
 */

/** Points closer than this (in widths of the photo) are skipped, which keeps a slow stroke from storing thousands of points. */
export const MIN_POINT_SPACING = 0.003;
/** The most coordinates (x, y flattened) one live stroke collects; the engine keeps the same cap. */
export const MAX_LIVE_VALUES = 3000;

/** Brush size runs 1 to 100 in the panel; the radius it gives is in widths of the photo. */
export const BRUSH_SIZE_MIN = 1;
export const BRUSH_SIZE_MAX = 100;
export const DEFAULT_BRUSH_SIZE = 20;
/** How much [ and ] change the size. */
export const BRUSH_SIZE_STEP = 5;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** The radius for a panel size: 1 is a fine 0.4% of the photo's width, 100 is a broad 20%. */
export function brushRadius(size: number): number {
  const s = Math.min(BRUSH_SIZE_MAX, Math.max(BRUSH_SIZE_MIN, Math.round(Number.isFinite(size) ? size : DEFAULT_BRUSH_SIZE)));
  return Math.round((0.004 + (s - 1) / (BRUSH_SIZE_MAX - 1) * 0.196) * 10000) / 10000;
}

/** The size after pressing [ (step -1) or ] (step +1), held inside the slider's range. */
export function stepBrushSize(size: number, step: 1 | -1): number {
  return Math.min(BRUSH_SIZE_MAX, Math.max(BRUSH_SIZE_MIN, Math.round(size) + step * BRUSH_SIZE_STEP));
}

/**
 * Add the points of one pointer move (several when the browser coalesced them) to a live stroke. Each point is clamped to
 * the photo, points nearer than MIN_POINT_SPACING to the last kept point are skipped, and the stroke stops growing at
 * MAX_LIVE_VALUES. Returns the same array when nothing was added, so a caller can skip a redraw.
 */
export function appendStrokePoints(live: readonly number[], next: ReadonlyArray<{ x: number; y: number }>, aspect: number): readonly number[] {
  let out: number[] | null = null;
  let lastX = live[live.length - 2], lastY = live[live.length - 1];
  for (const point of next) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const x = clamp01(point.x), y = clamp01(point.y);
    if ((out ?? live).length >= MAX_LIVE_VALUES) break;
    if (lastX !== undefined && Math.hypot(x - lastX, (y - lastY) * aspect) < MIN_POINT_SPACING) continue;
    out ??= [...live];
    out.push(x, y);
    lastX = x; lastY = y;
  }
  return out ?? live;
}

/** Where the keyboard brush moves for an arrow key: 1% of the photo per press, 5% with Shift. Null for any other key. */
export function nudgeBrushCursor(at: { x: number; y: number }, key: string, shift: boolean): { x: number; y: number } | null {
  const step = shift ? 0.05 : 0.01;
  const delta = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[key];
  return delta ? { x: clamp01(at.x + delta[0]), y: clamp01(at.y + delta[1]) } : null;
}

/** True when a key press was typed into a field, so the brush's [ and ] must leave it alone. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean; type?: string } | null;
  if (!element || typeof element.tagName !== 'string') return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((element.type ?? 'text').toLowerCase());
}
