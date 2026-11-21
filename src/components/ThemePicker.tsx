import { useState } from 'react';
import { applyDisplay, loadDisplay } from '../providers/browserTheme';
import { CALM_AND_CLEAR, DEFAULT_DISPLAY, DENSITIES, FONTS, SPACINGS, TEXT_SIZES, THEMES, isCalmAndClear, type DisplaySettings } from '../core/theme';
import { messages as m } from '../i18n/messages';
import { libraryText } from '../i18n/areas/library';

const THEME_LABELS = { default: m.settings.themeClassic, night: m.settings.themeSofter, contrast: m.settings.themeContrast } as const;
const SPACING_LABELS = { normal: m.settings.spacingNormal, roomy: m.settings.spacingRoomy } as const;
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
      <div>
        {/* One tap for the comfort options together; pressing it again returns to the standard look. */}
        <button type="button" aria-pressed={isCalmAndClear(settings)}
          onClick={() => update(isCalmAndClear(settings) ? DEFAULT_DISPLAY : CALM_AND_CLEAR)}
          className="min-h-11 w-full rounded-md border border-white/15 px-3 text-left text-sm font-medium text-zinc-100 aria-pressed:border-sky-200 aria-pressed:bg-sky-200/15 focus-visible:outline-2 focus-visible:outline-sky-300">
          {m.settings.calmPreset}{isCalmAndClear(settings) ? ' ✓' : ''}
        </button>
        <p className="mt-1 text-xs text-zinc-400">{m.settings.calmPresetHint}</p>
      </div>
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
      <fieldset>
        <legend className="pb-1 text-sm text-zinc-300">{m.settings.spacing}</legend>
        {SPACINGS.map((name) => (
          <label key={name} className={row}>
            <input type="radio" name="kestrel-spacing" checked={settings.spacing === name} onChange={() => update({ spacing: name })} />
            {SPACING_LABELS[name]}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend className="pb-1 text-sm text-zinc-300">{libraryText.density.legend}</legend>
        {DENSITIES.map((name) => (
          <label key={name} className={row}>
            <input type="radio" name="kestrel-density" checked={settings.density === name} onChange={() => update({ density: name })} />
            {libraryText.density[name]}
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
