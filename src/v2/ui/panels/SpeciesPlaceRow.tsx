import { useMemo } from 'react';
import { SPECIES_COUNTRIES, type SpeciesArea } from '../../../core/speciesArea';
import { SPECIES_REGIONS } from '../../../core/speciesRegions';
import { countryName } from '../../../core/places';
import { language } from '../../../i18n/messages';
import { areaWords, regionWords, speciesAreaText as t } from '../../../i18n/areas/speciesArea';
import type { SpeciesPlace } from '../contract';

const valueOf = (area: SpeciesArea): string =>
  area.kind === 'country' ? `country:${area.code}` : area.kind === 'regions' ? `regions:${area.ids.join(',')}` : area.kind;

function areaOf(value: string): SpeciesArea {
  if (value === 'world') return { kind: 'world' };
  if (value.startsWith('country:')) return { kind: 'country', code: value.slice(8) };
  if (value.startsWith('regions:')) return { kind: 'regions', ids: value.slice(8).split(',') };
  return { kind: 'home' };
}

/**
 * "Where were these taken?" for the open project, as a quiet setting in Info (never a question at start): home region,
 * worldwide, a region or a country. Species names are ranked against that place only. The question itself is asked
 * only when something points elsewhere (SpeciesPlacePrompt).
 */
export default function SpeciesPlaceRow({ place, onChange }: { place: SpeciesPlace; onChange: (area: SpeciesArea) => void }) {
  const countries = useMemo(() => {
    const collator = new Intl.Collator(language);
    return SPECIES_COUNTRIES.map((code) => ({ code, name: countryName(`place.country.${code.toLowerCase()}`, language) }))
      .filter((entry): entry is { code: string; name: string } => Boolean(entry.name))
      .sort((a, b) => collator.compare(a.name, b.name));
  }, []);
  const current = valueOf(place.area);
  // A choice of several regions (from a GPS suggestion) is not in the list of single regions, so it is shown as itself.
  const several = place.area.kind === 'regions' && place.area.ids.length > 1;

  return (
    <section aria-labelledby="species-place-title" data-testid="species-place" className="space-y-1.5">
      <label id="species-place-title" htmlFor="species-place" className="block text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{t.whereTaken}</label>
      <select id="species-place" value={current} onChange={(event) => onChange(areaOf(event.target.value))}
        className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-input)] px-2 py-1.5 text-xs text-[var(--text-primary)]">
        <option value="home">{t.home(regionWords(place.home))}</option>
        <option value="world">{t.worldwide}</option>
        {several && <option value={current}>{areaWords(place.area, place.home)}</option>}
        <optgroup label={t.regionsHeading}>
          {SPECIES_REGIONS.map((region) => <option key={region.id} value={`regions:${region.id}`}>{regionWords([region.id])}</option>)}
        </optgroup>
        <optgroup label={t.countriesHeading}>
          {countries.map((country) => <option key={country.code} value={`country:${country.code}`}>{country.name}</option>)}
        </optgroup>
      </select>
      <p className="text-[0.6875rem] leading-relaxed text-[var(--text-secondary)]">{t.whereTakenHint}</p>
    </section>
  );
}
