import React from 'react';
import { brushText as T } from '../../../i18n/areas/brush';
import { appendStrokePoints, isTypingTarget, nudgeBrushCursor } from '../utils/brushStroke';
import { mayPaintPointer, stylusIsInContact } from '../utils/stylusInput';

export interface BrushCanvasState {
  /** The mask being painted, by its name in the Masks list. */
  name: string;
  /** Erase mode (the Eraser tool). Holding Alt swaps it for as long as it is held. */
  erase: boolean;
  /** Radius in widths of the framed photo. */
  radius: number;
  /** One finished stroke: x, y pairs 0 to 1 across the framed photo. */
  onStroke: (points: number[], erase: boolean) => void;
  /** [ makes the brush smaller, ] larger. */
  onResize: (step: 1 | -1) => void;
}

interface Props extends BrushCanvasState {
  /** The displayed picture's own pixel size; drawn inside an SVG whose viewBox is that size (as HealLayer and MaskOutlineLayer). */
  picture: { width: number; height: number };
}

type CoalescingEvent = PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };

/**
 * Paints the open brush, subject or background mask on the photo. Drag to paint, hold Alt to erase for a moment, [ and ]
 * change the size. The ring shows the brush: solid to paint, dashed to erase, so the mode never depends on colour. White on a
 * dark halo reads on any photograph. With the keyboard the arrow keys move the brush and Space or Enter paints a dab.
 * Once a pen has touched this layer, fingers no longer paint (they pan and zoom as usual), so a resting palm leaves no mark.
 */
