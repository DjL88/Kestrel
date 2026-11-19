import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { adjustmentFill, signedAdjustment } from '../core/adjustmentSlider';

interface Props {
  label: string;
  /** Override for context-specific screen-reader clarity (e.g. a mask). */
  ariaLabel?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** The value to reset to. Normally zero; independent from the range midpoint. */
  neutral?: number;
  /** Existing visible units (e.g. EV or %); the actual edit numbers remain unchanged. */
  displayValue?: string;
  /** Some positioning/size sliders must never reset to a zero outside their range. */
  resettable?: boolean;
  title?: string;
  /** Optional small hint such as an active macro dial; never replaces the slider name. */
  hint?: string;
  describedBy?: string;
  onFocus?: () => void;
  /** Mobile Quick Adjust gives the same slider a stacked, thumb-sized layout. */
  layout?: 'row' | 'stacked';
}

/** Section F: one calm, accessible adjustment control across desktop, phone and masks.
 * Copper means distance from neutral; the thumb, signed text and accessible
 * value mean editing never relies on colour alone. Native range input retains
 * keyboard arrows, Home/End and pointer semantics. Reset works with mouse,
 * keyboard and touch through the numeric-value button.
 */
export function AdjustmentSlider({
  label, ariaLabel, value, min, max, step, onChange, disabled = false, neutral = 0,
  displayValue, resettable = true, title, hint, describedBy, onFocus, layout = 'stacked',
}: Props) {
  const id = useId();
  // The control moves immediately; expensive preview rendering must not hold the thumb back.
  const [localValue, setLocalValue] = useState(value);
  const dragging = useRef(false);
  const lastSent = useRef<number | null>(null);
  useEffect(() => {
    if (dragging.current) return;
    // Ignore delayed parent echoes of earlier pointer positions.
    if (lastSent.current !== null && Math.abs(value - lastSent.current) > step / 2) return;
    lastSent.current = null;
    setLocalValue(value);
  }, [value, step]);
  const change = (next: number) => {
    setLocalValue(next);
    lastSent.current = next;
    onChange(next);
  };
  const fill = adjustmentFill(localValue, min, max, neutral);
  const shown = displayValue && !dragging.current && lastSent.current === null ? displayValue : signedAdjustment(localValue);
  const changed = Number.isFinite(localValue) && Math.abs(localValue - neutral) >= step / 2;
  const progressStyle: CSSProperties = { left: `${fill.start}%`, width: `${fill.width}%` };
  const originStyle: CSSProperties = { left: `${fill.neutral}%` };
  return (
    <div title={title} className={`kestrel-adjustment min-w-0 items-center gap-x-2 gap-y-0 rounded-md py-0.5 text-sm text-zinc-200
      ${layout === 'stacked' ? 'grid grid-cols-[minmax(0,1fr)_auto]' : 'grid grid-cols-[minmax(4.5rem,0.85fr)_minmax(4rem,1.5fr)_minmax(3.5rem,auto)]'}
      ${disabled ? 'opacity-45' : ''}`}>
      <label htmlFor={id} className={`min-w-0 leading-5 ${layout === 'stacked' ? 'col-start-1 font-medium whitespace-normal' : 'truncate'}`}>{label}{hint && <span className="ml-1.5 text-xs font-normal text-kestrel-copper">{hint}</span>}</label>
      <span className={`relative flex min-w-0 items-center ${layout === 'stacked' ? 'col-span-2 row-start-2 w-full' : ''}`}>
        <span className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/25" aria-hidden="true" />
        {min < neutral && neutral < max && (
          <span className="pointer-events-none absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-white/35" style={originStyle} aria-hidden="true" />
        )}
        <span className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-kestrel-copper" style={progressStyle} aria-hidden="true" />
        <input id={id} type="range" min={min} max={max} step={step} value={localValue} disabled={disabled}
          aria-label={ariaLabel ?? `${label} adjustment`} aria-valuetext={shown} aria-describedby={describedBy}
          onFocus={onFocus} onPointerDown={() => { dragging.current = true; }}
          onPointerUp={() => { dragging.current = false; }}
          onPointerCancel={() => { dragging.current = false; }}
          onChange={(event) => change(event.target.valueAsNumber)}
          onDoubleClick={() => { if (!disabled && resettable) change(neutral); }}
          className="kestrel-adjustment-range relative z-10 h-11 w-full min-w-0 cursor-pointer disabled:cursor-not-allowed" />
      </span>
      {resettable ? (
        <button type="button" aria-label={`Reset ${label} to neutral (currently ${shown})`}
          title={changed ? `Reset ${label} to neutral` : `${label} is neutral`}
          disabled={disabled || !changed} onClick={(event) => { event.preventDefault(); change(neutral); }}
          className={`min-h-10 min-w-14 justify-self-end rounded-md px-1 text-right font-medium tabular-nums focus-visible:outline-2 focus-visible:outline-sky-300
          ${layout === 'stacked' ? 'col-start-2 row-start-1' : ''} ${changed ? 'text-zinc-100 hover:bg-white/10' : 'cursor-default text-zinc-400'}`}>
          {shown}
        </button>
      ) : <output className={`${layout === 'stacked' ? 'col-start-2 row-start-1' : ''} min-w-14 justify-self-end text-right text-zinc-200 tabular-nums`}>{shown}</output>}
    </div>
  );
}
