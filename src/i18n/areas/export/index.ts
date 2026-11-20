import { localise, type AreaEntry } from '../../localise';
import { source } from './source';
import { cy } from './cy';
import { da } from './da';
import { de } from './de';
import { enCA } from './en-CA';
import { enUS } from './en-US';
import { es } from './es';
import { fi } from './fi';
import { fr } from './fr';
import { ga } from './ga';
import { gd } from './gd';
import { is } from './is';
import { it } from './it';
import { nb } from './nb';
import { nl } from './nl';
import { pt } from './pt';
import { sv } from './sv';

const translations = { 'en-US': enUS, 'en-CA': enCA, cy, gd, ga, fr, de, es, nl, it, pt, da, sv, nb, fi, is };

/** Export's words in the session language. */
export const exportText = localise(source, translations);

export const exportArea: AreaEntry = { name: 'export', source, translations };
