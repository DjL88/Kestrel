/**
 * Input policy for the future V2 stylus editing surface.
 * These helpers deliberately have no React/DOM dependency, allowing native iPad,
 * Android and browser surfaces to share the same pressure and palm policy.
 * No edit is applied here. A tool must explicitly be active before consuming input.
 */
export type DrawingPointerType = 'pen' | 'mouse' | 'touch';
export interface DrawingPointer {
  pointerType: string;
  pressure: number;
  tiltX?: number;
  tiltY?: number;
  buttons?: number;
  isPrimary?: boolean;
}
export interface StylusSample {
  kind: DrawingPointerType;
  strength: number;
  tiltX: number;
  tiltY: number;
}
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const finite = (n: number | undefined, fallback = 0) => typeof n === 'number' && Number.isFinite(n) ? n : fallback;

/** Suppress touch painting while a stylus is in contact, avoiding inadvertent palm strokes. */
export function mayPaintPointer(pointer: DrawingPointer, penInContact: boolean, allowFingerPainting = false): boolean {
  if (pointer.pointerType === 'pen') return true;
  if (pointer.pointerType === 'mouse') return true;
  return pointer.pointerType === 'touch' && allowFingerPainting && !penInContact && pointer.isPrimary !== false;
}

/**
 * Map stylus pressure to strength, never size: radius and opacity are separately
 * adjustable. Mouse and opt-in finger input use a constant 1. Browser pen pressure
 * may be zero on down/up or where unavailable; keep zero as 0 and do not invent it.
 */
export function stylusSample(pointer: DrawingPointer): StylusSample | null {
  if (pointer.pointerType !== 'pen' && pointer.pointerType !== 'mouse' && pointer.pointerType !== 'touch') return null;
  const kind = pointer.pointerType;
  return {
    kind,
    strength: kind === 'pen' ? clamp(finite(pointer.pressure), 0, 1) : 1,
    tiltX: kind === 'pen' ? clamp(finite(pointer.tiltX), -90, 90) : 0,
    tiltY: kind === 'pen' ? clamp(finite(pointer.tiltY), -90, 90) : 0,
  };
}

/** Avoid drawing when a pen is hovering or no pointer button/contact is active. */
export function stylusIsInContact(pointer: DrawingPointer): boolean {
  return (pointer.buttons ?? 1) !== 0;
}
