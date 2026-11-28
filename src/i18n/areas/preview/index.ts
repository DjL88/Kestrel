import { localise, localiseFor, type AreaEntry } from '../../localise';
import type { LanguageCode } from '../../../core/locale';
import { source } from './source';
import { enUS } from './en-US';
import { enCA } from './en-CA';
import { cy } from './cy';
import { gd } from './gd';
import { ga } from './ga';
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

const translations = { 'en-US': enUS, 'en-CA': enCA, cy, gd, ga, fr, de, es, nl, it, pt, da, sv, nb, fi, is };

/** Words for Settings → Preview features, in the session's language. */
export const previewText = localise(source, translations);

/** The same words for a given language, for tests and previews. */
export const previewTextFor = (code: LanguageCode) => localiseFor(source, translations, code);

export const previewArea: AreaEntry = { name: 'preview', source, translations };
