import { useMemo, useRef, type MouseEvent, type PointerEvent } from 'react';
import { createLongPress } from '../core/longPress';

/**
 * Props for an element that should open a menu on a touch or pen long-press.
 * The click that ends a long press is swallowed, so the press does not also select the control.
 * Spread the result onto the element; pass `enabled: false` to leave it inert.
 */
export function useLongPress(onLongPress: (point: { x: number; y: number }) => void, enabled = true) {
  const latest = useRef(onLongPress);
  latest.current = onLongPress;
  const swallowClick = useRef(false);
  const press = useMemo(() => createLongPress((point) => latest.current(point)), []);
  return useMemo(() => enabled ? {
    onPointerDown: (event: PointerEvent) => press.down({ x: event.clientX, y: event.clientY, pointerType: event.pointerType }),
    onPointerMove: (event: PointerEvent) => press.move({ x: event.clientX, y: event.clientY }),
    onPointerUp: () => { swallowClick.current = press.up(); },
    onPointerCancel: () => press.cancel(),
    onPointerLeave: () => press.cancel(),
    onClickCapture: (event: MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    // Stops the browser's own selection or callout from competing with the menu.
    style: { WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' } as const,
  } : {}, [enabled, press]);
}
