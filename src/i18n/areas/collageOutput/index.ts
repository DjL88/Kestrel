import { localise, localiseFor, type AreaEntry } from '../../localise';
import type { LanguageCode } from '../../../core/locale';
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

/** Words for collage export choices, in the session's language. */
export const collageOutputText = localise(source, translations);

/** The same words for a given language, for tests and previews. */
export const collageOutputTextFor = (code: LanguageCode) => localiseFor(source, translations, code);

export const collageOutputArea: AreaEntry = { name: 'collageOutput', source, translations };
