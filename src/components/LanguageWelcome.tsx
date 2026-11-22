import { useId, useState } from 'react';
import { Languages } from './icons/KestrelUIIcons';
import { LANGUAGES, isLanguageCode, languageOption, mergeMessages, SOURCE_LANGUAGE, type LanguageCode } from '../core/locale';
import { enGB } from '../i18n/en-GB';
import { chooseLanguage, deviceLanguage, keepLanguage, language, languageIsChosen, TRANSLATIONS, type Messages } from '../i18n/messages';

/** Every first launch offers a choice, including UK English or unsupported device locales. */
export function shouldOfferLanguage(): boolean {
  return !languageIsChosen();
}

/**
 * The first step of setting up InFlight: the device's language is suggested, in that language and in English, and
 * nothing changes until the person picks. It shows once; Settings → Language changes it later.
 */
export function LanguageWelcome() {
  const id = useId();
  const [hidden, setHidden] = useState(false);
  const [pending, setPending] = useState<LanguageCode>(deviceLanguage ?? SOURCE_LANGUAGE);
  if (hidden || !shouldOfferLanguage()) return null;
  const device = deviceLanguage ? languageOption(deviceLanguage) : null;
  const chosen = languageOption(pending);
  // Written in the language being offered, so its speaker can read the card before choosing.
  const words = mergeMessages<Messages>(enGB, TRANSLATIONS[pending]).setup;
  const deviceWords = mergeMessages<Messages>(enGB, deviceLanguage ? TRANSLATIONS[deviceLanguage] : undefined).setup;
  return (
    <section aria-labelledby={`${id}-title`} lang={chosen.code}
      className="mb-5 rounded-xl border border-kestrel-blue/50 bg-kestrel-raised p-4">
      <h2 id={`${id}-title`} className="flex items-center gap-2 text-base font-semibold text-zinc-100">
        <Languages className="h-5 w-5 text-zinc-300" aria-hidden="true" />{words.welcome}
      </h2>
      {device && <p className="mt-1 text-sm text-zinc-300">{deviceWords.detected(device.nativeName)}</p>}
      <label htmlFor={id} className="mt-3 block text-sm text-zinc-200">
        {words.question}{words.question !== enGB.setup.question && <span lang="en-GB" className="text-zinc-400"> ({enGB.setup.question})</span>}
      </label>
      <select id={id} value={pending} onChange={(event) => { if (isLanguageCode(event.target.value)) setPending(event.target.value); }}
        className="mt-1 min-h-11 w-full max-w-sm rounded-md border border-white/15 bg-kestrel-panel px-2 text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-300">
        {LANGUAGES.map((option) => (
          <option key={option.code} value={option.code} lang={option.code}>
            {option.nativeName === option.englishName ? option.nativeName : `${option.nativeName} (${option.englishName})`}
          </option>
        ))}
      </select>
      {chosen.status === 'draft' && <p className="mt-2 text-xs text-zinc-400"><span aria-hidden="true">✎ </span>{mergeMessages<Messages>(enGB, TRANSLATIONS[pending]).settings.draft}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => (pending === language ? (keepLanguage(), setHidden(true)) : chooseLanguage(pending))}
          className="min-h-11 rounded-md bg-kestrel-copper px-4 text-sm font-semibold text-zinc-950 hover:bg-kestrel-copper-hover focus-visible:outline-2 focus-visible:outline-sky-300">
          {words.continueIn(chosen.nativeName)}
        </button>
        {pending !== language && (
          <button type="button" lang="en-GB" onClick={() => { keepLanguage(); setHidden(true); }}
            className="min-h-11 rounded-md border border-white/15 px-4 text-sm text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300">
            {enGB.setup.keepSource}
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-zinc-400">{words.later}</p>
    </section>
  );
}
