import { useState } from 'react';
import { applyDisplay, loadDisplay } from '../providers/browserTheme';
import { FONTS, TEXT_SIZES, THEMES, type DisplaySettings } from '../core/theme';
import { messages as m } from '../i18n/messages';

const THEME_LABELS = { default: m.settings.themeClassic, night: m.settings.themeSofter, contrast: m.settings.themeContrast } as const;
const FONT_LABELS = { brand: m.settings.fontBrand, readable: m.settings.fontReadable } as const;

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
        <legend className="pb-1 text-sm text-zinc-300">{m.settings.display}</legend>
        {THEMES.map((name) => (
          <label key={name} className={row}>
            <input type="radio" name="kestrel-theme" checked={settings.theme === name} onChange={() => update({ theme: name })} />
            {THEME_LABELS[name]}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend className="pb-1 text-sm text-zinc-300">{m.settings.textSize}</legend>
        {TEXT_SIZES.map((size) => (
          <label key={size} className={row}>
            <input type="radio" name="kestrel-text-size" checked={settings.textSize === size} onChange={() => update({ textSize: size })} />
            {size}%
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend className="pb-1 text-sm text-zinc-300">{m.settings.typeface}</legend>
        {FONTS.map((name) => (
          <label key={name} className={row}>
            <input type="radio" name="kestrel-font" checked={settings.font === name} onChange={() => update({ font: name })} />
            {FONT_LABELS[name]}
          </label>
        ))}
      </fieldset>
      <label className={row}>
        <input type="checkbox" checked={settings.calm} onChange={(event) => update({ calm: event.target.checked })} />
        {m.settings.calm}
      </label>
    </div>
  );
}
