import { useEffect, useRef, useState } from 'react';
import { Check, Columns2, Minus, Plus, Redo2, RotateCcw, SlidersHorizontal, Undo2 } from 'lucide-react';
import { QUICK_CONTROLS, changedKeys, controlFor, nudge, valueOf, valueText, type QuickKey } from '../core/quickControls';
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
    <section aria-label="Quick adjust" className="space-y-2 px-1 pb-2 pt-1">
      <div className="flex items-center justify-between gap-1">
        <span className="flex gap-1">
          <button type="button" className={round} aria-label="Step back" title="Step back one change" disabled={disabled || !canStepBack} onClick={onStepBack}><Undo2 className="h-5 w-5" aria-hidden="true" /></button>
          <button type="button" className={round} aria-label="Step forward" title="Step forward one change" disabled={disabled || !canStepForward} onClick={onStepForward}><Redo2 className="h-5 w-5" aria-hidden="true" /></button>
          <button type="button" className={`${round} aria-pressed:border-sky-300 aria-pressed:bg-sky-300/15`} aria-pressed={peeking} aria-label="Peek at the original" title="Show the original next to your edit"
            disabled={disabled} onClick={onPeek}><Columns2 className="h-5 w-5" aria-hidden="true" /></button>
        </span>
        <button type="button" className="inline-flex min-h-12 items-center gap-1.5 rounded-full px-3 text-xs text-zinc-300 hover:bg-white/10" onClick={onShowAll}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />All controls
        </button>
      </div>

      <div role="group" aria-label="Choose what to adjust" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {QUICK_CONTROLS.map((entry) => (
          <button key={entry.key} ref={entry.key === key ? selected : undefined} type="button" aria-pressed={entry.key === key} disabled={disabled} onClick={() => setKey(entry.key)}
            aria-label={`${entry.label}${changed.includes(entry.key) ? ', adjusted' : ', unchanged'}`}
            className="relative min-h-11 shrink-0 rounded-full border border-white/12 px-3.5 text-sm text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-45 aria-pressed:border-sky-300 aria-pressed:bg-sky-300/20 aria-pressed:text-white">
            {entry.label}
            {changed.includes(entry.key) && <span className="ml-1.5 inline-flex align-middle text-sky-200" aria-label="Adjusted" title="Adjusted from the original"><Check className="h-3.5 w-3.5" aria-hidden="true" /></span>}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-medium text-zinc-100">{control.label}{value !== 0 && <span className="ml-2 text-xs font-normal text-sky-200">(adjusted)</span>}</span>
        <output className="text-lg tabular-nums text-zinc-100" aria-live="off">{valueText(key, value)}</output>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={round} aria-label={`${control.label} down`} title={`Lower ${control.label} a little`} disabled={disabled || value <= control.min} onClick={() => set(nudge(control, value, -1))}><Minus className="h-5 w-5" aria-hidden="true" /></button>
        <input type="range" min={control.min} max={control.max} step={control.step} value={value} disabled={disabled} aria-label={`${control.label} adjustment`}
          onChange={(event) => set(event.target.valueAsNumber)} onDoubleClick={() => set(0)} className="h-12 min-w-0 flex-1 accent-sky-300" />
        <button type="button" className={round} aria-label={`${control.label} up`} title={`Raise ${control.label} a little`} disabled={disabled || value >= control.max} onClick={() => set(nudge(control, value, 1))}><Plus className="h-5 w-5" aria-hidden="true" /></button>
        <button type="button" className={round} aria-label={`Reset ${control.label}`} title={`Reset ${control.label}`} disabled={disabled || value === 0} onClick={() => set(0)}><RotateCcw className="h-5 w-5" aria-hidden="true" /></button>
      </div>
    </section>
  );
}
