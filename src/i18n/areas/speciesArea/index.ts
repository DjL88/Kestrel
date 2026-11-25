import { localise, localiseFor, type AreaEntry } from '../../localise';
import type { LanguageCode } from '../../../core/locale';
import { language } from '../../messages';
import { countryName } from '../../../core/places';
import { ALL_REGION_IDS, type SpeciesArea } from '../../../core/speciesArea';
import { normaliseRegions } from '../../../core/speciesRegions';
import { source } from './source';
import { enUS } from './en-US';
import { enCA } from './en-CA';
import { fr } from './fr';
import { de } from './de';
import { es } from './es';
import { nl } from './nl';
import { it } from './it';
import { pt } from './pt';
import { da } from './da';
import { sv } from './sv';
import { nb } from './nb';
import { fi } from './fi';
import { is } from './is';
import { cy } from './cy';
import { gd } from './gd';
import { ga } from './ga';

const translations = { 'en-US': enUS, 'en-CA': enCA, fr, de, es, nl, it, pt, da, sv, nb, fi, is, cy, gd, ga };

/** Words for where a project's photos were taken, in the session's language. */
export const speciesAreaText = localise(source, translations);

type Words = typeof speciesAreaText;

/** A region list in words ("Central and South America"); every region is "Worldwide". */
export function regionWords(ids: readonly string[], words: Words = speciesAreaText): string {
  const kept = normaliseRegions(ids);
  if (kept.length === ALL_REGION_IDS.length) return words.worldwide;
  return kept.map((id) => (words.regions as Record<string, string>)[id] ?? id).join(', ');
}

/** An area in the person's words: a country by its local name, a region by its name, the whole world as "Worldwide". */
export function areaWords(area: SpeciesArea, home: readonly string[], words: Words = speciesAreaText, code: string = language): string {
  if (area.kind === 'world') return words.worldwide;
  if (area.kind === 'country') return countryName(`place.country.${area.code.toLowerCase()}`, code) ?? area.code;
  if (area.kind === 'home') return words.home(regionWords(home, words));
  return regionWords(area.ids, words);
}

/** The same words for a given language, for tests and previews. */
export const speciesAreaTextFor = (code: LanguageCode) => localiseFor(source, translations, code);

export const speciesAreaArea: AreaEntry = { name: 'speciesArea', source, translations };
