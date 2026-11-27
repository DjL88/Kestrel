import React from 'react';
import { STRINGS } from '../strings';
import { createDefaultSizes } from '../stub';
import { canHideFormat, saveHiddenFormats, useHiddenFormats } from '../utils/formatVisibility';
import { PLATFORMS } from '../../../core/exportFormats';

const SOCIAL = new Set(PLATFORMS.map((platform) => platform.id as string));
const platformName = (id: string) => PLATFORMS.find((platform) => platform.id === id)?.label
  ?? (id === 'print' ? STRINGS.settings.formats.groupPrint : id === 'video' ? STRINGS.settings.formats.groupVideo : id);

/**
 * Settings › Export formats (Dave, 27 Nov): show or hide the ready-made formats, for example every social format for
 * someone who mostly prints, or all but Instagram. Kept on this device; hidden formats come back with one click.
 */
export default function ExportFormatsSettings() {
  const hidden = useHiddenFormats();
  const presets = React.useMemo(() => createDefaultSizes().filter(canHideFormat), []);
  const groups = React.useMemo(() => {
    const byPlatform = new Map<string, typeof presets>();
    for (const size of presets) byPlatform.set(size.platform, [...(byPlatform.get(size.platform) ?? []), size]);
    return [...byPlatform.entries()];
  }, [presets]);
  const set = (next: Set<string>) => saveHiddenFormats(next);
  const toggle = (id: string) => { const next = new Set(hidden); if (next.has(id)) next.delete(id); else next.add(id); set(next); };
  const T = STRINGS.settings.formats;
  return (
    <section className="space-y-3" aria-labelledby="settings-formats-heading" data-testid="settings-export-formats">
      <h3 id="settings-formats-heading" className="text-sm font-semibold text-[var(--text-primary)]">{STRINGS.settings.tabs.formats}</h3>
      <p className="text-xs text-[var(--text-secondary)]">{T.intro}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => set(new Set())} disabled={hidden.size === 0}
          className="min-h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-primary)] disabled:opacity-50">
          {T.showAll}
        </button>
        <button type="button" onClick={() => set(new Set([...hidden, ...presets.filter((size) => SOCIAL.has(size.platform)).map((size) => size.id)]))}
          className="min-h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-primary)]">
          {T.hideSocial}
        </button>
      </div>
      {groups.map(([platform, sizes]) => (
        <fieldset key={platform} className="space-y-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-2.5">
          <legend className="px-1 text-xs font-semibold text-[var(--text-primary)]">{platformName(platform)}</legend>
          {sizes.map((size) => (
            <label key={size.id} className="flex items-center justify-between gap-2 text-xs text-[var(--text-primary)]">
              <span className="min-w-0 truncate">{size.label} <span className="font-mono text-[0.625rem] text-[var(--text-muted)]">{size.width}×{size.height}</span></span>
              <input type="checkbox" checked={!hidden.has(size.id)} onChange={() => toggle(size.id)}
                aria-label={T.show(size.label)} data-testid={`settings-format-${size.id}`} />
            </label>
          ))}
        </fieldset>
      ))}
    </section>
  );
}
