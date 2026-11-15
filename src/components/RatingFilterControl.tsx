import { useState } from 'react';
import { Star } from 'lucide-react';
import type { RatingFilter } from '../core/types';
import { describeRatingFilter, flipRatingMode, pickRating } from '../core/ratingFilter';

/**
 * Filter by stars in one row. Tap a star for "that many or more", flip the symbol to "exactly that many",
 * tap the same star again to clear. "None" shows photos with no rating.
 */
export function RatingFilterControl({ value, onChange, className = '' }: { value: RatingFilter | null; onChange: (filter: RatingFilter | null) => void; className?: string }) {
  const [mode, setMode] = useState<RatingFilter['mode']>(value?.mode ?? 'atLeast');
  const active = value && value.value > 0 ? value : null;
  const exact = (value?.mode ?? mode) === 'exactly';
  const lit = (n: number) => !!active && (active.mode === 'exactly' ? n === active.value : n <= active.value);
  const chip = 'grid min-h-10 min-w-10 place-items-center rounded-md text-zinc-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-sky-300';
  return (
    <div role="group" aria-label="Filter by rating" className={`flex items-center gap-0.5 rounded-md border border-white/10 bg-kestrel-panel px-1 ${className}`}>
      <button type="button" className={`${chip} text-sm font-semibold`} aria-pressed={exact}
        aria-label={exact ? 'Matching exactly this rating. Press to match this rating or more.' : 'Matching this rating or more. Press to match exactly this rating.'}
        title={exact ? 'Exactly this many stars' : 'This many stars or more'}
        onClick={() => {
          const next = flipRatingMode(value ?? { mode, value: 0 });
          setMode(next);
          if (active) onChange({ mode: next, value: active.value });
        }}>
        {exact ? '=' : '≥'}
      </button>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={chip} aria-pressed={active?.value === n}
          aria-label={exact ? `Exactly ${n} ${n === 1 ? 'star' : 'stars'}` : `${n} ${n === 1 ? 'star' : 'stars'} or more`}
          title={exact ? `Exactly ${n}★` : `${n}★ or more`}
          onClick={() => onChange(pickRating(value, exact ? 'exactly' : 'atLeast', n))}>
          <Star className={`h-4 w-4 ${lit(n) ? 'fill-amber-300 text-amber-300' : ''}`} aria-hidden="true" />
        </button>
      ))}
      <button type="button" className={`${chip} px-1.5 text-xs`} aria-pressed={value?.mode === 'exactly' && value.value === 0}
        title="Photos with no rating" onClick={() => onChange(pickRating(value, 'exactly', 0))}>None</button>
      <span className="sr-only" role="status">{describeRatingFilter(value)}</span>
    </div>
  );
}
