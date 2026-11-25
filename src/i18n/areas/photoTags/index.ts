import { localise, type AreaEntry } from '../../localise';
import { source } from './source';
import { language } from '../../messages';
import { countryName } from '../../../core/places';
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

/** Photo tag words (places, light, weather, style, genre, vehicles) in the session's language. */
export const photoTagsText = localise(source, translations);

/** The words for a tag id in the session's language, or undefined when there are none (then the tag is not shown). */
export const photoTagLabel = (id: string): string | undefined =>
  (photoTagsText.tags as Record<string, string>)[id] ?? countryName(id, language);
/** The same in British English, so search finds a tag in either language. */
export const photoTagEnglishLabel = (id: string): string | undefined =>
  (source.tags as Record<string, string>)[id] ?? countryName(id, 'en-GB');

export const photoTagsArea: AreaEntry = { name: 'photoTags', source, translations };
