import { useEffect, useId, useRef, useState } from 'react';
import { STRINGS } from '../strings';
import { LANGUAGES, type LanguageCode } from '../../../core/locale';
import { chooseLanguage, deviceLanguage, keepLanguage, language, languageIsChosen } from '../../../i18n/messages';
import {
  extraKey, nextStep, previousStep, SETUP_EXPERIENCE, SETUP_GENRES, SETUP_STEPS, suggestedExtras, suggestedFlightMode, tailoredSettings,
  type SetupAnswers, type SetupExperience, type SetupFlightMode, type SetupGenre, type SetupStep,
} from '../../../core/quickSetup';
import { PRO_PLAN_CHOICES } from '../../../core/proCheckout';
import { readSetup, saveSetupToAccount, writeSetup } from '../../../providers/quickSetupMemory';
import { requestSetupResult } from '../../setupBridge';
import FlightModePicker from '../panels/FlightModePicker';
import { buttonClass } from './LaunchSignInPanel';
import type { SettingsTabId } from '../contract';

const t = STRINGS.setup;
const choice = (on: boolean) => `flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border-2 px-3 py-2 text-left text-sm ${
  on ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] font-semibold' : 'border-[var(--border-subtle)] bg-[var(--bg-input)]'}`;
const link = 'min-h-11 px-2 text-sm text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]';

interface Extra { id: string; role: string; title: string; why: string; bytes: number; download: () => Promise<void> }

/** The optional AI extras this build offers and this device has not got yet (bundled ones report 'built-in'). */
async function offeredExtras(): Promise<Extra[]> {
  const [{ MODEL_CATALOGUE }, { optionalModelBytes }] = await Promise.all([import('../../../providers/modelCatalogue'), import('../../../core/optionalModels')]);
  const roles = STRINGS.models.role as Record<string, string>;
  const whys = (STRINGS.models as { why?: Record<string, string> }).why;
  const out: Extra[] = [];
  for (const entry of MODEL_CATALOGUE) {
    if (!entry.pack) continue;
    const place = await entry.place().catch(() => 'not-offered' as const);
    if (place !== 'not-downloaded') continue;
    const pack = entry.pack;
    out.push({
      id: entry.id, role: extraKey(entry.role), title: roles[entry.role] ?? pack.model.name,
      why: whys?.[entry.role] ?? pack.model.job, bytes: optionalModelBytes(pack.model),
      download: () => pack.download(() => undefined),
    });
  }
  return out;
}

/**
 * Quick setup (src/core/quickSetup.ts): six short steps, each skippable, with Skip setup always on screen. Used by the
 * launch welcome at first run and from Settings → Account (Run quick setup again). `signedInName` is null for a guest
 * (the cloud step then offers sign-in through `onSignIn`), or the name (or '') once signed in.
 */
