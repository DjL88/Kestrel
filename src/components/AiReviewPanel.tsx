import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Info, LoaderCircle, MessageSquareText, Server } from 'lucide-react';
import { BrandIcon } from './BrandIcon';
import type { BrandIconId } from '../core/brandIcons';
import { AI_REVIEW_CONSENT_VERSION, aiReviewPrompt, type AiReview } from '../core/aiReview';
import { yieldToPaint } from '../core/yieldToPaint';
import { applyFix } from '../core/critique';
import { conservativeReviewTargets } from '../core/photoReviewStep';
import { capturePhotoReviewScope, samePhotoReviewScope, type PhotoReviewScope } from '../core/photoReviewScope';
import type { PhotoEdit } from '../core/photoEdits';
import { languageOption } from '../core/locale';
import { language } from '../i18n/messages';
import { aiReviewText as t } from '../i18n/areas/aiReview';
import {
  AI_PROVIDER_KINDS, AiReviewError, askForReview, consentFor, DEFAULT_AI_MODEL, destinationHost, staysOnThisComputer, normalisedOpenAiBaseUrl,
  type AiProviderKind, type AiProviderSettings,
} from '../providers/aiProviders';
import { forgetAiSettings, saveAiSettings, useAiSettings } from '../providers/aiSettings';

interface Props {
  edit: PhotoEdit;
  onEdit: (edit: PhotoEdit) => void;
  /** A 1,024-pixel JPEG of the photo as edited, base64, with no metadata; null while it isn't ready. */
  readJpeg: () => string | null;
  /** The on-device colour check's sentences, so the AI can agree or disagree. */
  localFindings: string[];
  /** Stable photo/source/framing/recipe tokens; invalidate any older model reply when one changes. */
  version: readonly unknown[];
  disabled?: boolean;
}

