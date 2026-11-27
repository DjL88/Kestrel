import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PhotoEdit } from '../core/photoEdits';
import { framedSize, lensCentre, type PhotoFraming } from '../core/photoFraming';
import { detailPlan, type DetailPlan } from '../core/detailRegion';
import { editGestureActive, onEditGestureEnd } from '../providers/editGesture';
import { liveDraft, liveDraftSupported } from '../providers/liveDraft';
import { measureStep } from '../providers/previewTiming';

/** The full-resolution picture the last full render was drawn from, and the size that render had. */
export interface DetailSource { element: HTMLImageElement; key: string; renderedLongEdge: number }

interface Options {
  containerRef: RefObject<HTMLDivElement | null>;
  sourceRef: RefObject<DetailSource | null>;
  slot: string;
  enabled: boolean;
  edit: PhotoEdit;
  framing: PhotoFraming;
  /** Everything the shown picture depends on; a change hides the detail until it is drawn again. */
  pictureKey: string;
  /** Changes when a new full render (and so possibly a new full-resolution source) is shown. */
  renderedRevision: number;
  onLoading?: (loading: boolean) => void;
  /** How the picture sits in its box (object-fit). */
  fit?: 'cover' | 'contain';
}

export interface DetailShown { plan: DetailPlan; key: string; pictureKey: string }

/** Wait this long after the last zoom, scroll or edit before drawing the detail. */
const SETTLE_MS = 250;

/** The visible part of an element: its own rectangle cut by every ancestor that clips, and the window. */
function visibleRect(element: HTMLElement): DOMRect {
  let { left, top, right, bottom } = element.getBoundingClientRect();
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const clip = parent.getBoundingClientRect();
    left = Math.max(left, clip.left); top = Math.max(top, clip.top); right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
  }
  left = Math.max(left, 0); top = Math.max(top, 0); right = Math.min(right, window.innerWidth); bottom = Math.min(bottom, window.innerHeight);
  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}

/**
 * Zoomed in past the shown picture's own resolution (the edited view is drawn at most 2,200 px), the part of the photo
 * on screen is drawn again from the full-resolution picture, in the drag worker, at the size it is shown, and laid
 * exactly over the picture. So 100% is the photo's own pixels, never a smaller preview enlarged. Only once the zoom,
 * scroll and edit have been still a moment, and never while a slider is held. Says when it is loading.
 */
export function useDetailRegion({ containerRef, sourceRef, slot, enabled, edit, framing, pictureKey, renderedRevision, onLoading, fit = 'cover' }: Options) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [shown, setShown] = useState<DetailShown | null>(null);
  const shownKey = useRef<string | null>(null);
  shownKey.current = shown?.key ?? null;
  /** The region being drawn now: asking again for the same one keeps it going rather than starting over. */
  const drawing = useRef<{ key: string; generation: number } | null>(null);
  const generation = useRef(0);
  const loadingRef = useRef(onLoading);
  loadingRef.current = onLoading;
  const [nudge, setNudge] = useState(0);

  // Zoom (layout zoom changes sizes), scroll and window size all change what is visible.
  useEffect(() => {
    if (!enabled) return;
    const element = containerRef.current;
    if (!element) return;
    const bump = () => setNudge((count) => count + 1);
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(bump);
    resize?.observe(element);
    window.addEventListener('scroll', bump, { capture: true, passive: true });
    window.addEventListener('resize', bump);
    const stopGesture = onEditGestureEnd(bump);
    // The canvas zooms with CSS zoom on an ancestor, which changes this element's place on screen but not its own size,
    // so no observer hears it: its rectangle is compared now and then instead (cheap, and only while detail is possible).
    let last = '';
    const watch = window.setInterval(() => {
      const box = element.getBoundingClientRect();
      const now = [box.left, box.top, box.width, box.height].map(Math.round).join(',');
      if (now !== last) { last = now; bump(); }
    }, 400);
    return () => { resize?.disconnect(); window.removeEventListener('scroll', bump, { capture: true }); window.removeEventListener('resize', bump); stopGesture(); window.clearInterval(watch); };
  }, [enabled, containerRef]);

  useEffect(() => {
    if (!enabled || !liveDraftSupported()) { setShown(null); return; }
    const timer = window.setTimeout(() => {
      void (async () => {
        const element = containerRef.current;
        const source = sourceRef.current;
        if (!element || !source || editGestureActive()) return;
        const box = element.getBoundingClientRect();
        const visible = visibleRect(element);
        const full = framedSize(source.element.naturalWidth, source.element.naturalHeight, framing);
        const plan = detailPlan({
          box: { left: box.left, top: box.top, width: box.width, height: box.height },
          visible: { left: visible.left, top: visible.top, width: visible.width, height: visible.height },
          devicePixelRatio: window.devicePixelRatio || 1, renderedLongEdge: source.renderedLongEdge,
          full: { width: full.width, height: full.height }, fit,
        });
        if (!plan) { setShown(null); return; }
        const key = JSON.stringify([pictureKey, plan]);
        if (shownKey.current === key || drawing.current?.key === key) return;
        const mine = (generation.current += 1);
        drawing.current = { key, generation: mine };
        // Overtaken by a draw of a different region or edit.
        const overtaken = () => generation.current !== mine;
        const draft = liveDraft();
        if (draft.detailSourceKey(slot) !== source.key) {
          const blob = await fetch(source.element.currentSrc || source.element.src).then((response) => response.blob()).catch(() => null);
          if (overtaken() || !blob) { if (!overtaken()) drawing.current = null; return; }
          draft.sendDetailSource(slot, source.key, blob);
        }
        loadingRef.current?.(true);
        const started = performance.now();
        try {
          const bitmap = await draft.drawDetail({
            slot, key: source.key, framing, region: plan.region, scale: plan.scale, edit, view: plan.view, aspect: full.height / full.width,
            lensCentre: lensCentre(source.element.naturalWidth, source.element.naturalHeight, framing),
          });
          if (overtaken() || !bitmap) { bitmap?.close(); return; }
          const canvas = canvasRef.current;
          if (!canvas) { bitmap.close(); return; }
          canvas.width = bitmap.width; canvas.height = bitmap.height;
          canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
          bitmap.close();
          measureStep('preview:detail', started, { width: canvas.width, height: canvas.height });
          setShown({ plan, key, pictureKey });
        } finally {
          if (!overtaken()) { drawing.current = null; loadingRef.current?.(false); }
        }
      })().catch(() => undefined);
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pictureKey, renderedRevision, nudge, slot, fit]);

  // A change to the picture (an edit, a new source) hides the detail at once, so it never shows a different edit.
  const current = shown && shown.pictureKey === pictureKey ? shown : null;
  useEffect(() => () => loadingRef.current?.(false), []);
  return { canvasRef, shown: current };
}
