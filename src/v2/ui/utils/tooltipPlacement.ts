/**
 * Where an info tooltip goes, in viewport pixels. The tooltip is drawn in the workspace root with fixed positioning, so
 * a panel's clipped or scrolling edge can never hide part of it. Centred on the button, kept inside the window with a
 * margin, above the button unless there is not room, then below.
 */
export interface AnchorRect { left: number; right: number; top: number; bottom: number }
export interface TooltipPlacement { left: number; top?: number; bottom?: number; width: number; below: boolean }

export function tooltipPlacement(anchor: AnchorRect, viewport: { width: number; height: number }, opts: { width?: number; gap?: number; margin?: number; roomAbove?: number } = {}): TooltipPlacement {
  const margin = opts.margin ?? 8;
  const gap = opts.gap ?? 8;
  const width = Math.max(0, Math.min(opts.width ?? 240, viewport.width - margin * 2));
  const centre = (anchor.left + anchor.right) / 2;
  const left = Math.round(Math.min(Math.max(centre - width / 2, margin), Math.max(margin, viewport.width - margin - width)));
  const below = anchor.top < (opts.roomAbove ?? 140);
  return below
    ? { left, top: Math.round(anchor.bottom + gap), width, below }
    : { left, bottom: Math.round(viewport.height - anchor.top + gap), width, below };
}
