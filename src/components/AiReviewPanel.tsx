import { useId, useRef, useState } from 'react';
import { AlertTriangle, Info, MessageSquareText } from 'lucide-react';
import { AI_REVIEW_CONSENT_VERSION, aiReviewPrompt, type AiReview } from '../core/aiReview';
import { applyFix } from '../core/critique';
import type { PhotoEdit } from '../core/photoEdits';
import { languageOption } from '../core/locale';
import { language } from '../i18n/messages';
import { aiReviewText as t } from '../i18n/areas/aiReview';
import {
  AI_PROVIDER_KINDS, AiReviewError, askForReview, consentFor, DEFAULT_AI_MODEL, destinationHost, staysOnThisComputer,
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
  disabled?: boolean;
}

const field = 'min-h-10 w-full rounded-md border border-white/15 bg-kestrel-raised px-2 text-xs text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-300';
const button = 'min-h-9 rounded-md border border-white/15 px-2 text-xs text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-50';
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(2).replace(/0$/, '')}`;

/** Set up the person's own provider: which one, key, model and (for OpenAI-compatible) its address. */
function Setup({ saved, onDone }: { saved: AiProviderSettings | null; onDone: () => void }) {
  const id = useId();
  const [kind, setKind] = useState<AiProviderKind>(saved?.kind ?? 'gemini');
  const [key, setKey] = useState(saved?.key ?? '');
  const [model, setModel] = useState(saved?.model ?? DEFAULT_AI_MODEL[saved?.kind ?? 'gemini']);
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? 'http://localhost:11434/v1');
  return (
    <form className="space-y-2" onSubmit={(event) => {
      event.preventDefault();
      const next: AiProviderSettings = { kind, key: key.trim(), model: model.trim(), ...(kind === 'openai' ? { baseUrl: baseUrl.trim() } : {}), consent: null };
      // Agreement carries over only to exactly the same destination.
      if (saved && consentFor(AI_REVIEW_CONSENT_VERSION, saved) === consentFor(AI_REVIEW_CONSENT_VERSION, next)) next.consent = saved.consent;
      saveAiSettings(next);
      onDone();
    }}>
      <label htmlFor={`${id}-kind`} className="block text-xs text-zinc-300">{t.provider}</label>
      <select id={`${id}-kind`} className={field} value={kind} onChange={(event) => {
        const next = event.target.value as AiProviderKind;
        setKind(next);
        setModel(DEFAULT_AI_MODEL[next]);
      }}>
        {AI_PROVIDER_KINDS.map((option) => <option key={option} value={option}>{t.providers[option]}</option>)}
      </select>
      {kind === 'openai' && <>
        <label htmlFor={`${id}-url`} className="block text-xs text-zinc-300">{t.baseUrl}</label>
        <input id={`${id}-url`} className={field} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} inputMode="url" autoComplete="off" />
        <p className="text-xs text-zinc-400">{t.baseUrlHint}</p>
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
export function AiReviewPanel({ edit, onEdit, readJpeg, localFindings, disabled }: Props) {
  const settings = useAiSettings();
  const [mode, setMode] = useState<'idle' | 'setup' | 'asking'>('idle');
  const [review, setReview] = useState<AiReview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const agreed = settings ? settings.consent === consentFor(AI_REVIEW_CONSENT_VERSION, settings) : false;

  async function ask() {
    if (!settings) return;
    const jpeg = readJpeg();
    if (!jpeg) return;
    setMessage(null); setReview(null); setMode('asking');
    abort.current = new AbortController();
    try {
      const prompt = aiReviewPrompt(languageOption(language).englishName, localFindings);
      setReview(await askForReview(settings, AI_REVIEW_CONSENT_VERSION, prompt, jpeg, abort.current.signal));
    } catch (error) {
      if (!abort.current.signal.aborted) setMessage(t.errors[error instanceof AiReviewError ? error.reason : 'other']);
    } finally {
      setMode('idle');
    }
  }

  const suggestion = review ? Object.entries(review.suggestion) as [keyof typeof t.slider, number][] : [];
  return (
    <section aria-label={t.title} className="space-y-2 border-t border-white/10 pt-2" data-testid="ai-review">
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-zinc-200"><MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />{t.title}</h4>
      <p className="text-xs text-zinc-400">{t.intro}</p>
      {mode === 'setup' && <Setup saved={settings} onDone={() => { setMode('idle'); setMessage(null); }} />}
      {mode !== 'setup' && !settings && <button type="button" className={button} disabled={disabled} onClick={() => setMode('setup')}>{t.setUp}</button>}
      {mode !== 'setup' && settings && !agreed && (
        <div className="space-y-1 rounded-md border border-white/15 p-2" role="group" aria-label={t.consentTitle}>
          <p className="text-xs font-semibold text-zinc-200">{t.consentTitle}</p>
          <p className="text-xs text-zinc-300">{staysOnThisComputer(settings) ? t.consentLocal(destinationHost(settings)) : t.consentCloud(destinationHost(settings))}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => saveAiSettings({ ...settings, consent: consentFor(AI_REVIEW_CONSENT_VERSION, settings) })}>{t.agree}</button>
            <button type="button" className={button} onClick={() => setMode('setup')}>{t.change}</button>
          </div>
        </div>
      )}
      {mode !== 'setup' && settings && agreed && (
        <div className="flex flex-wrap gap-2">
          {mode === 'asking'
            ? <><span role="status" className="self-center text-xs text-zinc-300">{t.asking}</span><button type="button" className={button} onClick={() => abort.current?.abort()}>{t.cancel}</button></>
            : <><button type="button" className={button} disabled={disabled} onClick={() => void ask()}>{t.ask}</button><button type="button" className={button} onClick={() => setMode('setup')}>{t.change}</button></>}
        </div>
      )}
      {message && <p role="status" className="flex gap-1.5 text-xs text-zinc-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{message}</p>}
      {review && (
        <div className="space-y-1.5 rounded-md border border-white/15 p-2" data-testid="ai-review-result">
          <p className="text-xs font-semibold text-zinc-200">{t.summary}</p>
          <p className="text-xs text-zinc-200">{review.summary}</p>
          {review.points.length > 0 && <ul className="space-y-1">
            {review.points.map((point, index) => (
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
              // Suggested values are absolute slider positions; turn them into changes from the current edit.
              const delta = Object.fromEntries(suggestion.map(([slider, value]) => [slider, value - (Number(edit[slider as keyof PhotoEdit]) || 0)]));
              onEdit(applyFix(edit, { kind: 'global', delta }));
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
