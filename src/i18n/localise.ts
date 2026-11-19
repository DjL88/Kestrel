import { mergeMessages, type DeepPartial, type LanguageCode, type Widen } from '../core/locale';
import { language } from './messages';

/** One language's version of an area's words. Anything left out stays in British English. */
export type AreaTranslation<Source> = DeepPartial<Widen<Source>>;
export type AreaTranslations<Source> = Partial<Record<LanguageCode, AreaTranslation<Source>>>;

/** Every area registered for the completeness tests: name, British English source and its translations. */
export interface AreaEntry {
  name: string;
  source: unknown;
  translations: Partial<Record<LanguageCode, unknown>>;
}

/**
 * The words for one area of the app (the editor, export, …) in the language chosen for this session. Each area keeps
 * its British English source and its translations in its own folder under `src/i18n/areas/`, so areas can be
 * translated separately, and untranslated words always fall back to British English.
 */
export function localise<Source>(source: Source, translations: AreaTranslations<Source>): Widen<Source> {
  return mergeMessages<Widen<Source>>(source as Widen<Source>, translations[language]);
}
