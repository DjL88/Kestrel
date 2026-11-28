import type { OnImageAdvice } from '../../core/onImageAdvice';

/**
 * The latest on-image advice measured for each photo (src/core/onImageAdvice.ts), shared between the engine, which
 * measures it from the preview once a photo's edit settles, and the canvas layer, which draws it. A photo's entry is
 * cleared the moment its edit changes and set again when the new measurement is done, so the layer never shows advice
 * about an edit that is no longer on the photo. Held in memory only; nothing is saved or sent.
 */
const advice = new Map<string, OnImageAdvice>();
const listeners = new Set<() => void>();

const notify = () => { for (const listener of [...listeners]) listener(); };

export function getAdvice(photoId: string | null | undefined): OnImageAdvice | null {
  return (photoId && advice.get(photoId)) || null;
}

/** Null clears the photo's entry. */
export function setAdvice(photoId: string, value: OnImageAdvice | null): void {
  if (value) advice.set(photoId, value);
  else if (!advice.delete(photoId)) return;
  notify();
}

export function subscribeAdvice(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
