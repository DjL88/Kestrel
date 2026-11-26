import { STRINGS } from '../strings';

interface QuickStartCardProps {
  quickStart: { phase: 'working' | 'ready' | 'unchanged' | 'held' | 'failed'; photoId: string | null } | null | undefined;
  onExport: () => void;
  onDone: () => void;
}

/**
 * First run, in the editor: says what InFlight is doing with the person's first photo, then what Auto did, in plain words,
 * with the one next step (export) and a way to carry on alone. Calm: no animation beyond the system's own, text not colour.
 */
export default function QuickStartCard({ quickStart, onExport, onDone }: QuickStartCardProps) {
  if (!quickStart) return null;
  const t = STRINGS.quickStart;
  const message = quickStart.phase === 'working' ? t.working
    : quickStart.phase === 'ready' ? t.ready
      : quickStart.phase === 'unchanged' ? t.unchanged
        : quickStart.phase === 'held' ? t.held : t.failedCheck;
  return (
    <section aria-labelledby="v2-quick-start-title" data-testid="quick-start-card"
      className="v2-safe-bottom fixed bottom-24 left-1/2 z-[70] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 text-[var(--text-primary)] shadow-[var(--shadow-panel)]">
      <h2 id="v2-quick-start-title" className="text-sm font-semibold">{t.title}</h2>
      <p role="status" aria-live="polite" className="mt-1 text-sm text-[var(--text-secondary)]">{message}</p>
      {quickStart.phase !== 'working' && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onDone}
            className="min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm">{t.done}</button>
          <button type="button" onClick={onExport}
            className="min-h-10 rounded-[var(--radius-sm)] bg-[var(--brand-accent)] px-3 text-sm font-medium text-[var(--text-on-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-accent)]">{t.export}</button>
        </div>
      )}
    </section>
  );
}
