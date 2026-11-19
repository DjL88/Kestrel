import { LanguagePicker } from './LanguagePicker';
import { ThemePicker } from './ThemePicker';
import { messages as m } from '../i18n/messages';

interface Props {
  side: 'left' | 'right';
  onSideChange: (side: 'left' | 'right') => void;
  hand?: 'left' | 'right';
  onHandChange?: (hand: 'left' | 'right') => void;
}

/**
 * One choice, not two: which hand you use decides where the editing tools sit on a wide screen and where the touch
 * controls sit on a phone, in the Library and the editor alike. (There used to be a separate "Editing panel position"
 * that looked like the same question.)
 */
export function AppearanceSettings({ side, onSideChange, hand, onHandChange }: Props) {
  return (
    <div className="space-y-3 px-1 pb-2">
      {hand && onHandChange ? (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-zinc-200">{m.settings.preferredHand}</legend>
          <p className="text-xs text-zinc-400">{m.settings.handHint}</p>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Preferred hand">
            {(['left', 'right'] as const).map((choice) => (
              <button key={choice} type="button" aria-pressed={hand === choice} onClick={() => onHandChange(choice)}
                className="min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-200 aria-pressed:border-sky-200 aria-pressed:bg-sky-200/15 focus-visible:outline-2 focus-visible:outline-sky-300">
                {choice === 'left' ? m.settings.leftHanded : m.settings.rightHanded}{hand === choice ? ' ✓' : ''}
              </button>
            ))}
          </div>
        </fieldset>
      ) : (
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-zinc-200">Editing panel position</legend>
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
      )}
      <ThemePicker />
      <LanguagePicker />
    </div>
  );
}
