import React from 'react';
import type { TapPoint, TapSelectState } from '../contract';
import { STRINGS } from '../strings';

interface Props {
  /** The displayed picture's own pixel size (the SVG viewBox). */
  picture: { width: number; height: number };
  session: NonNullable<TapSelectState['session']>;
  onTap: (tap: TapPoint) => void;
}

/**
 * Tap-to-select on the canvas: a click or tap adds a part (Alt, or Remove mode, takes one away). Taps are given as
 * shares of the framed photo. Each tap is marked with a plus or minus glyph on a dark halo, never by colour alone.
 */
export default function TapSelectLayer({ picture, session, onTap }: Props) {
  const { width, height } = picture;
  const rect = React.useRef<SVGRectElement | null>(null);
  const [unit, setUnit] = React.useState(Math.max(width, height) / 600);
  React.useLayoutEffect(() => {
    const ctm = rect.current?.ownerSVGElement?.getScreenCTM();
    const scale = ctm ? Math.hypot(ctm.a, ctm.b) : 0;
    if (scale > 0 && Math.abs(1 / scale - unit) / unit > 0.05) setUnit(1 / scale);
  });
  const busy = session.phase !== 'ready';
  return (
    <g data-testid="tap-select-layer" data-phase={session.phase}>
      <rect
        ref={rect}
        x={0} y={0} width={width} height={height} fill="transparent"
        role="button" aria-label={STRINGS.tapSelect.tapLayer} aria-disabled={busy}
        style={{ pointerEvents: 'all', cursor: busy ? 'progress' : 'crosshair', touchAction: 'none' }}
        onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); }}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (busy) return;
          const svg = rect.current?.ownerSVGElement;
          const ctm = svg?.getScreenCTM();
          if (!svg || !ctm) return;
          const point = svg.createSVGPoint();
          point.x = event.clientX; point.y = event.clientY;
          const local = point.matrixTransform(ctm.inverse());
          if (local.x < 0 || local.y < 0 || local.x > width || local.y > height) return;
          onTap({ x: local.x / width, y: local.y / height, add: !event.altKey && session.mode === 'add' });
        }}
      />
      {session.subjects.flatMap((subject, index) => subject.taps.map((tap, at) => {
        const x = tap.x * width;
        const y = tap.y * height;
        const r = unit * 8;
        return (
          <g key={`${index}-${at}`} aria-hidden="true" style={{ pointerEvents: 'none' }} opacity={index === session.active ? 1 : 0.6}>
            <circle cx={x} cy={y} r={r} fill="rgba(0,0,0,0.6)" stroke="#ffffff" strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
            <line x1={x - r * 0.5} y1={y} x2={x + r * 0.5} y2={y} stroke="#ffffff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            {tap.add && <line x1={x} y1={y - r * 0.5} x2={x} y2={y + r * 0.5} stroke="#ffffff" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
          </g>
        );
      }))}
    </g>
  );
}
