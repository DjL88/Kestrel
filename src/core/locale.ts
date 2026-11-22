/**
 * Languages InFlight can show, and the pure helpers behind them. British English is the source: every other language
 * is laid over it, so a sentence nobody has translated yet still appears, in British English, rather than a blank or
 * a code. Nothing here touches the browser; `src/i18n/messages.ts` reads the saved choice.
 */

/** `ready`: complete for the words it covers. `draft`: written without a native speaker's check, and labelled so. */
export type LanguageStatus = 'source' | 'ready' | 'draft';

export interface LanguageOption {
  /** BCP 47 tag, also used for dates and numbers and for `<html lang>`, so screen readers pronounce words correctly. */
  code: string;
  /** The language's name in itself, so someone who can't read the current language can still find their own. */
  nativeName: string;
  /** The name in British English, shown beside the native name. */
  englishName: string;
  status: LanguageStatus;
}

export const LANGUAGES = [
  { code: 'en-GB', nativeName: 'English (UK)', englishName: 'English (UK)', status: 'source' },
  { code: 'en-US', nativeName: 'English (US)', englishName: 'English (US)', status: 'ready' },
  { code: 'en-CA', nativeName: 'English (Canada)', englishName: 'English (Canada)', status: 'ready' },
  { code: 'en-AU', nativeName: 'English (Australia)', englishName: 'English (Australia)', status: 'ready' },
  { code: 'en-NZ', nativeName: 'English (New Zealand)', englishName: 'English (New Zealand)', status: 'ready' },
  { code: 'cy', nativeName: 'Cymraeg', englishName: 'Welsh', status: 'draft' },
  { code: 'gd', nativeName: 'Gàidhlig', englishName: 'Scottish Gaelic', status: 'draft' },
  { code: 'fr', nativeName: 'Français', englishName: 'French', status: 'draft' },
  { code: 'fr-CA', nativeName: 'Français (Canada)', englishName: 'French (Canada)', status: 'draft' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German', status: 'draft' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish', status: 'draft' },
  { code: 'nl', nativeName: 'Nederlands', englishName: 'Dutch', status: 'draft' },
  { code: 'it', nativeName: 'Italiano', englishName: 'Italian', status: 'draft' },
  { code: 'pt', nativeName: 'Português', englishName: 'Portuguese', status: 'draft' },
  { code: 'ga', nativeName: 'Gaeilge', englishName: 'Irish', status: 'draft' },
  { code: 'da', nativeName: 'Dansk', englishName: 'Danish', status: 'draft' },
  { code: 'sv', nativeName: 'Svenska', englishName: 'Swedish', status: 'draft' },
  { code: 'nb', nativeName: 'Norsk bokmål', englishName: 'Norwegian', status: 'draft' },
  { code: 'fi', nativeName: 'Suomi', englishName: 'Finnish', status: 'draft' },
  { code: 'is', nativeName: 'Íslenska', englishName: 'Icelandic', status: 'draft' },
] as const satisfies readonly LanguageOption[];

export type LanguageCode = (typeof LANGUAGES)[number]['code'];
export const SOURCE_LANGUAGE: LanguageCode = 'en-GB';

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && LANGUAGES.some((language) => language.code === value);
}

/**
 * The language to show. Only a choice the person made counts: InFlight never switches language because a browser or
 * operating system reports another one, so the app always looks the same until they change it themselves.
 */
export function resolveLanguage(saved: unknown): LanguageCode {
  return isLanguageCode(saved) ? saved : SOURCE_LANGUAGE;
}

/** The welcome is an explicit first-run choice, including on British-English devices. */
export function needsLanguageSetup(saved: unknown): boolean {
  return !isLanguageCode(saved);
}

/** Other tags that mean one of InFlight's languages: Norwegian has three codes, and Nynorsk readers read Bokmål. */
const ALIASES: Record<string, LanguageCode> = { no: 'nb', nn: 'nb' };

/**
 * The device's own language, matched to one InFlight has, to *offer* at first run (never applied without asking).
 * Tries each of the device's preferred languages in order: the exact tag (en-US), then its language (fr-BE → fr,
 * pt-BR → pt, nb-NO → nb). Australia, New Zealand and Canadian French retain their own choices.
 * Other English regions use UK wording; an unsupported device language is not silently selected.
 */
