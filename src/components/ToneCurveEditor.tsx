import { useCallback, useRef, useState } from 'react';
import { DEFAULT_TONE_CURVE, evaluateToneCurveLut, isIdentityToneCurve } from '../core/photoEdits';

interface Props {
  curve?: [number, number][];
  disabled?: boolean;
  onChange: (next: [number, number][] | undefined) => void;
}

const SIZE = 180;
const PAD = 10;
const INNER = SIZE - PAD * 2;
const MAX_POINTS = 12;

const cloneCurve = (curve?: readonly (readonly [number, number])[]): [number, number][] =>
  (curve && curve.length >= 2 ? curve : DEFAULT_TONE_CURVE).map(([x, y]) => [x, y]);

export function ToneCurveEditor({ curve, disabled, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(2);
  const draggingIndex = useRef<number | null>(null);
  const points = cloneCurve(curve);
  const identity = isIdentityToneCurve(curve);
  const lut = evaluateToneCurveLut(points, 65);

  const toSvg = (x: number, y: number): [number, number] => [
    PAD + x * INNER,
    PAD + (1 - y) * INNER,
  ];

  const fromClient = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const scaleX = SIZE / rect.width;
    const scaleY = SIZE / rect.height;
    const sx = (clientX - rect.left) * scaleX;
    const sy = (clientY - rect.top) * scaleY;
    return [
      Math.min(1, Math.max(0, (sx - PAD) / INNER)),
      Math.min(1, Math.max(0, 1 - (sy - PAD) / INNER)),
    ];
  }, []);

  const commit = useCallback((next: [number, number][]) => {
    if (isIdentityToneCurve(next)) onChange(undefined);
    else onChange(next);
  }, [onChange]);

  const updatePoint = useCallback((idx: number, nx: number, ny: number) => {
    const updated = cloneCurve(curve);
    const minX = idx === 0 ? 0 : idx === updated.length - 1 ? 1 : updated[idx - 1][0] + 0.025;
    const maxX = idx === 0 ? 0 : idx === updated.length - 1 ? 1 : updated[idx + 1][0] - 0.025;
    updated[idx] = [
      Number(Math.min(maxX, Math.max(minX, nx)).toFixed(3)),
      Number(Math.min(1, Math.max(0, ny)).toFixed(3)),
    ];
    commit(updated);
  }, [commit, curve]);

  const addOrSelectPoint = (nx: number, ny: number) => {
    if (disabled) return;
    // Check if near an existing point first
    const hitIdx = points.findIndex(([px, py]) => Math.hypot(px - nx, py - ny) < 0.06);
    if (hitIdx !== -1) {
      setSelectedIndex(hitIdx);
      draggingIndex.current = hitIdx;
      return;
    }
    if (points.length >= MAX_POINTS) return;
    const next = [...points, [Number(nx.toFixed(3)), Number(ny.toFixed(3))] as [number, number]]
      .sort((a, b) => a[0] - b[0]);
    const idx = next.findIndex(([px]) => Math.abs(px - nx) < 0.002);
    setSelectedIndex(idx >= 0 ? idx : 0);
    draggingIndex.current = idx >= 0 ? idx : null;
    commit(next);
  };

  const removePoint = (idx: number) => {
    if (disabled || idx <= 0 || idx >= points.length - 1 || points.length <= 2) return;
    const next = points.filter((_, i) => i !== idx);
    setSelectedIndex(Math.min(idx, next.length - 1));
    commit(next);
  };

  const pathD = Array.from(lut, (y, i) => {
    const [sx, sy] = toSvg(i / (lut.length - 1), y);
    return `${i === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`;
  }).join(' ');

  const activePt = points[Math.min(selectedIndex, points.length - 1)];

  return (
    <div className="space-y-1.5 pt-1" role="group" aria-label="Tone curve">
      <div className="flex items-center justify-between text-xs text-zinc-300">
        <span>Tone curve</span>
        <div className="flex items-center gap-2">
          <span className="tabular-nums text-[11px] text-zinc-400">
            {Math.round(activePt[0] * 100)}% → {Math.round(activePt[1] * 100)}%
          </span>
          <button
            type="button"
            disabled={disabled || identity}
            onClick={() => onChange(undefined)}
            className="min-h-7 rounded px-1.5 text-[11px] text-zinc-300 hover:bg-white/10 disabled:opacity-40"
          >
            Reset
          </button>
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={`block w-full touch-none select-none rounded-md border border-white/12 bg-[#0a0c10] ${disabled ? 'opacity-45 pointer-events-none' : 'cursor-crosshair'}`}
        onPointerDown={(event) => {
          if (disabled) return;
          const pt = fromClient(event.clientX, event.clientY);
          if (!pt) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          addOrSelectPoint(pt[0], pt[1]);
        }}
        onPointerMove={(event) => {
          if (draggingIndex.current === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const pt = fromClient(event.clientX, event.clientY);
          if (!pt) return;
          updatePoint(draggingIndex.current, pt[0], pt[1]);
        }}
        onLostPointerCapture={() => { draggingIndex.current = null; }}
      >
        {/* Subtle 4x4 studio reference grid */}
        {[0.25, 0.5, 0.75].map((t) => {
          const pos = PAD + t * INNER;
          return (
            <g key={t}>
              <line x1={pos} y1={PAD} x2={pos} y2={SIZE - PAD} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
              <line x1={PAD} y1={pos} x2={SIZE - PAD} y2={pos} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
            </g>
          );
        })}
        {/* Identity diagonal baseline */}
        <line x1={PAD} y1={SIZE - PAD} x2={SIZE - PAD} y2={PAD} stroke="rgba(255,255,255,0.16)" strokeWidth={1} strokeDasharray="3 3" />
        {/* Evaluated monotonic Hermite spline */}
        <path d={pathD} fill="none" stroke="#e4e4e7" strokeWidth={1.75} strokeLinecap="round" />
        {/* Control knots */}
        {points.map(([x, y], idx) => {
          const [cx, cy] = toSvg(x, y);
          const isSelected = idx === selectedIndex;
          return (
            <circle
              key={`${idx}-${points.length}`}
              cx={cx}
              cy={cy}
              r={isSelected ? 5 : 4}
              tabIndex={disabled ? -1 : 0}
              role="slider"
              aria-label={`Tone curve point ${idx + 1}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(y * 100)}
              fill={isSelected ? '#38bdf8' : '#18181b'}
              stroke="#f4f4f5"
              strokeWidth={1.5}
              className="cursor-grab focus:outline-none"
              onFocus={() => setSelectedIndex(idx)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                removePoint(idx);
              }}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 0.05 : 0.02;
                if (e.key === 'ArrowUp') { e.preventDefault(); updatePoint(idx, x, y + step); }
                else if (e.key === 'ArrowDown') { e.preventDefault(); updatePoint(idx, x, y - step); }
                else if (e.key === 'ArrowLeft') { e.preventDefault(); updatePoint(idx, x - step, y); }
                else if (e.key === 'ArrowRight') { e.preventDefault(); updatePoint(idx, x + step, y); }
                else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removePoint(idx); }
              }}
            />
          );
        })}
      </svg>
      <p className="text-[11px] text-zinc-400">Drag knots to sculpt contrast; double-click an interior point to remove it.</p>
    </div>
  );
}
