import type { AssistMode } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon, { assistModeIconName } from '../icons/BrandIcon';

const MODES: AssistMode[] = ['solo', 'copilot', 'autopilot'];

interface FlightModePickerProps {
  value: AssistMode;
  onChange: (mode: AssistMode) => void;
  /** The radio group's name; each picker on a screen needs its own. */
  name: string;
  /** Read out as the group's name. */
  label: string;
  /** Show the label above the choices (otherwise it is for screen readers only). */
  showLabel?: boolean;
  /** Narrow places (the Flight panel) show the icon and name only; the explanation is shown beside the picker there.
   * On a phone the compact picker is one 44 px row (icon beside name) and its label is for screen readers only. */
  compact?: boolean;
}

/**
 * Solo, Co-pilot or Auto-pilot, each with its icon and, unless compact, one plain line on what it does. The chosen
 * mode is marked by its border, a tick and bold text, never by colour alone.
 */
export default function FlightModePicker({ value, onChange, name, label, showLabel = true, compact = false }: FlightModePickerProps) {
  return (
    <fieldset className="space-y-2">
      <legend className={showLabel ? `mb-2 text-xs font-semibold text-[var(--text-primary)] ${compact ? 'max-md:sr-only' : ''}` : 'sr-only'}>{label}</legend>
      <div className={`grid gap-2 ${compact ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3'}`}>
        {MODES.map((mode) => {
          const selected = value === mode;
          return (
            <label key={mode} data-testid={`flight-mode-${mode}`}
              className={`relative flex cursor-pointer rounded-[var(--radius-md)] border-2 transition-colors focus-within:ring-2 focus-within:ring-[var(--brand-accent)] focus-within:ring-offset-1 focus-within:ring-offset-[var(--bg-surface)] ${
                compact ? 'min-h-12 flex-col items-center justify-center px-1 py-1.5 max-md:min-h-11 max-md:py-1' : 'flex-col gap-1.5 p-3'
              } ${selected
                ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-input)] hover:border-[var(--border-strong)]'}`}>
              <input type="radio" className="sr-only" name={name} value={mode} checked={selected}
                onChange={() => onChange(mode)} />
              <span className={`flex items-center ${compact ? 'flex-col gap-0.5 text-center text-[0.6875rem] leading-tight max-md:flex-row max-md:gap-1.5' : 'gap-1.5 text-xs'} ${selected ? 'font-semibold text-[var(--text-primary)]' : 'font-medium text-[var(--text-secondary)]'}`}>
                <BrandIcon name={assistModeIconName(mode)} size={compact ? 15 : 18} className={selected ? 'text-[var(--brand-accent)]' : ''} />
                {STRINGS.topBar.assistModes[mode]}
              </span>
              {!compact && (
                <span className="block text-[0.6875rem] leading-snug text-[var(--text-secondary)]">
                  {STRINGS.topBar.assistModeHints[mode]}
                </span>
              )}
              {selected && (
                <span className="absolute right-1.5 top-1.5 inline-flex text-[var(--brand-accent)]" aria-hidden="true">
                  <BrandIcon name="check" size={compact ? 10 : 12} />
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
