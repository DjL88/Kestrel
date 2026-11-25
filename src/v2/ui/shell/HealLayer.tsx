import React from 'react';
import type { HealSpotView } from '../contract';
import { healText as T } from '../../../i18n/areas/heal';

export interface HealCanvasState {
  spots: HealSpotView[];
  selectedId: string | null;
  /** While placing, a click or tap on the picture adds a spot there. */
  placing: boolean;
  /** Radius for the next spot, a share of the long edge, for the pointer preview. */
  newRadius: number;
  onPlace: (at: { x: number; y: number }) => void;
  onSelect: (spotId: string) => void;
  onMoveSource: (spotId: string, source: { sx: number; sy: number }) => void;
}

interface Props extends HealCanvasState {
  /** The displayed picture's own pixel size; drawn inside an SVG whose viewBox is that size. */
  picture: { width: number; height: number };
}

const ARROWS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
};

/**
 * Spot-healing circles on the photo: a solid circle for each covered spot, and for the selected one a dashed circle where
 * it copies from, joined by a line, which can be dragged or moved with the arrow keys. White on a dark halo, so it reads
 * on any photograph, and shape (solid or dashed), not colour, says which is which.
 */
export default function HealLayer({ picture, spots, selectedId, placing, newRadius, onPlace, onSelect, onMoveSource }: Props) {
  const { width, height } = picture;
  const edge = Math.max(width, height);
  const group = React.useRef<SVGGElement | null>(null);
  const [drag, setDrag] = React.useState<{ id: string; sx: number; sy: number } | null>(null);
  const [hover, setHover] = React.useState<{ x: number; y: number } | null>(null);
  const toPicture = (event: React.PointerEvent | React.MouseEvent): { x: number; y: number } | null => {
    const svg = group.current?.ownerSVGElement;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const local = point.matrixTransform(ctm.inverse());
    return { x: local.x / width, y: local.y / height };
  };
  const haloed = (key: string, draw: (props: React.SVGProps<SVGElement>) => React.ReactElement, dashed = false) => (
    <g key={key}>
      {draw({ fill: 'none', stroke: 'rgba(0,0,0,0.65)', strokeWidth: 4, vectorEffect: 'non-scaling-stroke' } as React.SVGProps<SVGElement>)}
      {draw({ fill: 'none', stroke: '#ffffff', strokeWidth: 1.75, vectorEffect: 'non-scaling-stroke', strokeDasharray: dashed ? '6 5' : undefined } as React.SVGProps<SVGElement>)}
    </g>
  );
  const unit = (x: number) => x * width, vunit = (y: number) => y * height;

  return (
    <g ref={group} data-testid="heal-layer" role="group" aria-label={T.layer}>
      {placing && (
        <rect data-testid="heal-place-layer" x={0} y={0} width={width} height={height} fill="transparent"
          style={{ pointerEvents: 'all', cursor: 'crosshair' }}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerMove={(event) => setHover(toPicture(event))}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            const at = toPicture(event);
            if (at && at.x >= 0 && at.x <= 1 && at.y >= 0 && at.y <= 1) onPlace(at);
          }} />
      )}
      {placing && hover && haloed('hover', (p) => <circle cx={unit(hover.x)} cy={vunit(hover.y)} r={newRadius * edge} {...(p as React.SVGProps<SVGCircleElement>)} />, true)}
      {spots.map((spot, index) => {
        const selected = spot.id === selectedId;
        const source = drag?.id === spot.id ? drag : spot;
        const r = spot.r * edge;
        return (
          <g key={spot.id} data-heal-spot={spot.id} data-selected={selected ? 'true' : undefined} opacity={spot.visible ? 1 : 0.5}>
            {selected && haloed('link', (p) => <line x1={unit(spot.x)} y1={vunit(spot.y)} x2={unit(source.sx)} y2={vunit(source.sy)} {...(p as React.SVGProps<SVGLineElement>)} />, true)}
            {haloed('spot', (p) => <circle cx={unit(spot.x)} cy={vunit(spot.y)} r={r} {...(p as React.SVGProps<SVGCircleElement>)} />)}
            {!placing && (
              <circle cx={unit(spot.x)} cy={vunit(spot.y)} r={Math.max(r, edge * 0.01)} fill="transparent" role="button" tabIndex={0}
                aria-label={T.select(index + 1)} aria-pressed={selected} style={{ pointerEvents: 'all', cursor: 'pointer' }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); onSelect(spot.id); }}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(spot.id); } }} />
            )}
            {selected && !placing && (
              <g role="button" tabIndex={0} aria-label={T.source(index + 1)} data-testid="heal-source-handle" className="cursor-grab outline-none"
                style={{ pointerEvents: 'all', touchAction: 'none' }}
                onPointerDown={(event) => {
                  event.stopPropagation(); event.preventDefault();
                  (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
                  setDrag({ id: spot.id, sx: spot.sx, sy: spot.sy });
                }}
                onPointerMove={(event) => {
                  if (drag?.id !== spot.id) return;
                  event.stopPropagation();
                  const at = toPicture(event);
                  if (at) setDrag({ id: spot.id, sx: Math.min(1, Math.max(0, at.x)), sy: Math.min(1, Math.max(0, at.y)) });
                }}
                onPointerUp={(event) => {
                  event.stopPropagation();
                  // One recipe change when the drag ends, so the photo is redrawn once, not on every pointer move.
                  if (drag?.id === spot.id && (drag.sx !== spot.sx || drag.sy !== spot.sy)) onMoveSource(spot.id, { sx: drag.sx, sy: drag.sy });
                  setDrag(null);
                }}
                onPointerCancel={() => setDrag(null)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  const direction = ARROWS[event.key];
                  if (!direction) return;
                  event.preventDefault(); event.stopPropagation();
                  const step = (event.shiftKey ? 10 : 2) / edge;
                  onMoveSource(spot.id, {
                    sx: Math.min(1, Math.max(0, spot.sx + direction.x * step * edge / width)),
                    sy: Math.min(1, Math.max(0, spot.sy + direction.y * step * edge / height)),
                  });
                }}>
                <circle cx={unit(source.sx)} cy={vunit(source.sy)} r={Math.max(r, edge * 0.012)} fill="transparent" />
                {haloed('source', (p) => <circle cx={unit(source.sx)} cy={vunit(source.sy)} r={r} {...(p as React.SVGProps<SVGCircleElement>)} />, true)}
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
