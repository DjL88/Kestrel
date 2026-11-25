import { useState } from 'react';
import { FONTS, SPACINGS, TEXT_SIZES, type DisplaySettings } from '../../../core/theme';
import { messages as m } from '../../../i18n/messages';
import { applyDisplay, loadDisplay } from '../../../providers/browserTheme';

/**
 * Settings > Appearance: text size, typeface and text spacing. These are the same device settings the previous app
 * used (one home, one store), so a choice made in either carries over. Text size scales every V2 label, button and bar,
 * because V2 sizes them in rem; the photograph and its overlays are not scaled.
 */

const FONT_LABELS = { brand: m.settings.fontBrand, readable: m.settings.fontReadable } as const;
const SPACING_LABELS = { normal: m.settings.spacingNormal, roomy: m.settings.spacingRoomy } as const;

const option = (on: boolean) => `min-h-9 rounded-[var(--radius-sm)] border px-3 py-1.5 text-left text-xs font-medium transition-colors ${
  on ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--text-primary)]'
    : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`;

export default function ReadingSettings() {
  const [display, setDisplay] = useState<DisplaySettings>(() => loadDisplay());
  const update = (patch: Partial<DisplaySettings>) => {
    const next = { ...display, ...patch };
    setDisplay(next);
    applyDisplay(next);
  };

  return (
    <section className="space-y-4" aria-label={m.settings.display}>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs font-semibold text-[var(--text-primary)]">{m.settings.textSize}</legend>
        <div className="grid grid-cols-3 gap-2">
          {TEXT_SIZES.map((size) => (
            <button key={size} type="button" aria-pressed={display.textSize === size} onClick={() => update({ textSize: size })}
              className={option(display.textSize === size)}>
              <span style={{ fontSize: `${Number(size) / 100 * 0.75}rem` }}>{size}%</span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs font-semibold text-[var(--text-primary)]">{m.settings.typeface}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {FONTS.map((font) => (
            <button key={font} type="button" aria-pressed={display.font === font} onClick={() => update({ font })}
              className={option(display.font === font)}
              style={{ fontFamily: font === 'readable' ? '"Atkinson Hyperlegible", sans-serif' : 'var(--font-sans)' }}>
              {FONT_LABELS[font]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs font-semibold text-[var(--text-primary)]">{m.settings.spacing}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {SPACINGS.map((spacing) => (
            <button key={spacing} type="button" aria-pressed={display.spacing === spacing} onClick={() => update({ spacing })}
              className={option(display.spacing === spacing)}>
              {SPACING_LABELS[spacing]}
            </button>
          ))}
        </div>
      </fieldset>
    </section>
  );
}