export function matchDeviceLanguage(preferred: readonly string[] | undefined): LanguageCode | undefined {
  for (const raw of preferred ?? []) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const tag = raw.trim().replace(/_/g, '-');
    const exact = LANGUAGES.find((language) => language.code.toLowerCase() === tag.toLowerCase());
    if (exact) return exact.code;
    const parts = tag.toLowerCase().split('-');
    const base = parts[0];
    // BCP-47 may include script before region (e.g. fr-Latn-CA).
    const region = parts.find((part) => /^[a-z]{2}$/.test(part) && part !== base);
    if (base === 'en') {
      if (region === 'au') return 'en-AU';
      if (region === 'nz') return 'en-NZ';
      if (region === 'us') return 'en-US';
      if (region === 'ca') return 'en-CA';
      return 'en-GB';
    }
    if (base === 'fr' && region === 'ca') return 'fr-CA';
    const byBase = LANGUAGES.find((language) => language.code === base) ?? (ALIASES[base] ? languageOption(ALIASES[base]) : undefined);
    if (byBase) return byBase.code as LanguageCode;
  }
  return undefined;
}

/**
 * Choose the right word for a number in the active language (Welsh has six forms, Irish five, English two).
 * Forms not given fall back to `other`.
 */
export function plural(count: number, forms: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }): string {
  const rule = new Intl.PluralRules(active).select(count);
  return forms[rule] ?? forms.other;
}

export function languageOption(code: LanguageCode): LanguageOption {
  return LANGUAGES.find((language) => language.code === code) ?? LANGUAGES[0];
}

/** String literals become `string`; functions keep their arguments. Translations must match this shape. */
export type Widen<T> = T extends string ? string
  : T extends (...args: infer A) => string ? (...args: A) => string
  : { [K in keyof T]: Widen<T[K]> };

export type DeepPartial<T> = T extends string | ((...args: never[]) => string) ? T : { [K in keyof T]?: DeepPartial<T[K]> };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Lays a translation over the source. Missing, empty or wrongly shaped entries keep the source wording. */
export function mergeMessages<T>(source: T, translation: DeepPartial<T> | undefined): T {
  if (!translation || !isPlainObject(source) || !isPlainObject(translation)) return source;
  const result: Record<string, unknown> = { ...source };
  for (const [key, original] of Object.entries(source)) {
    const translated = (translation as Record<string, unknown>)[key];
    if (translated === undefined) continue;
    if (isPlainObject(original)) result[key] = mergeMessages(original, translated as never);
    else if (typeof original === 'string' && typeof translated === 'string' && translated.trim()) result[key] = translated;
    else if (typeof original === 'function' && typeof translated === 'function') result[key] = translated;
  }
  return result as T;
}

/** Dotted paths of a translation that do not exist in the source: a typo or a removed sentence. */
export function unknownKeys(source: unknown, translation: unknown, prefix = ''): string[] {
  if (!isPlainObject(translation)) return [];
  return Object.entries(translation).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const original = isPlainObject(source) ? source[key] : undefined;
    if (original === undefined) return [path];
    if (isPlainObject(value)) return unknownKeys(original, value, path);
    return typeof value === typeof original ? [] : [path];
  });
}

/** Dotted paths of the source that a translation leaves in British English. */
export function missingKeys(source: unknown, translation: unknown, prefix = ''): string[] {
  if (!isPlainObject(source)) return [];
  return Object.entries(source).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const translated = isPlainObject(translation) ? translation[key] : undefined;
    if (isPlainObject(value)) return missingKeys(value, translated, path);
    return translated === undefined ? [path] : [];
  });
}

let active: LanguageCode = SOURCE_LANGUAGE;

/** Set once at start-up by `src/i18n/messages.ts`. Changing language reloads the app. */
export function setActiveLanguage(code: LanguageCode) {
  active = code;
}

/** The tag for dates and numbers, e.g. "19 Nov 2026" in British English and "Nov 19, 2026" in US English. */
export function activeLanguage(): LanguageCode {
  return active;
}
