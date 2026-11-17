import { useState } from 'react';
import { applyDisplay, loadDisplay } from '../providers/browserTheme';
import { FONTS, TEXT_SIZES, THEMES, type DisplaySettings } from '../core/theme';

const THEME_LABELS = { default: 'Classic dark', night: 'Softer dark (default)', contrast: 'High contrast' } as const;
const FONT_LABELS = { brand: 'Kestrel (Plus Jakarta Sans)', readable: 'Easy to read (Atkinson Hyperlegible)' } as const;

export function ThemePicker() {
  const [settings, setSettings] = useState<DisplaySettings>(loadDisplay);
  const update = (patch: Partial<DisplaySettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    applyDisplay(next);
  };
  const row = 'flex min-h-9 items-center gap-2 text-sm';
  return (
    <div className="space-y-2 px-1 pb-2">
      <fieldset>
        <legend className="pb-1 text-sm text-zinc-300">Display</legend>
        {THEMES.map((name) => (
          <label key={name} className={row}>
            <input type="radio" name="kestrel-theme" checked={settings.theme === name} onChange={() => update({ theme: name })} />
            {THEME_LABELS[name]}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend className="pb-1 text-sm text-zinc-300">Text size</legend>
        {TEXT_SIZES.map((size) => (
          <label key={size} className={row}>
            <input type="radio" name="kestrel-text-size" checked={settings.textSize === size} onChange={() => update({ textSize: size })} />
            {size}%
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend className="pb-1 text-sm text-zinc-300">Typeface</legend>
        {FONTS.map((name) => (
          <label key={name} className={row}>
            <input type="radio" name="kestrel-font" checked={settings.font === name} onChange={() => update({ font: name })} />
            {FONT_LABELS[name]}
          </label>
        ))}
      </fieldset>
      <label className={row}>
        <input type="checkbox" checked={settings.calm} onChange={(event) => update({ calm: event.target.checked })} />
        Reduced stimulation (no animation)
      </label>
    </div>
  );
}
