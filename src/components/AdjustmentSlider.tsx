import type { CSSProperties } from 'react';
import { adjustmentFill, signedAdjustment } from '../core/adjustmentSlider';

interface Props {
  label: string;
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
  title?: string;
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
  label, value, min, max, step, onChange, disabled = false, neutral = 0,
  displayValue, title, describedBy, onFocus, layout = 'row',
}: Props) {
  const fill = adjustmentFill(value, min, max, neutral);
  const shown = displayValue ?? signedAdjustment(value);
  const changed = Math.abs(value - neutral) > 1e-8;
  const progressStyle: CSSProperties = { left: `${fill.start}%`, width: `${fill.width}%` };
  const originStyle: CSSProperties = { left: `${fill.neutral}%` };
  return (
    <label title={title} className={`kestrel-adjustment flex min-w-0 items-center gap-2.5 rounded-md py-0.5 text-sm text-zinc-200 disabled:opacity-45
      ${layout === 'stacked' ? 'flex-wrap justify-between gap-y-0.5' : 'grid grid-cols-[minmax(4.5rem,0.85fr)_minmax(4rem,1.5fr)_minmax(3.5rem,auto)]'}
      ${disabled ? 'opacity-45' : ''}`}>
      <span className={`min-w-0 leading-5 ${layout === 'stacked' ? 'flex-1 font-medium' : 'truncate'}`}>{label}</span>
      <span className={`relative flex min-w-0 items-center ${layout === 'stacked' ? 'order-3 w-full' : ''}`}>
        <span className="pointer-events-none absolute inset-x-0 h-1 rounded-full bg-white/25" aria-hidden="true" />
        {min < neutral && neutral < max && (
          <span className="pointer-events-none absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-white/35" style={originStyle} aria-hidden="true" />
        )}
        <span className="pointer-events-none absolute h-1 rounded-full bg-kestrel-copper" style={progressStyle} aria-hidden="true" />
        <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
          aria-label={`${label} adjustment`} aria-valuetext={shown} aria-describedby={describedBy}
          onFocus={onFocus} onChange={(event) => onChange(event.target.valueAsNumber)}
          onDoubleClick={() => { if (!disabled) onChange(neutral); }}
          className="kestrel-adjustment-range relative z-10 h-11 w-full min-w-0 cursor-pointer disabled:cursor-not-allowed" />
      </span>
      <button type="button" aria-label={`Reset ${label} to neutral (currently ${shown})`}
        title={changed ? `Reset ${label} to neutral` : `${label} is neutral`}
        disabled={disabled || !changed} onClick={(event) => { event.preventDefault(); onChange(neutral); }}
        className={`min-h-10 min-w-14 justify-self-end rounded-md px-1 text-right font-medium tabular-nums focus-visible:outline-2 focus-visible:outline-sky-300
        ${changed ? 'text-zinc-100 hover:bg-white/10' : 'cursor-default text-zinc-400'}`}>
        {shown}
      </button>
    </label>
  );
}
