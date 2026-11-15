import { useEffect, useRef } from 'react';
import type { SubjectGrid } from '../core/maskTypes';

/**
 * The subject the app found, shown as a soft blue wash over a card for a moment, the way a mask looks in the editor.
 * It is decoration: the species name that follows is what carries the information.
 */
export function SubjectFlash({ grid }: { grid: SubjectGrid }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    element.width = grid.w;
    element.height = grid.h;
    const binary = atob(grid.data);
    const image = context.createImageData(grid.w, grid.h);
    for (let i = 0; i < grid.w * grid.h; i += 1) {
      const strength = binary.charCodeAt(i);
      image.data[i * 4] = 78; image.data[i * 4 + 1] = 168; image.data[i * 4 + 2] = 222;
      image.data[i * 4 + 3] = Math.round(strength * 0.6);
    }
    context.putImageData(image, 0, 0);
  }, [grid]);
  return <canvas ref={canvas} data-testid="subject-flash" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-cover motion-safe:animate-[subject-flash_1100ms_ease-in-out_both]" />;
}
