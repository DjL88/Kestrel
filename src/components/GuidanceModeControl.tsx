import { GUIDANCE_CHOICES, type GuidanceMode } from '../core/guidanceMode';

interface Props {
  value: GuidanceMode;
  onChange: (mode: GuidanceMode) => void;
  compact?: boolean;
}

/** Shared by View and Settings. There is no separate AI toolbar or wizard. */
export function GuidanceModeControl({ value, onChange, compact = false }: Props) {
  if (compact) return (
    <label className="flex min-h-11 items-center justify-between gap-2 text-sm text-zinc-200">
      <span>Photographic guidance</span>
      <select aria-label="Photographic guidance" value={value}
        onChange={(event) => onChange(event.target.value as GuidanceMode)}
        className="min-h-10 max-w-[9.5rem] rounded-md border border-white/15 bg-kestrel-panel px-2 text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-300">
        {GUIDANCE_CHOICES.map(({ value: id, label }) => <option key={id} value={id}>{label}</option>)}
      </select>
    </label>
  );
  return (
    <fieldset className="space-y-2" aria-describedby="kestrel-guidance-help">
      <legend className="text-sm font-medium text-zinc-200">Photographic guidance</legend>
      <p id="kestrel-guidance-help" className="text-xs text-zinc-400">Choose how much help Kestrel offers as you work. Every edit remains yours.</p>
      <div className="grid grid-cols-1 gap-1.5">
        {GUIDANCE_CHOICES.map(({ value: id, label, description }) => (
          <label key={id} className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md border border-white/15 p-2 text-sm text-zinc-100 has-[:checked]:border-sky-300 has-[:checked]:bg-sky-300/10">
            <input type="radio" className="mt-1 accent-sky-300" name="kestrel-guidance" value={id}
              checked={value === id} onChange={() => onChange(id)} />
            <span className="block">
              <span className="font-medium">{label}</span>
              <span className="block text-xs text-zinc-400">{description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
