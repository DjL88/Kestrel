import { localise, type AreaEntry, type AreaTranslations } from '../../localise';
import { source } from './source';

/** Translations are added one file per language, as in the other areas; until then British English is shown. */
const translations: AreaTranslations<typeof source> = {};

export const colourText = localise(source, translations);
export const colourArea: AreaEntry = { name: 'colour', source, translations };