const field = 'min-h-10 w-full rounded-md border border-white/15 bg-kestrel-raised px-2 text-xs text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-300';
const button = 'min-h-9 rounded-md border border-white/15 px-2 text-xs text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-50';
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(2).replace(/0$/, '')}`;

/** Set up the person's own provider: which one, key, model and (for OpenAI-compatible) its address. */
/** The mark beside each kind of AI. OpenAI-compatible has none: it covers many services, so it keeps a neutral icon. */
const AI_PROVIDER_MARK: Partial<Record<AiProviderKind, BrandIconId>> = { gemini: 'gemini', vertex: 'googlecloud', anthropic: 'anthropic' };
/** One tap fills in the address of a model running on this computer. */
const LOCAL_PRESETS: readonly { name: string; id: BrandIconId; url: string }[] = [
  { name: 'Ollama', id: 'ollama', url: 'http://localhost:11434/v1' },
  { name: 'LM Studio', id: 'lmstudio', url: 'http://localhost:1234/v1' },
];

export function AiProviderSetup({ saved, onDone }: { saved: AiProviderSettings | null; onDone: () => void }) {
  const id = useId();
  const [kind, setKind] = useState<AiProviderKind>(saved?.kind ?? 'gemini');
  const [key, setKey] = useState(saved?.key ?? '');
  const [model, setModel] = useState(saved?.model ?? DEFAULT_AI_MODEL[saved?.kind ?? 'gemini']);
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? 'http://localhost:11434/v1');
  const [setupError, setSetupError] = useState(false);
  return (
    <form className="space-y-2" onSubmit={(event) => {
      event.preventDefault();
      // The form refuses unsafe remote HTTP before saving credentials or consent.
      let checkedUrl = baseUrl.trim();
      if (kind === 'openai') {
        try { checkedUrl = normalisedOpenAiBaseUrl(checkedUrl); setSetupError(false); }
        catch { setSetupError(true); return; }
      }
      const next: AiProviderSettings = { kind, key: key.trim(), model: model.trim(), ...(kind === 'openai' ? { baseUrl: checkedUrl } : {}), consent: null };
      // Agreement carries over only to exactly the same destination.
      if (saved && consentFor(AI_REVIEW_CONSENT_VERSION, saved) === consentFor(AI_REVIEW_CONSENT_VERSION, next)) next.consent = saved.consent;
      saveAiSettings(next);
      onDone();
    }}>
      <label htmlFor={`${id}-kind`} className="block text-xs text-zinc-300">{t.provider}</label>
      <div className="flex items-center gap-2">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-white/8 text-zinc-100" aria-hidden="true">{AI_PROVIDER_MARK[kind] ? <BrandIcon id={AI_PROVIDER_MARK[kind]!} className="h-5 w-5" /> : <Server className="h-5 w-5" />}</span>
      <select id={`${id}-kind`} className={field} value={kind} onChange={(event) => {
        const next = event.target.value as AiProviderKind;
        setKind(next);
        setModel(DEFAULT_AI_MODEL[next]);
        setSetupError(false);
      }}>
        {AI_PROVIDER_KINDS.map((option) => <option key={option} value={option}>{t.providers[option]}</option>)}
      </select>
      </div>
      {kind === 'openai' && <>
        <div role="group" aria-label="Models on this computer" className="flex flex-wrap gap-2">
          {LOCAL_PRESETS.map((preset) => (
            <button key={preset.name} type="button" className={`${button} inline-flex items-center gap-1.5`} onClick={() => { setBaseUrl(preset.url); setSetupError(false); }}>
              <BrandIcon id={preset.id} className="h-4 w-4" />{preset.name}
            </button>
          ))}
        </div>
        <label htmlFor={`${id}-url`} className="block text-xs text-zinc-300">{t.baseUrl}</label>
        <input id={`${id}-url`} type="url" required className={field} value={baseUrl}
          aria-invalid={setupError} aria-describedby={setupError ? `${id}-url-error` : undefined}
          onChange={(event) => { setBaseUrl(event.target.value); setSetupError(false); }} inputMode="url" autoComplete="off" />
        <p className="text-xs text-zinc-400">{t.baseUrlHint}</p>
        {setupError && <p id={`${id}-url-error`} role="alert" className="text-xs text-orange-200">{t.invalidBaseUrl}</p>}
      </>}
      <label htmlFor={`${id}-key`} className="block text-xs text-zinc-300">{kind === 'openai' ? t.keyOptional : t.key}</label>
      <input id={`${id}-key`} type="password" className={field} value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" spellCheck={false} />
      <p className="text-xs text-zinc-400">{t.keyHint}</p>
      <label htmlFor={`${id}-model`} className="block text-xs text-zinc-300">{t.model}</label>
      <input id={`${id}-model`} className={field} value={model} onChange={(event) => setModel(event.target.value)} autoComplete="off" spellCheck={false} />
      <p className="text-xs text-zinc-400">{kind === 'gemini' ? t.modelAuto : t.modelNeeded}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={button} disabled={(kind !== 'openai' && !key.trim()) || ((kind === 'vertex' || kind === 'openai') && !model.trim())}>{t.save}</button>
        {saved && <button type="button" className={button} onClick={() => { forgetAiSettings(); onDone(); }}>{t.forget}</button>}
      </div>
    </form>
  );
}

/**
 * A second opinion on colour and light from the person's own AI (their key, or a model on this computer). Off until
 * they set it up and agree, by name, to where a small preview goes. The AI only describes and suggests; any change is
 * applied by the person, as one undoable step.
 */
export function AiReviewPanel({ edit, onEdit, readJpeg, localFindings, version, disabled }: Props) {
  const settings = useAiSettings();
  const [mode, setMode] = useState<'idle' | 'asking'>('idle');
  const [review, setReview] = useState<AiReview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // The edit an Apply makes is itself a version change; keep its confirmation across that one change.
  const keepApplied = useRef(false);
  const abort = useRef<AbortController | null>(null);
  // Values are supplied by the live editor, not the review provider. When an
  // asynchronous model finishes, the same request must still own every part.
  const currentScope = useRef<PhotoReviewScope>([]);
  currentScope.current = [edit, settings, disabled, ...version];
  const shownScope = useRef<PhotoReviewScope | null>(null);
  useEffect(() => () => {
    abort.current?.abort();
    abort.current = null;
    shownScope.current = null;
  }, []);
  useEffect(() => {
    // An older photo, edit, crop or provider must never leave an apparently
    // current suggestion on screen or remain able to modify the new frame.
    abort.current?.abort();
    abort.current = null;
    shownScope.current = null;
    setMode('idle');
    setReview(null);
    setMessage(keepApplied.current ? t.applied : null);
    keepApplied.current = false;
    // The version tuple has a fixed shape controlled by PhotoEditor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, settings, disabled, ...version]);
  const agreed = settings ? settings.consent === consentFor(AI_REVIEW_CONSENT_VERSION, settings) : false;

  async function ask() {
    if (!settings || abort.current) return;
    const controller = new AbortController();
    const askedFor = capturePhotoReviewScope(currentScope.current);
    abort.current = controller;
    shownScope.current = null;
    setMessage(null); setReview(null); setMode('asking');
    const stillCurrent = () => abort.current === controller && !controller.signal.aborted &&
      samePhotoReviewScope(askedFor, currentScope.current);
    try {
      // Preview encoding can be synchronous. Paint progress before touching
      // the canvas so tapping Ask never appears to do nothing.
      await yieldToPaint();
      if (!stillCurrent()) return;
      const jpeg = readJpeg();
      if (!jpeg) { if (stillCurrent()) setMessage(t.errors.other); return; }
      const prompt = aiReviewPrompt(languageOption(language).englishName, localFindings);
      const result = await askForReview(settings, AI_REVIEW_CONSENT_VERSION, prompt, jpeg, controller.signal);
      if (stillCurrent()) { shownScope.current = askedFor; setReview(result); }
    } catch (error) {
      if (stillCurrent()) {
        setMessage(t.errors[error instanceof AiReviewError ? error.reason : 'other']);
      }
    } finally {
      if (abort.current === controller) { abort.current = null; setMode('idle'); }
    }
  }
  const cancelAsk = () => {
    abort.current?.abort();
    abort.current = null;
    shownScope.current = null;
    setMode('idle');
  };

  // A provider is configured in Settings. No integration controls are shown until then.
  if (!settings) return null;

  // Hide stale results in the same render that changes the photo. React effect
  // cancellation happens afterwards, so apply-time validation is also needed.
  const visibleReview = review && samePhotoReviewScope(shownScope.current, currentScope.current) ? review : null;
  // Limit one model review to a calm, reversible first step. Display exactly
  // these targets, not the larger raw values returned by the model.
  const checkedTargets = visibleReview ? conservativeReviewTargets(edit, visibleReview.suggestion) : {};
  const suggestion = Object.entries(checkedTargets) as [keyof typeof t.slider, number][];
  return (
    <section aria-label={t.title} className="space-y-2 border-t border-white/10 pt-2" data-testid="ai-review">
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-zinc-200"><MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />{t.title}</h4>
      <p className="text-xs text-zinc-400">{t.intro}</p>
      {!agreed && (
        <div className="space-y-1 rounded-md border border-white/15 p-2" role="group" aria-label={t.consentTitle}>
          <p className="text-xs font-semibold text-zinc-200">{t.consentTitle}</p>
          <p className="text-xs text-zinc-300">{staysOnThisComputer(settings) ? t.consentLocal(destinationHost(settings)) : t.consentCloud(destinationHost(settings))}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => saveAiSettings({ ...settings, consent: consentFor(AI_REVIEW_CONSENT_VERSION, settings) })}>{t.agree}</button>
          </div>
        </div>
      )}
      {agreed && (
        <div className="flex flex-wrap gap-2">
          {mode === 'asking'
            ? <><span role="status" aria-live="polite" className="inline-flex min-h-9 items-center gap-2 self-center text-xs text-zinc-300">
                <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />{t.asking}
              </span><button type="button" className={button} onClick={cancelAsk}>{t.cancel}</button></>
            : <button type="button" className={button} disabled={disabled} onClick={() => void ask()}>{t.ask}</button>}
        </div>
      )}
      {message && <p role="status" className="flex gap-1.5 text-xs text-zinc-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{message}</p>}
      {visibleReview && (
        <div className="space-y-1.5 rounded-md border border-white/15 p-2" data-testid="ai-review-result">
          <p className="text-xs font-semibold text-zinc-200">{t.summary}</p>
          <p className="text-xs text-zinc-200">{visibleReview.summary}</p>
          {visibleReview.points.length > 0 && <ul className="space-y-1">
            {visibleReview.points.map((point, index) => (
              <li key={index} className="flex gap-1.5 text-xs text-zinc-200">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span><strong className="font-semibold">{t.issue[point.issue]}:</strong> {point.detail}</span>
              </li>
            ))}
          </ul>}
          <p className="text-xs font-semibold text-zinc-200">{t.suggested}</p>
          {suggestion.length === 0
            ? <p className="text-xs text-zinc-300">{t.noChanges}</p>
            : <ul className="text-xs text-zinc-200">{suggestion.map(([slider, value]) => <li key={slider}>{t.changeLine(t.slider[slider], signed(value))}</li>)}</ul>}
          <p className="text-xs text-zinc-400">{t.draftNote}</p>
          <div className="flex flex-wrap gap-2">
            {suggestion.length > 0 && <button type="button" className={button} disabled={disabled} onClick={() => {
              // The user could change source or settings between painting and
              // clicking Apply. Never send an old model proposal to that edit.
              if (!samePhotoReviewScope(shownScope.current, currentScope.current)) return;
              // Suggested values are absolute slider positions; turn them into changes from the current edit.
              const delta = Object.fromEntries(suggestion.map(([slider, value]) => [slider, value - (Number(edit[slider as keyof PhotoEdit]) || 0)]));
              onEdit(applyFix(edit, { kind: 'global', delta }));
              shownScope.current = null;
              keepApplied.current = true;
              setReview(null);
              setMessage(t.applied);
            }}>{t.apply}</button>}
            <button type="button" className={button} onClick={() => setReview(null)}>{t.dismiss}</button>
          </div>
        </div>
      )}
    </section>
  );
}
