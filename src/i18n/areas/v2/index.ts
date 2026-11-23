import { localise, type AreaEntry, type AreaTranslations } from '../../localise';
import { source } from './source';

/**
 * Translations by language code. NOT registered in `AREAS` yet: the completeness test needs every full language to have a file,
 * and the V2 words have not been translated. Register `v2Area` in `src/i18n/areas/index.ts` once every language has its file.
 */
/** Translations by language code. Empty until each language is translated; untranslated words show in British English. */
const translations: AreaTranslations<typeof source> = {};

/** The V2 workspace's words in the session's language. */
export const v2Text = localise(source, translations);

export const v2Area = { name: 'v2', source, translations } satisfies AreaEntry;
