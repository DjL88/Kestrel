import { useId, useState } from 'react';
import { Languages } from './icons/KestrelUIIcons';
import { LANGUAGES, isLanguageCode, languageOption, mergeMessages, type LanguageCode } from '../core/locale';
import { enGB } from '../i18n/en-GB';
import { chooseLanguage, language, messages as m, TRANSLATIONS, type Messages } from '../i18n/messages';

/**
 * Choose the language. Each language is listed by its own name, so someone who can't read the current one can still
 * find theirs, and the label always says "Language" in English too. Nothing changes until "Restart in …" is pressed.
 */
export function LanguagePicker() {
  const id = useId();
  const [pending, setPending] = useState<LanguageCode>(language);
  const current = languageOption(language);
  const chosen = languageOption(pending);
  // Words for the restart button and draft note come from the language being chosen, so its speaker can read them.
  const chosenWords = mergeMessages<Messages>(enGB, TRANSLATIONS[pending]).settings;
  return (
    <div className="space-y-2 px-1 pb-3">
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium text-zinc-200">
        <Languages className="h-4 w-4 text-zinc-400" aria-hidden="true" />
        {m.settings.language}{m.settings.language !== 'Language' && <span className="font-normal text-zinc-400">(Language)</span>}
      </label>
      <select id={id} value={pending} onChange={(event) => { if (isLanguageCode(event.target.value)) setPending(event.target.value); }}
        className="min-h-11 w-full rounded-md border border-white/15 bg-kestrel-raised px-2 text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-300">
        {LANGUAGES.map((option) => (
          <option key={option.code} value={option.code} lang={option.code}>
            {option.nativeName === option.englishName ? option.nativeName : `${option.nativeName} (${option.englishName})`}
          </option>
        ))}
      </select>
      {chosen.status === 'draft' && (
        <p lang={chosen.code} className="flex gap-2 rounded-md border border-white/15 px-2 py-1.5 text-xs text-zinc-300">
          <span aria-hidden="true">✎</span>{chosenWords.draft}
        </p>
      )}
      {pending !== current.code ? (
        <div className="space-y-1">
          <p lang={chosen.code} className="text-xs text-zinc-400">{chosenWords.languageHint}</p>
          <button type="button" lang={chosen.code} onClick={() => chooseLanguage(pending)}
            className="min-h-11 w-full rounded-md bg-kestrel-copper px-3 text-sm font-semibold text-zinc-950 hover:bg-kestrel-copper-hover focus-visible:outline-2 focus-visible:outline-sky-300">
            {chosenWords.restartIn(chosen.nativeName)}
          </button>
        </div>
      ) : null}
    </div>
  );
}
