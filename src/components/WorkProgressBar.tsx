/** A shared, accessible progress indicator for import and culling. Colours have meaning, never just decoration. */
export function WorkProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const maximum = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const completed = Number.isFinite(done) ? Math.max(0, Math.min(maximum, Math.floor(done))) : 0;
  const percent = maximum > 0 ? completed / maximum * 100 : 0;
  const finished = maximum > 0 && completed === maximum;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={maximum || 1}
      aria-valuenow={completed} aria-valuetext={`${completed} of ${maximum}`}>
      <div className="relative h-2 overflow-hidden rounded-full bg-black/30">
        <div className={`h-full rounded-full transition-[width,background-color] duration-300 ${finished ? 'bg-emerald-400' : 'bg-amber-400'}`}
          style={{ width: `${percent}%` }} />
        {!finished && percent > 0 && (
          <div className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${percent}%` }} aria-hidden="true">
            <div className="h-full w-1/4 bg-white/25 motion-safe:animate-[import-sheen_1.4s_linear_infinite]" />
          </div>
        )}
      </div>
    </div>
  );
}
