import { useEffect, useRef, useState } from 'react';
import { messages as m } from '../i18n/messages';
import { Check, Columns2, Minus, Plus, Redo2, SlidersHorizontal, Undo2 } from 'lucide-react';
import { QUICK_CONTROLS, changedKeys, controlFor, nudge, valueOf, type QuickKey } from '../core/quickControls';
import { AdjustmentSlider } from './AdjustmentSlider';
import { signedAdjustment } from '../core/adjustmentSlider';
import type { PhotoEdit } from '../core/photoEdits';

interface Props {
  edit: PhotoEdit;
  disabled: boolean;
  onEdit: (edit: PhotoEdit) => void;
  canStepBack: boolean;
  canStepForward: boolean;
  onStepBack: () => void;
  onStepForward: () => void;
  peeking: boolean;
  onPeek: () => void;
  onShowAll: () => void;
}

const round = 'grid h-12 w-12 shrink-0 place-items-center rounded-full border border-white/12 text-zinc-100 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-40';

/**
 * Editing with one thumb: pick an adjustment from a row of chips, then move one big slider. Undo, redo and a peek at the
 * original sit above it. Every control is the same one the full list has, so nothing is hidden, only brought within reach.
 */
export function QuickAdjust({ edit, disabled, onEdit, canStepBack, canStepForward, onStepBack, onStepForward, peeking, onPeek, onShowAll }: Props) {
  const [key, setKey] = useState<QuickKey>('exposure');
  const control = controlFor(key);
  const value = valueOf(edit, key);
  const changed = changedKeys(edit);
  const selected = useRef<HTMLButtonElement>(null);
  useEffect(() => { selected.current?.scrollIntoView({ inline: 'center', block: 'nearest' }); }, [key]);
  const set = (next: number) => onEdit({ ...edit, [key]: next });
  return (
    <section aria-label={m.quick.title} className="space-y-2 px-1 pb-2 pt-1">
      <div className="hand-row flex items-center justify-between gap-1">
        <span className="flex gap-1">
          <button type="button" className={round} aria-label={m.quick.stepBack} title={m.quick.stepBackHint} disabled={disabled || !canStepBack} onClick={onStepBack}><Undo2 className="h-5 w-5" aria-hidden="true" /></button>
          <button type="button" className={round} aria-label={m.quick.stepForward} title={m.quick.stepForwardHint} disabled={disabled || !canStepForward} onClick={onStepForward}><Redo2 className="h-5 w-5" aria-hidden="true" /></button>
          <button type="button" className={`${round} aria-pressed:border-sky-300 aria-pressed:bg-sky-300/15`} aria-pressed={peeking} aria-label={m.quick.peek} title={m.quick.peekHint}
            disabled={disabled} onClick={onPeek}><Columns2 className="h-5 w-5" aria-hidden="true" /></button>
        </span>
        <button type="button" className="inline-flex min-h-12 items-center gap-1.5 rounded-full px-3 text-xs text-zinc-300 hover:bg-white/10" onClick={onShowAll}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />{m.quick.allControls}
        </button>
      </div>

      <div role="group" aria-label={m.quick.choose} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {QUICK_CONTROLS.map((entry) => (
          <button key={entry.key} ref={entry.key === key ? selected : undefined} type="button" aria-pressed={entry.key === key} disabled={disabled} onClick={() => setKey(entry.key)}
            aria-label={`${m.adjustment[entry.key]}${changed.includes(entry.key) ? m.quick.adjustedState : m.quick.unchangedState}`}
            className="relative min-h-11 shrink-0 rounded-full border border-white/12 px-3.5 text-sm text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-45 aria-pressed:border-sky-300 aria-pressed:bg-sky-300/20 aria-pressed:text-white">
            {m.adjustment[entry.key]}
            {changed.includes(entry.key) && <span className="ml-1.5 inline-flex align-middle text-sky-200" aria-label={m.quick.adjusted} title={m.quick.adjustedHint}><Check className="h-3.5 w-3.5" aria-hidden="true" /></span>}
          </button>
        ))}
      </div>

      {(key === 'exposure' || key === 'brightness') && (
        <p className="px-1 text-xs text-zinc-400">
          {key === 'exposure'
            ? m.quick.exposureHint
            : m.quick.brightnessHint}
        </p>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" className={round} aria-label={m.quick.down(m.adjustment[key])} title={m.quick.downHint(m.adjustment[key])} disabled={disabled || value <= control.min} onClick={() => set(nudge(control, value, -1))}><Minus className="h-5 w-5" aria-hidden="true" /></button>
        <div className="min-w-0 flex-1">
          {/* "(adjusted)" says in words, not only in copper, that this control has been moved. */}
          <AdjustmentSlider layout="stacked" label={m.adjustment[key]} value={value} hint={value !== 0 ? '(adjusted)' : undefined}
            min={control.min} max={control.max} step={control.step} disabled={disabled}
            displayValue={key === 'exposure' ? `${signedAdjustment(value * 0.4)} EV`
              : key === 'colour' && value === -2 ? m.quick.monochrome
              : key === 'warmth' ? `${signedAdjustment(Math.round(value * 8), 0)}%`
              : key === 'colour' ? `${signedAdjustment(Math.round(value * 20), 0)}%`
              : signedAdjustment(Math.round(value * 50), 0)}
            onChange={set} />
        </div>
        <button type="button" className={round} aria-label={m.quick.up(m.adjustment[key])} title={m.quick.upHint(m.adjustment[key])} disabled={disabled || value >= control.max} onClick={() => set(nudge(control, value, 1))}><Plus className="h-5 w-5" aria-hidden="true" /></button>
      </div>
    </section>
  );
}
