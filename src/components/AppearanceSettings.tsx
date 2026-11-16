import { ThemePicker } from './ThemePicker';

interface Props {
  side: 'left' | 'right';
  onSideChange: (side: 'left' | 'right') => void;
}

/** One persistent handedness setting shared by Library and Editor on every device. */
export function AppearanceSettings({ side, onSideChange }: Props) {
  return (
    <div className="space-y-3 px-1 pb-2">
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-zinc-200">Editing tools</legend>
        <p className="text-xs text-zinc-400">Choose which side is most comfortable on a wide screen. On a phone, tools stay below the photo.</p>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Editing tools side">
          {(['left', 'right'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={side === value}
              onClick={() => onSideChange(value)}
              className="min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-200 focus-visible:outline-2 focus-visible:outline-sky-300 aria-pressed:border-sky-200 aria-pressed:bg-sky-200/15 aria-pressed:font-semibold">
              {value === 'left' ? 'Left side' : 'Right side'}{side === value ? ' ✓' : ''}
            </button>
          ))}
        </div>
      </fieldset>
      <ThemePicker />
    </div>
  );
}
