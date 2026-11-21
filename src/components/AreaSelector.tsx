import { useRef, useState } from 'react';
import { regionFromCorners, type Region } from '../core/subjectRegion';
import { viewerText as t } from '../i18n/areas/viewer';

interface Props {
  /** Where the framed photo sits in its stage, in pixels. */
  rect: React.CSSProperties;
  onSelect: (region: Region) => void;
  onCancel: () => void;
}

/** Drag a box over the photo to say where to look. The box is measured against the framed (cropped) photo. */
export function AreaSelector({ rect, onSelect, onCancel }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const norm = (event: React.PointerEvent) => {
    const box = root.current!.getBoundingClientRect();
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  };
  const shown = drag ? regionFromCorners(drag.a, drag.b) ?? { x: Math.min(drag.a.x, drag.b.x), y: Math.min(drag.a.y, drag.b.y), w: Math.abs(drag.a.x - drag.b.x), h: Math.abs(drag.a.y - drag.b.y) } : null;
  return (
    <div ref={root} style={rect} role="application" aria-label={t.area.region}
      tabIndex={0} className="absolute z-10 cursor-crosshair touch-none bg-black/25 outline-offset-2 focus-visible:outline-2 focus-visible:outline-sky-300"
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onCancel(); } }}
      onPointerDown={(event) => {
        if (!event.isPrimary) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const p = norm(event);
        setDrag({ a: p, b: p });
      }}
      onPointerMove={(event) => { if (drag && event.currentTarget.hasPointerCapture(event.pointerId)) setDrag({ ...drag, b: norm(event) }); }}
      onPointerUp={() => {
        const region = drag ? regionFromCorners(drag.a, drag.b) : null;
        setDrag(null);
        if (region) onSelect(region);
      }}
      onPointerCancel={() => setDrag(null)}>
      {shown && (
        <div className="pointer-events-none absolute border-2 border-dashed border-white bg-white/10 shadow-[0_0_0_1px_rgba(0,0,0,0.7)]"
          style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.w * 100}%`, height: `${shown.h * 100}%` }} />
      )}
      {!drag && <p className="pointer-events-none absolute inset-x-0 top-2 text-center text-xs font-medium text-white drop-shadow">{t.area.hint}</p>}
    </div>
  );
}