export default function QuickSetup({ online, signedInName, onSignIn, onClose }: {
  online: boolean;
  signedInName: string | null;
  onSignIn?: () => void;
  onClose: () => void;
}) {
  const saved = useRef<SetupAnswers>(readSetup() ?? { status: 'in-progress' });
  const [step, setStep] = useState<SetupStep>(saved.current.status === 'in-progress' && saved.current.step ? saved.current.step : 'language');
  const [lang, setLang] = useState<LanguageCode>(() => (languageIsChosen() ? language : deviceLanguage ?? language));
  const [genres, setGenres] = useState<SetupGenre[]>(saved.current.genres ?? []);
  const [experience, setExperience] = useState<SetupExperience | undefined>(saved.current.experience);
  const [proWanted, setProWanted] = useState(false);
  const [drivesWanted, setDrivesWanted] = useState(false);
  const [cloud, setCloud] = useState<SetupAnswers['cloud']>(signedInName !== null ? 'account' : saved.current.cloud);
  const [mode, setMode] = useState<SetupFlightMode | undefined>(saved.current.flightMode);
  const [extras, setExtras] = useState<Extra[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const langId = useId();

  useEffect(() => { if (signedInName !== null) setCloud('account'); }, [signedInName]);
  useEffect(() => { headingRef.current?.focus(); }, [step]);
  useEffect(() => {
    if (step !== 'extras' || extras) return;
    let live = true;
    void offeredExtras().catch(() => []).then((list) => {
      if (!live) return;
      setExtras(list);
      const wanted = new Set(suggestedExtras(genres));
      setTicked(new Set(list.filter((e) => wanted.has(e.role)).map((e) => e.id)));
    });
    return () => { live = false; };
  }, [step, extras, genres]);

  const answers = (status: SetupAnswers['status'], at?: SetupStep): SetupAnswers => ({
    status, step: at, language: lang, genres, experience, cloud, flightMode: mode,
    ...(status === 'in-progress' ? {} : { updatedAt: new Date().toISOString() }),
  });
  const remember = (status: SetupAnswers['status'], at?: SetupStep) => { const a = answers(status, at); writeSetup(a); return a; };

  const go = (to: SetupStep | null) => {
    if (!to) { finish(); return; }
    if (to === 'flight' && !mode) setMode(suggestedFlightMode({ experience, genres }));
    remember('in-progress', to);
    setStep(to);
  };

  const leaveLanguage = () => {
    const to = nextStep('language');
    if (lang !== language) { remember('in-progress', to ?? undefined); chooseLanguage(lang); return; } // restarts in it
    keepLanguage();
    go(to);
  };

  const openTab = (): SettingsTabId | undefined => (proWanted ? 'account' : drivesWanted ? 'storage' : undefined);

  function finish(download = false) {
    const done = remember('done');
    requestSetupResult({ settings: { ...(mode ? { defaultAssistMode: mode } : {}), ...tailoredSettings({ experience }) }, openTab: openTab() });
    if (signedInName !== null) void saveSetupToAccount(done);
    if (download && online && extras) for (const extra of extras) if (ticked.has(extra.id)) void extra.download().catch(() => undefined);
    onClose();
  }

  function skipAll() {
    const skipped = remember('skipped');
    if (signedInName !== null) void saveSetupToAccount(skipped);
    onClose();
  }

  const index = SETUP_STEPS.indexOf(step);
  const back = previousStep(step);
  const title = { language: t.language.title, about: t.about.title, pro: t.pro.title, cloud: t.cloud.title, flight: t.flight.title, extras: t.extras.title }[step];
  const toggleGenre = (g: SetupGenre) => setGenres((was) => (was.includes(g) ? was.filter((x) => x !== g) : [...was, g]));
  // The amounts come from the one price list (PRO_PLAN_CHOICES), so setup never shows a different price from checkout.
  const amount = (plan: string) => PRO_PLAN_CHOICES.find((p) => p.plan === plan)?.price.match(/[£$€][\d.,]+/)?.[0];
  const monthly = amount('monthly');
  const annual = amount('annual');
  const suggested = suggestedFlightMode({ experience, genres });

  return (
    <section data-testid="quick-setup" data-setup-step={step} aria-labelledby={`${langId}-title`} className="flex w-full flex-col gap-3 text-left">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{t.title} · {t.stepOf(index + 1, SETUP_STEPS.length)}</p>
        <button type="button" onClick={skipAll} className={link} data-testid="setup-skip-all">{t.skipSetup}</button>
      </div>
      <h2 id={`${langId}-title`} ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">{title}</h2>

      {step === 'language' && (
        <>
          <p className="text-sm text-[var(--text-secondary)]">{t.language.body}</p>
          <select id={langId} aria-label={t.language.title} value={lang} onChange={(e) => setLang(e.target.value as LanguageCode)}
            className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)]">
            {LANGUAGES.map((option) => <option key={option.code} value={option.code}>{option.nativeName}</option>)}
          </select>
          {lang !== language && <p className="text-xs text-[var(--text-muted)]">{t.language.restartNote}</p>}
        </>
      )}

      {step === 'about' && (
        <>
          <p className="text-sm text-[var(--text-secondary)]">{t.about.body}</p>
          <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <legend className="sr-only">{t.about.title}</legend>
            {SETUP_GENRES.map((g) => (
              <label key={g} className={choice(genres.includes(g))} data-testid={`setup-genre-${g}`}>
                <input type="checkbox" className="h-5 w-5 shrink-0 accent-[var(--brand-accent)]" checked={genres.includes(g)} onChange={() => toggleGenre(g)} />
                {t.about.genres[g]}
              </label>
            ))}
          </fieldset>
          <fieldset className="mt-1 flex flex-col gap-2">
            <legend className="mb-2 text-sm font-semibold">{t.about.experienceLabel}</legend>
            {SETUP_EXPERIENCE.map((x) => (
              <label key={x} className={choice(experience === x)} data-testid={`setup-experience-${x}`}>
                <input type="radio" name={`${langId}-experience`} className="h-5 w-5 shrink-0 accent-[var(--brand-accent)]" checked={experience === x} onChange={() => setExperience(x)} />
                <span><span className="block">{t.about.experience[x]}</span><span className="block text-xs font-normal text-[var(--text-secondary)]">{t.about.experienceHint[x]}</span></span>
              </label>
            ))}
          </fieldset>
        </>
      )}

      {step === 'pro' && (
        <>
          <p className="text-sm text-[var(--text-secondary)]">{t.pro.body}</p>
          <ul className="space-y-1 text-sm">
            {monthly && <li>{t.pro.monthly(monthly)}</li>}
            {annual && <li>{t.pro.annual(annual)}</li>}
          </ul>
          <p className="text-xs text-[var(--text-muted)]">{t.pro.cancelNote}</p>
          <div className="flex flex-col gap-2">
            <button type="button" aria-pressed={proWanted} className={choice(proWanted)} onClick={() => setProWanted(true)} data-testid="setup-pro-yes">{t.pro.choose}</button>
            <button type="button" aria-pressed={!proWanted} className={choice(!proWanted)} onClick={() => setProWanted(false)} data-testid="setup-pro-no">{t.pro.stayBasic}</button>
          </div>
          {proWanted && <p role="status" className="text-xs text-[var(--text-secondary)]">{t.pro.chosen}</p>}
        </>
      )}

      {step === 'cloud' && (
        <>
          <p className="text-sm text-[var(--text-secondary)]">{t.cloud.body}</p>
          {signedInName !== null ? (
            <>
              <p role="status" className="text-sm">{signedInName ? t.cloud.signedIn(signedInName) : t.cloud.signedInNoName}</p>
              <label className={choice(drivesWanted)}>
                <input type="checkbox" className="h-5 w-5 shrink-0 accent-[var(--brand-accent)]" checked={drivesWanted} onChange={(e) => setDrivesWanted(e.target.checked)} />
                {t.cloud.connectDrives}
              </label>
              {drivesWanted && <p className="text-xs text-[var(--text-muted)]">{t.cloud.drivesNote}</p>}
            </>
          ) : (
            <div className="flex flex-col gap-2">
              {onSignIn && <button type="button" className={buttonClass.secondary} onClick={() => { setCloud('account'); remember('in-progress', 'cloud'); onSignIn(); }} data-testid="setup-sign-in">{t.cloud.signIn}</button>}
              <button type="button" aria-pressed={cloud === 'local'} className={choice(cloud === 'local')} onClick={() => setCloud('local')} data-testid="setup-stay-local">{t.cloud.stayLocal}</button>
            </div>
          )}
        </>
      )}

      {step === 'flight' && (
        <>
          <p className="text-sm text-[var(--text-secondary)]">{t.flight.body}</p>
          <FlightModePicker name={`${langId}-flight`} label={t.flight.title} showLabel={false} value={mode ?? suggested} onChange={setMode} />
          {(mode ?? suggested) === suggested && <p className="text-xs text-[var(--text-muted)]">{t.flight.suggested}</p>}
        </>
      )}

      {step === 'extras' && (
        <>
          <p className="text-sm text-[var(--text-secondary)]">{t.extras.body}</p>
          {extras === null ? <p className="text-sm text-[var(--text-muted)]" aria-busy="true">…</p>
            : extras.length === 0 ? <p className="text-sm text-[var(--text-secondary)]" data-testid="setup-no-extras">{t.extras.none}</p>
            : (
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">{t.extras.title}</legend>
                {extras.map((extra) => (
                  <label key={extra.id} className={choice(ticked.has(extra.id))} data-testid={`setup-extra-${extra.role}`}>
                    <input type="checkbox" className="h-5 w-5 shrink-0 accent-[var(--brand-accent)]" checked={ticked.has(extra.id)} disabled={!online}
                      onChange={() => setTicked((was) => { const next = new Set(was); if (next.has(extra.id)) next.delete(extra.id); else next.add(extra.id); return next; })} />
                    <span className="min-w-0">
                      <span className="block">{extra.title} <span className="font-normal text-[var(--text-muted)]">· {t.extras.size((extra.bytes / 1e6).toLocaleString(language, { maximumFractionDigits: 0 }))}</span></span>
                      <span className="block text-xs font-normal text-[var(--text-secondary)]">{extra.why}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          {extras && extras.length > 0 && <p className="text-xs text-[var(--text-muted)]">{online ? t.extras.background : t.extras.offline}</p>}
        </>
      )}

      <div className="mt-2 flex flex-col gap-2">
        {step === 'extras' && extras && extras.length > 0 && online && ticked.size > 0
          ? <button type="button" className={buttonClass.primary} onClick={() => finish(true)} data-testid="setup-download">{t.extras.download}</button>
          : <button type="button" className={buttonClass.primary} data-testid="setup-next"
              onClick={() => (step === 'language' ? leaveLanguage() : go(nextStep(step)))}>{step === 'extras' ? t.finish : t.next}</button>}
        <div className="flex items-center justify-between">
          {back ? <button type="button" className={link} onClick={() => go(back)}>{t.back}</button> : <span />}
          {step !== 'extras' && <button type="button" className={link} onClick={() => go(nextStep(step))} data-testid="setup-skip-step">{t.skipStep}</button>}
        </div>
      </div>
    </section>
  );
}
