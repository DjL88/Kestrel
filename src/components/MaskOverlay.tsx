import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { maskAlpha } from '../core/masks';
import type { Mask } from '../core/maskTypes';

interface Props {
  mask: Mask;
  /** Height divided by width of the framed photo. */
  aspect: number;
  rect: CSSProperties;
  brushRadius: number;
  erase: boolean;
  onChange: (mask: Mask) => void;
}

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
// Sky blue marks the mask, with outlines and dashes so it never depends on colour alone.
const MARK = 'rgb(78,168,222)';

function Handle({ x, y, label, onMove }: { x: number; y: number; label: string; onMove: (point: { x: number; y: number }, relative: boolean) => void }) {
  const point = (event: PointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) / bounds.width), y: clamp((event.clientY - bounds.top) / bounds.height) };
  };
  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    onMove({ x: clamp(x + delta[0]), y: clamp(y + delta[1]) }, false);
  };
  return (
    <button type="button" aria-label={label} title={label}
      className="pointer-events-auto absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none place-items-center focus-visible:outline-none"
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
      onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) onMove(point(event), true); }}
      onKeyDown={key}>
      <span className="h-4 w-4 rounded-full border-2 border-white bg-[#4ea8de] shadow-[0_0_0_1.5px_#000] [button:focus-visible>&]:outline-2 [button:focus-visible>&]:outline-offset-2 [button:focus-visible>&]:outline-white" />
    </button>
  );
}

/** Direct editing of the selected mask on the photo. Geometry is in the framed photo's own 0 to 1 space. */
export function MaskOverlay({ mask, aspect, rect, brushRadius, erase, onChange }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 1, h: 1 });
  const [live, setLive] = useState<number[] | null>(null);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setBox({ w: Math.max(1, entry.contentRect.width), h: Math.max(1, entry.contentRect.height) }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = shade.current;
    if (!canvas) return;
    const width = 160;
    const height = Math.max(1, Math.round(width * aspect));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    const alpha = maskAlpha(mask, width, height, { aspect, view: { x: 0, y: 0, w: 1, h: 1 } });
    const image = context.createImageData(width, height);
    for (let i = 0; i < alpha.length; i += 1) {
      image.data[i * 4] = 78;
      image.data[i * 4 + 1] = 168;
      image.data[i * 4 + 2] = 222;
      image.data[i * 4 + 3] = Math.round(alpha[i] * 110);
    }
    context.putImageData(image, 0, 0);
  }, [mask, aspect]);

  const toNorm = (event: PointerEvent<HTMLElement>) => {
    const bounds = root.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) / bounds.width), y: clamp((event.clientY - bounds.top) / bounds.height) };
  };
  const { w, h } = box;
  let shapes: React.ReactNode = null;
  let handles: React.ReactNode = null;

  if (mask.kind === 'linear') {
    const [x1, y1, x2, y2] = [mask.x1 * w, mask.y1 * h, mask.x2 * w, mask.y2 * h];
    const length = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = -(y2 - y1) / length * 36;
    const ny = (x2 - x1) / length * 36;
    shapes = <>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#000" strokeWidth="4" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff" strokeWidth="2" />
      <line x1={x1 - nx} y1={y1 - ny} x2={x1 + nx} y2={y1 + ny} stroke="#fff" strokeWidth="3" />
      <line x1={x2 - nx} y1={y2 - ny} x2={x2 + nx} y2={y2 + ny} stroke="#fff" strokeWidth="3" strokeDasharray="6 5" />
    </>;
    handles = <>
      <Handle x={mask.x1} y={mask.y1} label="Gradient start, full effect. Arrow keys move it." onMove={(p) => onChange({ ...mask, x1: p.x, y1: p.y })} />
      <Handle x={mask.x2} y={mask.y2} label="Gradient end, no effect. Arrow keys move it." onMove={(p) => onChange({ ...mask, x2: p.x, y2: p.y })} />
    </>;
  } else if (mask.kind === 'radial') {
    shapes = <>
      <ellipse cx={mask.cx * w} cy={mask.cy * h} rx={mask.rx * w} ry={mask.ry * w} fill="none" stroke="#000" strokeWidth="4" />
      <ellipse cx={mask.cx * w} cy={mask.cy * h} rx={mask.rx * w} ry={mask.ry * w} fill="none" stroke="#fff" strokeWidth="2" />
    </>;
    handles = <>
      <Handle x={mask.cx} y={mask.cy} label="Move the oval. Arrow keys move it." onMove={(p) => onChange({ ...mask, cx: p.x, cy: p.y })} />
      <Handle x={clamp(mask.cx + mask.rx)} y={mask.cy} label="Oval width. Arrow keys resize it." onMove={(p) => onChange({ ...mask, rx: Math.max(0.01, Math.abs(p.x - mask.cx)) })} />
      <Handle x={mask.cx} y={clamp(mask.cy + mask.ry / aspect)} label="Oval height. Arrow keys resize it." onMove={(p) => onChange({ ...mask, ry: Math.max(0.01, Math.abs(p.y - mask.cy) * aspect) })} />
    </>;
  } else if (live && (mask.kind === 'brush' || mask.kind === 'subject')) {
    const points: string[] = [];
    for (let i = 0; i < live.length; i += 2) points.push(`${live[i] * w},${live[i + 1] * h}`);
    shapes = <polyline points={points.join(' ')} fill="none" stroke={erase ? '#f2ae79' : MARK} strokeOpacity="0.7" strokeWidth={brushRadius * 2 * w}
      strokeLinecap="round" strokeLinejoin="round" strokeDasharray={erase ? `${brushRadius * w} ${brushRadius * w}` : undefined} />;
  }

  const painting = mask.kind === 'brush' || mask.kind === 'subject';
  return (
    <div ref={root} className={`absolute z-10 ${painting ? 'pointer-events-auto cursor-crosshair touch-none' : 'pointer-events-none'}`} style={rect}
      onPointerDown={painting ? (event) => {
        if (!event.isPrimary) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const p = toNorm(event);
        setLive([p.x, p.y]);
      } : undefined}
      onPointerMove={painting ? (event) => {
        if (!live || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const p = toNorm(event);
        const lastX = live[live.length - 2];
        const lastY = live[live.length - 1];
        if (Math.hypot(p.x - lastX, (p.y - lastY) * aspect) < 0.003 || live.length >= 3000) return;
        setLive([...live, p.x, p.y]);
      } : undefined}
      onPointerUp={painting ? () => {
        if (live && live.length >= 2 && (mask.kind === 'brush' || mask.kind === 'subject') && mask.strokes.length < 300) {
          onChange({ ...mask, strokes: [...mask.strokes, { radius: brushRadius, erase, points: live.map((v) => Math.round(v * 10000) / 10000) }] });
        }
        setLive(null);
      } : undefined}>
      <canvas ref={shade} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" style={{ imageRendering: 'auto' }} />
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${w} ${h}`}>{shapes}</svg>
      {handles}
    </div>
  );
}
