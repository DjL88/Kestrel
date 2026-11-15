import { useState } from 'react';
import { applyTheme, loadTheme } from '../providers/browserTheme';
import { THEMES, type ThemeName } from '../core/theme';

const LABELS: Record<ThemeName, string> = {
  default: 'Dark',
  night: 'Night (dimmer, softer)',
  contrast: 'High contrast',
};

export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeName>(loadTheme);
  return (
    <fieldset className="px-1 pb-2">
      <legend className="pb-1 text-sm text-zinc-300">Display</legend>
      {THEMES.map((name) => (
        <label key={name} className="flex min-h-9 items-center gap-2 text-sm">
          <input type="radio" name="kestrel-theme" checked={theme === name}
            onChange={() => { setTheme(name); applyTheme(name); }} />
          {LABELS[name]}
        </label>
      ))}
    </fieldset>
  );
}
