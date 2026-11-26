import type { SpeciesArea } from '../../../core/speciesArea';
import { areaWords, regionWords, speciesAreaText as t } from '../../../i18n/areas/speciesArea';
import type { SpeciesPlace } from '../contract';

/**
 * The one small question, asked only when it matters: a photo looked like a species from outside the home region, or
 * the photos' GPS (read on this device) is somewhere else. Never blocks: it sits in a corner, any answer or "Not now"
 * closes it, and the answer is kept with the project. Nothing changes until the person taps a choice.
 */
export default function SpeciesPlacePrompt({ place, onChoose }: { place: SpeciesPlace | null | undefined; onChoose: (area: SpeciesArea) => void }) {
  const prompt = place?.prompt;
  if (!place || !prompt) return null;
  const button = 'min-h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-xs text-[var(--text-primary)]';
  return (
    <section aria-labelledby="species-place-prompt-title" data-testid="species-place-prompt"
      className="v2-safe-bottom v2-safe-right fixed bottom-24 right-4 z-[65] w-[min(22rem,calc(100vw-2rem))] rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 text-[var(--text-primary)] shadow-[var(--shadow-panel)]">
      <div className="flex items-start justify-between gap-2">
        <h2 id="species-place-prompt-title" className="text-sm font-semibold">{t.whereTaken}</h2>
        <button type="button" aria-label={t.notNow} title={t.notNow} onClick={() => onChoose({ kind: 'home' })}
          className="rounded px-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">×</button>
      </div>
      <p role="status" className="mt-1 text-xs text-[var(--text-secondary)]">
        {prompt.example ? t.promptOutside(prompt.example) : t.promptGps}
      </p>
      {prompt.suggestion && <p className="mt-1 text-[0.6875rem] text-[var(--text-secondary)]">{t.suggestionPrivacy}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {prompt.suggestion && (
          <button type="button" onClick={() => prompt.suggestion && onChoose(prompt.suggestion)}
            className={`${button} border-[var(--brand-accent)] font-medium text-[var(--brand-accent)]`}>{t.usePhotosPlace(areaWords(prompt.suggestion, place.home))}</button>
        )}
        <button type="button" onClick={() => onChoose({ kind: 'world' })} className={button}>{t.worldwide}</button>
        <button type="button" onClick={() => onChoose({ kind: 'home' })} className={button}>{t.home(regionWords(place.home))}</button>
      </div>
    </section>
  );
}
