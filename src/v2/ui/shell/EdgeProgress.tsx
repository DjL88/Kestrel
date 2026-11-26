import { useEffect, useState } from 'react';

interface EdgeProgressProps {
  /** Work is happening. The bar appears only after a short wait, so quick redraws never flash it. */
  active: boolean;
  /** 0 to 100 when the amount is known; null shows a quiet moving stripe (a still, part-filled bar with less movement). */
  value: number | null;
  label: string;
  edge: 'top' | 'bottom';
  testId?: string;
  /** How long work must last before the bar shows (ms). */
  delay?: number;
}

/** A 2px progress line along one edge of an area: the filmstrip while photos import or are sorted, the photo while it
 * loads or develops. Theme accent colour; a progressbar for screen readers; nothing is shown when nothing is happening. */
export default function EdgeProgress({ active, value, label, edge, testId, delay = 300 }: EdgeProgressProps) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) { setShown(false); return; }
    const timer = window.setTimeout(() => setShown(true), delay);
    return () => window.clearTimeout(timer);
  }, [active, delay]);
  if (!active || !shown) return null;
  const known = value !== null;
  return (
    <div role="progressbar" aria-label={label} data-testid={testId}
      aria-valuemin={known ? 0 : undefined} aria-valuemax={known ? 100 : undefined} aria-valuenow={known ? value : undefined}
      className={`v2-edge-progress pointer-events-none absolute inset-x-0 z-30 h-0.5 overflow-hidden ${edge === 'top' ? 'top-0' : 'bottom-0'}`}>
      {known
        ? <div className="h-full bg-[var(--brand-accent)] transition-[width] duration-300" style={{ width: `${Math.max(2, value)}%` }} />
        : <div className="v2-edge-progress-stripe h-full w-1/3 bg-[var(--brand-accent)]" />}
    </div>
  );
}
