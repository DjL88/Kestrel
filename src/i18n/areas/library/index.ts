import { localise, type AreaEntry } from '../../localise';
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

/** The library's words (workspace bar, grid, filmstrip, culling, filters, tasks, auto-cull) in the session's language. */
export const libraryText = localise(source, translations);

export const libraryArea: AreaEntry = { name: 'library', source, translations };
