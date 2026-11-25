/**
 * The email words in the recipient's language. They live with every other phrase in `src/i18n/areas/email/` (so the
 * wording audit in npm test checks each language is complete, not left in English, and plain), and are plain data, so
 * the control plane reads them directly. Same choice as the app's `localiseFor`: the exact language, then its base
 * language (fr-CA → fr), then British English for anything missing.
 */
import { LANGUAGES, mergeMessages } from '../../../src/core/locale.ts';
import { source } from '../../../src/i18n/areas/email/source.ts';
import { emailTranslations } from '../../../src/i18n/areas/email/index.ts';

export type MailWords = typeof source;
export const MAIL_LANGUAGES = LANGUAGES.map((l) => l.code) as [string, ...string[]];

const translations = emailTranslations as Record<string, Partial<MailWords> | undefined>;

export function mailWords(code: string | undefined): MailWords {
  const c = code && MAIL_LANGUAGES.includes(code) ? code : 'en-GB';
  const parent = c.includes('-') && !c.startsWith('en') ? c.split('-')[0] : undefined;
  const base = parent ? mergeMessages<MailWords>(source, translations[parent] as never) : source;
  return mergeMessages<MailWords>(base, translations[c] as never);
}

/** The value for an HTML lang attribute. */
export const htmlLang = (code: string | undefined) => (code && MAIL_LANGUAGES.includes(code) ? code : 'en-GB');
