import type { AssistMode } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon, { assistModeIconName } from '../icons/BrandIcon';

const MODES: AssistMode[] = ['solo', 'copilot', 'autopilot'];

interface FlightModeChipProps {
  value: AssistMode;
  onChange: (mode: AssistMode) => void;
}

/**
 * The three Flight modes in the top bar, one click from anywhere in the editor: Solo, Co-pilot, Auto-pilot. A group of
 * radio buttons, so Tab enters it and the arrow keys move between modes. The chosen mode has a border, a tick and bold
 * text as well as its colour. Each option's title says in the owner's words what it does. Narrow bars show icons only
 * (the names stay for screen readers).
 */
export default function FlightModeChip({ value, onChange }: FlightModeChipProps) {
  return (
    <fieldset data-testid="flight-chip" className="hidden shrink-0 md:block">
      <legend className="sr-only">{STRINGS.flight.chipLabel}</legend>
      <div className="inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border-default)] p-0.5">
        {MODES.map((mode) => {
          const selected = value === mode;
          return (
            <label key={mode} data-testid={`flight-chip-${mode}`} title={STRINGS.topBar.assistModeHints[mode]}
              className={`relative inline-flex h-8 cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border px-2 text-xs transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-[var(--brand-accent)] ${
                selected
                  ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] font-semibold text-[var(--text-primary)]'
                  : 'border-transparent font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'}`}>
              <input type="radio" className="sr-only" name="flight-chip-mode" value={mode} checked={selected} onChange={() => onChange(mode)} />
              <BrandIcon name={assistModeIconName(mode)} size={15} className={selected ? 'text-[var(--brand-accent)]' : ''} />
              <span className={`whitespace-nowrap ${selected ? '' : 'sr-only lg:not-sr-only'}`}>{STRINGS.topBar.assistModes[mode]}</span>
              {selected && <BrandIcon name="check" size={10} className="text-[var(--brand-accent)]" />}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