export default function BrushLayer({ picture, name, erase, radius, onStroke, onResize }: Props) {
  const { width, height } = picture;
  const aspect = height / Math.max(1, width);
  const group = React.useRef<SVGGElement | null>(null);
  const live = React.useRef<{ pointerId: number; points: readonly number[]; erase: boolean } | null>(null);
  const [drawn, setDrawn] = React.useState<{ points: readonly number[]; erase: boolean } | null>(null);
  const [hover, setHover] = React.useState<{ x: number; y: number } | null>(null);
  const [keyboard, setKeyboard] = React.useState<{ x: number; y: number } | null>(null);
  const [altHeld, setAltHeld] = React.useState(false);
  const penSeen = React.useRef(false);
  const penDown = React.useRef(false);
  const resize = React.useRef(onResize);
  resize.current = onResize;
  const commit = React.useRef(onStroke);
  commit.current = onStroke;

  // [ and ] resize, and Alt shows the erase ring, wherever focus is (but never while typing in a field).
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      setAltHeld(event.altKey);
      if (event.type !== 'keydown' || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return;
      if (event.key === '[' || event.key === ']') {
        event.preventDefault();
        resize.current(event.key === ']' ? 1 : -1);
      }
    };
    const onBlur = () => setAltHeld(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const matrix = () => group.current?.ownerSVGElement?.getScreenCTM()?.inverse() ?? null;
  const toPhoto = (inverse: DOMMatrix, clientX: number, clientY: number) => {
    const svg = group.current!.ownerSVGElement!;
    const point = svg.createSVGPoint();
    point.x = clientX; point.y = clientY;
    const local = point.matrixTransform(inverse);
    return { x: local.x / width, y: local.y / height };
  };
  const finish = (keep: boolean) => {
    const stroke = live.current;
    live.current = null;
    setDrawn(null);
    if (keep && stroke && stroke.points.length >= 2) commit.current([...stroke.points], stroke.erase);
  };
  // Leaving the photo or switching masks mid-stroke keeps what was drawn so far, like lifting the pen.
  React.useEffect(() => () => {
    const stroke = live.current;
    live.current = null;
    if (stroke && stroke.points.length >= 2) commit.current([...stroke.points], stroke.erase);
  }, []);

  const erasing = (alt: boolean) => erase !== alt;
  const ringErases = erasing(altHeld);
  const haloed = (key: string, draw: (props: React.SVGProps<SVGElement>) => React.ReactElement, dashed: boolean) => (
    <g key={key}>
      {draw({ fill: 'none', stroke: 'rgba(0,0,0,0.65)', strokeWidth: 4, vectorEffect: 'non-scaling-stroke' } as React.SVGProps<SVGElement>)}
      {draw({ fill: 'none', stroke: '#ffffff', strokeWidth: 1.75, vectorEffect: 'non-scaling-stroke', strokeDasharray: dashed ? '6 5' : undefined } as React.SVGProps<SVGElement>)}
    </g>
  );
  const r = radius * width;
  const ringAt = hover ?? keyboard;
  const path = drawn && drawn.points.length >= 2
    ? drawn.points.reduce<string[]>((parts, value, index) => (index % 2 ? parts : [...parts, `${value * width},${drawn.points[index + 1] * height}`]), []).join(' ')
    : '';
  const label = T.layer(name);

  return (
    <g ref={group} data-testid="brush-layer" data-mode={ringErases ? 'erase' : 'paint'} role="application" aria-label={label}
      aria-roledescription={T.mode} tabIndex={0} className="outline-none"
      onFocus={() => setKeyboard((at) => at ?? { x: 0.5, y: 0.5 })}
      onBlur={() => setKeyboard(null)}
      onKeyDown={(event) => {
        const at = keyboard ?? { x: 0.5, y: 0.5 };
        const moved = nudgeBrushCursor(at, event.key, event.shiftKey);
        if (moved) { event.preventDefault(); event.stopPropagation(); setKeyboard(moved); return; }
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault(); event.stopPropagation();
          commit.current([at.x, at.y], erasing(event.altKey));
        }
      }}>
      <desc>{T.help}</desc>
      {/* Catches the pointer over the whole picture while the brush is on. */}
      <rect data-testid="brush-paint-layer" x={0} y={0} width={width} height={height} fill="transparent"
        style={{ pointerEvents: 'all', cursor: 'crosshair', touchAction: 'none' }}
        onPointerDown={(event) => {
          if (event.pointerType === 'pen') { penSeen.current = true; penDown.current = true; }
          const native = event.nativeEvent;
          if (!event.isPrimary || native.button > 0 || !mayPaintPointer(native, penDown.current, !penSeen.current)) return;
          event.stopPropagation(); event.preventDefault();
          (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
          const inverse = matrix();
          if (!inverse) return;
          const points = appendStrokePoints([], [toPhoto(inverse, event.clientX, event.clientY)], aspect);
          live.current = { pointerId: event.pointerId, points, erase: erasing(event.altKey) };
          setDrawn({ points, erase: live.current.erase });
        }}
        onPointerMove={(event) => {
          const inverse = matrix();
          if (!inverse) return;
          setHover(toPhoto(inverse, event.clientX, event.clientY));
          setAltHeld(event.altKey);
          const stroke = live.current;
          if (!stroke || stroke.pointerId !== event.pointerId || !stylusIsInContact(event.nativeEvent)) return;
          event.stopPropagation();
          const native = event.nativeEvent as CoalescingEvent;
          const samples = native.getCoalescedEvents?.() ?? [];
          const moves = (samples.length ? samples : [native]).map((sample) => toPhoto(inverse, sample.clientX, sample.clientY));
          const points = appendStrokePoints(stroke.points, moves, aspect);
          if (points === stroke.points) return;
          live.current = { ...stroke, points };
          setDrawn({ points, erase: stroke.erase });
        }}
        onPointerUp={(event) => {
          if (event.pointerType === 'pen') penDown.current = false;
          if (live.current?.pointerId !== event.pointerId) return;
          event.stopPropagation();
          finish(true);
        }}
        onPointerCancel={(event) => {
          if (event.pointerType === 'pen') penDown.current = false;
          if (live.current?.pointerId === event.pointerId) finish(false);
        }}
        onPointerLeave={(event) => { if (!live.current && event.pointerType !== 'touch') setHover(null); }}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()} />
      {drawn && path && (
        <g data-testid="brush-live-stroke" data-erase={drawn.erase ? 'true' : undefined} style={{ pointerEvents: 'none' }}>
          <polyline points={path} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth={r * 2 + 2} strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={path} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={r * 2} strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray={drawn.erase ? `${Math.max(2, r)} ${Math.max(2, r)}` : undefined} />
        </g>
      )}
      {ringAt && (
        <g data-testid="brush-ring" data-erase={ringErases ? 'true' : undefined} style={{ pointerEvents: 'none' }}>
          {haloed('ring', (p) => <circle cx={ringAt.x * width} cy={ringAt.y * height} r={r} {...(p as React.SVGProps<SVGCircleElement>)} />, ringErases)}
          {/* A minus sign in the middle while erasing, a plus while painting: the mode in shape as well as line style. */}
          {haloed('sign', (p) => <path d={`M ${ringAt.x * width - Math.min(r, 8)} ${ringAt.y * height} h ${Math.min(r, 8) * 2}${ringErases ? '' : ` M ${ringAt.x * width} ${ringAt.y * height - Math.min(r, 8)} v ${Math.min(r, 8) * 2}`}`} {...(p as React.SVGProps<SVGPathElement>)} />, false)}
        </g>
      )}
    </g>
  );
}
