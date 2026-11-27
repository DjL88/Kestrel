import React from 'react';

/**
 * The suggested crop, drawn on the picture: a dashed rectangle with a dark halo and four solid corner ticks, so it reads on
 * any photograph and the meaning is in the shape, never in colour alone. Drawn in the picture's own pixels, like the mask
 * outline, and never takes the pointer. The words and the Accept and Dismiss buttons live in the status line under the canvas.
 */
export default function CropSuggestionLayer({ picture, rect }: { picture: { width: number; height: number }; rect: { x0: number; y0: number; x1: number; y1: number } }) {
  const x = rect.x0 * picture.width, y = rect.y0 * picture.height;
  const w = (rect.x1 - rect.x0) * picture.width, h = (rect.y1 - rect.y0) * picture.height;
  const tick = Math.min(w, h) * 0.08;
  const corners = `M${x} ${y + tick}V${y}H${x + tick} M${x + w - tick} ${y}H${x + w}V${y + tick} M${x + w} ${y + h - tick}V${y + h}H${x + w - tick} M${x + tick} ${y + h}H${x}V${y + h - tick}`;
  const line = { fill: 'none', vectorEffect: 'non-scaling-stroke' as const };
  return (
    <g data-testid="crop-suggestion-outline" pointerEvents="none" aria-hidden="true">
      <rect x={x} y={y} width={w} height={h} stroke="rgba(0,0,0,0.65)" strokeWidth={4} {...line} />
      <rect x={x} y={y} width={w} height={h} stroke="#fff" strokeWidth={2} strokeDasharray="8 6" {...line} />
      <path d={corners} stroke="rgba(0,0,0,0.65)" strokeWidth={6} {...line} />
      <path d={corners} stroke="#fff" strokeWidth={3} {...line} />
    </g>
  );
}
