import { useEffect, useRef } from 'react';

/** Tiles near the edge of the screen count as on screen, so the next ones are ready as the person scrolls. */
const MARGIN = '160px';
/** Changes are reported together, at most this often. */
const SETTLE_MS = 80;

/**
 * Reports which photos' tiles (any element with `data-thumb-id`, in the filmstrip or the grid) are on screen now, in
 * page order, whenever that changes. Tiles drawn or removed later (a windowed filmstrip, a filter) are picked up.
 * Watches with the browser's own observers: nothing runs while nothing on screen changes.
 */
export function useThumbnailsOnScreen(report: ((photoIds: readonly string[]) => void) | undefined): void {
  const latest = useRef(report);
  latest.current = report;
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined') return;
    const shown = new Set<Element>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = '';
    const flush = () => {
      timer = null;
      const ids: string[] = [];
      for (const element of document.querySelectorAll('[data-thumb-id]')) {
        if (shown.has(element) && element.isConnected) ids.push((element as HTMLElement).dataset.thumbId!);
      }
      const key = ids.join('|');
      if (key === last) return;
      last = key;
      latest.current?.(ids);
    };
    const soon = () => { if (!timer) timer = setTimeout(flush, SETTLE_MS); };
    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) shown.add(entry.target);
        else shown.delete(entry.target);
      }
      soon();
    }, { rootMargin: MARGIN });
    const watch = (node: Node) => {
      if (!(node instanceof Element)) return;
      if (node.hasAttribute('data-thumb-id')) seen.observe(node);
      for (const tile of node.querySelectorAll('[data-thumb-id]')) seen.observe(tile);
    };
    const forget = (node: Node) => {
      if (!(node instanceof Element)) return;
      const tiles = node.hasAttribute('data-thumb-id') ? [node, ...node.querySelectorAll('[data-thumb-id]')] : [...node.querySelectorAll('[data-thumb-id]')];
      for (const tile of tiles) { seen.unobserve(tile); if (shown.delete(tile)) soon(); }
    };
    const changes = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach(watch);
        record.removedNodes.forEach(forget);
      }
    });
    watch(document.body);
    changes.observe(document.body, { childList: true, subtree: true });
    return () => {
      changes.disconnect();
      seen.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
