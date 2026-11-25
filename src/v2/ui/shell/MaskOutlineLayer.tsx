import React from 'react';
import { dragOutlineHandle, maskOutline, nudgeOutlineHandle, type OutlineGeometry, type OutlineHandleId } from '../../../core/maskOutline';
import type { MaskGeometry, MaskGeometryField } from '../contract';
import { STRINGS } from '../strings';

interface Props {
  /** The displayed picture's own pixel size; this layer is drawn inside an SVG whose viewBox is that size. */
  picture: { width: number; height: number };
  name: string;
  geometry: MaskGeometry;
  /** Edge softness, 0 to 100, as the panel shows it. */
  feather: number;
  onChange: (field: MaskGeometryField, value: number) => void;
}

const ARROWS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
};

/**
 * The selected oval or gradient, drawn on the canvas where the renderer applies it (src/core/maskOutline.ts):
 * a solid edge where the effect ends, a dashed edge where it is at full strength, and handles to drag or move with the arrow keys.
 * White lines on a dark halo read on any photograph; no meaning is carried by colour alone.
 */
export default function MaskOutlineLayer({ picture, name, geometry, feather, onChange }: Props) {
  const { width, height } = picture;
  const group = React.useRef<SVGGElement | null>(null);
  const dragging = React.useRef<OutlineHandleId | null>(null);
  // Screen pixels per picture pixel, so handles keep a usable on-screen size at every zoom.
  const [screenScale, setScreenScale] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const ctm = group.current?.ownerSVGElement?.getScreenCTM();
    const scale = ctm ? Math.hypot(ctm.a, ctm.b) : 0;
    if (scale > 0 && (!screenScale || Math.abs(scale - screenScale) / screenScale > 0.05)) setScreenScale(scale);
  });
  const shape: OutlineGeometry = geometry;
  const outline = maskOutline(shape, feather / 100, width, height);
  if (!outline) return null;
  const unit = screenScale ? 1 / screenScale : Math.max(width, height) / 600;

  const apply = (patch: ReturnType<typeof dragOutlineHandle>) => {
    for (const [field, value] of Object.entries(patch) as Array<[MaskGeometryField, number]>) onChange(field, value);
  };
  const toPicture = (event: React.PointerEvent): { x: number; y: number } | null => {
    const svg = group.current?.ownerSVGElement;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const local = point.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  };
  const handleLabel = (id: OutlineHandleId) => id === 'centre' ? STRINGS.maskCanvas.moveCentre(name)
    : id === 'width' ? STRINGS.maskCanvas.resizeWidth(name)
      : id === 'height' ? STRINGS.maskCanvas.resizeHeight(name)
        : id === 'start' ? STRINGS.maskCanvas.moveStart(name) : STRINGS.maskCanvas.moveEnd(name);

  const stroke = (dashed: boolean) => ({
    fill: 'none', vectorEffect: 'non-scaling-stroke' as const, strokeDasharray: dashed ? '6 5' : undefined,
  });
  const haloed = (element: (props: React.SVGProps<SVGElement>) => React.ReactElement, dashed = false, key?: string) => (
    <g key={key}>
      {element({ ...stroke(false), stroke: 'rgba(0,0,0,0.65)', strokeWidth: 4 } as React.SVGProps<SVGElement>)}
      {element({ ...stroke(dashed), stroke: '#ffffff', strokeWidth: 1.75 } as React.SVGProps<SVGElement>)}
    </g>
  );

  return (
    <g ref={group} data-testid="mask-outline" data-kind={outline.kind} role="group" aria-label={STRINGS.maskCanvas.outline(name)}>
      {outline.kind === 'radial' ? (
        <g transform={`rotate(${outline.angle} ${outline.cx} ${outline.cy})`}>
          {haloed(p => <ellipse cx={outline.cx} cy={outline.cy} rx={outline.rx} ry={outline.ry} {...(p as React.SVGProps<SVGEllipseElement>)} />)}
          {outline.innerRx > 0.5 && haloed(p => <ellipse cx={outline.cx} cy={outline.cy} rx={outline.innerRx} ry={outline.innerRy} {...(p as React.SVGProps<SVGEllipseElement>)} />, true)}
        </g>
      ) : (
        <>
          {outline.lines.map(line => (
            <g key={line.role} data-line={line.role}>
              {haloed(p => <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} {...(p as React.SVGProps<SVGLineElement>)} />, line.role !== 'none')}
            </g>
          ))}
          {haloed(p => <line x1={outline.spine.x1} y1={outline.spine.y1} x2={outline.spine.x2} y2={outline.spine.y2} {...(p as React.SVGProps<SVGLineElement>)} />, true)}
        </>
      )}
      {outline.handles.map(handle => (
        <g
          key={handle.id}
          role="button"
          tabIndex={0}
          aria-label={handleLabel(handle.id)}
          data-handle={handle.id}
          className="cursor-grab outline-none focus-visible:[&>circle:last-child]:stroke-[3px]"
          style={{ pointerEvents: 'all', touchAction: 'none' }}
          onPointerDown={(event) => {
            // The handle owns this drag: the frame must not start moving the format or the crop.
            event.stopPropagation();
            event.preventDefault();
            (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
            dragging.current = handle.id;
            (event.currentTarget as SVGGElement).focus();
          }}
          onPointerMove={(event) => {
            if (dragging.current !== handle.id) return;
            event.stopPropagation();
            const point = toPicture(event);
            if (point) apply(dragOutlineHandle(shape, handle.id, point, width, height));
          }}
          onPointerUp={(event) => { event.stopPropagation(); dragging.current = null; }}
          onPointerCancel={() => { dragging.current = null; }}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            const direction = ARROWS[event.key];
            if (!direction) return;
            event.preventDefault();
            event.stopPropagation();
            apply(nudgeOutlineHandle(shape, handle.id, direction, event.shiftKey, width, height));
          }}
        >
          {/* A larger invisible target for touch and imprecise pointers. */}
          <circle cx={handle.x} cy={handle.y} r={unit * 16} fill="transparent" />
          <circle cx={handle.x} cy={handle.y} r={unit * 7} fill="rgba(0,0,0,0.55)" stroke="#ffffff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          {handle.id === 'centre' && <circle cx={handle.x} cy={handle.y} r={unit * 2} fill="#ffffff" />}
          {handle.id === 'end' && <circle cx={handle.x} cy={handle.y} r={unit * 3} fill="none" stroke="#ffffff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
        </g>
      ))}
    </g>
  );
}
