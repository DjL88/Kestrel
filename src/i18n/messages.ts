import {
  mergeMessages, resolveLanguage, setActiveLanguage,
  type DeepPartial, type LanguageCode, type Widen,
} from '../core/locale';
import { enGB } from './en-GB';
import { cy } from './locales/cy';
import { de } from './locales/de';
import { enCA } from './locales/en-CA';
import { enUS } from './locales/en-US';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { gd } from './locales/gd';
import { it } from './locales/it';
import { nl } from './locales/nl';
import { pt } from './locales/pt';

/** Every sentence Kestrel shows, in the shape of the British English source. */
export type Messages = Widen<typeof enGB>;
/** A language file: any part of the source, translated. Anything left out stays in British English. */
export type Translation = DeepPartial<Messages>;

export const TRANSLATIONS: Record<LanguageCode, Translation> = {
  'en-GB': {}, 'en-US': enUS, 'en-CA': enCA, cy, gd, fr, de, es, nl, it, pt,
};

export const LANGUAGE_STORAGE_KEY = 'kestrel-language';

function savedLanguage(): unknown {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return undefined;
  }
}

/** The language in use for this session. It changes only when the person chooses one (and the app reloads). */
export const language: LanguageCode = resolveLanguage(savedLanguage());
setActiveLanguage(language);
if (typeof document !== 'undefined') document.documentElement.lang = language;

export const messages: Messages = mergeMessages<Messages>(enGB, TRANSLATIONS[language]);
export const formatCount = new Intl.NumberFormat(language);

/** Saves the choice and restarts the interface in it. Work is saved as it happens, so nothing is lost. */
export function chooseLanguage(code: LanguageCode) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch {
    return; // storage blocked: keep the current language rather than reload into the same one
  }
  if (code !== language) window.location.reload();
}
