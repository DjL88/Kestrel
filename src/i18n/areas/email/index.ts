import type { AreaEntry } from '../../localise';
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

/** Every language of the email words. The control plane picks one per recipient (mailText.ts). */
export const emailTranslations = { cy, gd, ga, fr, de, es, nl, it, pt, da, sv, nb, fi, is };

export const emailArea: AreaEntry = { name: 'email', source, translations: emailTranslations };
