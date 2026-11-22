import { useId } from 'react';
import { GUIDANCE_MODES, type GuidanceMode } from '../core/guidanceMode';
import { guidanceCopy } from '../i18n/guidanceLabels';
import autopilotIcon from '../assets/brand/modes/mode-autopilot.svg?raw';
import copilotIcon from '../assets/brand/modes/mode-copilot.svg?raw';
import soloIcon from '../assets/brand/modes/mode-solo.svg?raw';

const MODE_ICON: Record<GuidanceMode, string> = { soar: autopilotIcon, glide: copilotIcon, solo: soloIcon };

/** The brand pack's pilot-mode chevron (Auto Pilot, Co Pilot, Solo), inline so it takes the rust colour. The mode's name is always written beside it. */
function ModeIcon({ mode }: { mode: GuidanceMode }) {
  return <span aria-hidden="true" className="mt-0.5 inline-block h-5 w-5 shrink-0 text-[var(--if-brand-rust)] [&>svg]:h-full [&>svg]:w-full"
    dangerouslySetInnerHTML={{ __html: MODE_ICON[mode] }} />;
}

interface Props {
  value: GuidanceMode;
  onChange: (mode: GuidanceMode) => void;
  compact?: boolean;
}

/** One accessible choice shared by View and Settings, not a separate AI toolbar. */
export function GuidanceModeControl({ value, onChange, compact = false }: Props) {
  const id = useId();
  const helpId = `${id}-help`;
  const labelId = `${id}-label`;
  const choices = GUIDANCE_MODES.map((mode) => ({
    mode, label: guidanceCopy.modes[mode][0], description: guidanceCopy.modes[mode][1],
  }));
  if (compact) return (
    <div className="min-w-0 space-y-1 text-sm text-zinc-200">
      <label htmlFor={id} className="block font-medium">{guidanceCopy.title}</label>
      <select id={id} value={value} aria-describedby={helpId}
        onChange={(event) => onChange(event.target.value as GuidanceMode)}
        className="min-h-11 w-full min-w-0 rounded-md border border-white/15 bg-kestrel-panel px-2 text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300">
        {choices.map(({ mode, label }) => <option key={mode} value={mode}>{label}</option>)}
      </select>
      <p id={helpId} className="flex items-start gap-2 text-xs leading-relaxed text-zinc-400"><ModeIcon mode={value} />{guidanceCopy.modes[value][1]}</p>
    </div>
  );
  return (
    <fieldset className="min-w-0 space-y-2" aria-describedby={helpId}>
      <legend id={labelId} className="text-sm font-medium text-zinc-200">{guidanceCopy.title}</legend>
      <p id={helpId} className="text-xs leading-relaxed text-zinc-400">{guidanceCopy.help}</p>
      <div className="grid min-w-0 grid-cols-1 gap-2">
        {choices.map(({ mode, label, description }) => (
          <label key={mode} className="flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-md border border-white/15 p-3 text-sm text-zinc-100 has-[:checked]:border-sky-300 has-[:checked]:bg-sky-300/10 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-sky-300">
            <input type="radio" className="mt-1 h-4 w-4 shrink-0 accent-sky-300" name={id} value={mode}
              checked={value === mode} onChange={() => onChange(mode)} />
            <ModeIcon mode={mode} />
            <span className="min-w-0">
              <span className="block font-medium">{label}</span>
              <span className="block text-xs leading-relaxed text-zinc-400">{description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
