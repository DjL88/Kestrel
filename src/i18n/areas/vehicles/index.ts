import { localise, localiseFor, type AreaEntry } from '../../localise';
import { source } from './source';
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

const translations = { cy, gd, ga, fr, de, es, nl, it, pt, da, sv, nb, fi, is };

/** Vehicle and aircraft kinds and the wording around a guess, in the session's language. */
export const vehicleText = localise(source, translations);
/** British English, so a photo can also be found by its English words in any language. */
export const vehicleTextEnglish = localiseFor(source, translations, 'en-GB');

export const vehiclesArea: AreaEntry = { name: 'vehicles', source, translations };
