import { useId, useState } from 'react';
import { AI_REVIEW_CONSENT_VERSION } from '../../../core/aiReview';
import { aiReviewText as t } from '../../../i18n/areas/aiReview';
import {
  availableAiProviderKinds, consentFor, DEFAULT_AI_MODEL, destinationHost, normalisedOpenAiBaseUrl, staysOnThisComputer,
  type AiProviderKind, type AiProviderSettings,
} from '../../../providers/aiProviders';
import { forgetAiSettings, saveAiSettings, useAiSettings } from '../../../providers/aiSettings';

/** One tap fills in the address of a model running on this computer. */
const LOCAL_PRESETS = [
  { name: 'Ollama', url: 'http://localhost:11434/v1' },
  { name: 'LM Studio', url: 'http://localhost:1234/v1' },
] as const;

const field = 'mt-1 block h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-xs text-[var(--text-primary)]';
const button = 'h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-primary)] disabled:opacity-50';
const label = 'block text-xs text-[var(--text-primary)]';
const hint = 'mt-1 text-[0.6875rem] text-[var(--text-muted)]';

/**
 * Bring your own AI, in V2 Settings: the person's own Gemini or Claude key, an OpenAI-compatible service, or a model on
 * this computer (Ollama, LM Studio). Kept on this device only and never put in a project backup. Nothing is sent until
 * the person agrees, in the Assist panel, to the exact destination shown here.
 */
export function AiProviderSetup() {
  const saved = useAiSettings();
  const id = useId();
  const [editing, setEditing] = useState(!saved);
  const [kind, setKind] = useState<AiProviderKind>(saved?.kind ?? 'openai');
  const [key, setKey] = useState(saved?.key ?? '');
  const [model, setModel] = useState(saved?.model ?? DEFAULT_AI_MODEL[saved?.kind ?? 'openai']);
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? LOCAL_PRESETS[0].url);
  const [badUrl, setBadUrl] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (saved && !editing) {
    return (
      <section className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3.5" data-testid="v2-ai-setup-saved">
        <p className="text-xs font-semibold text-[var(--text-primary)]">{t.providers[saved.kind]}</p>
        <p className="font-mono text-[0.6875rem] text-[var(--text-secondary)]">{destinationHost(saved)}{saved.model ? ` · ${saved.model}` : ''}</p>
        <p className="text-[0.6875rem] text-[var(--text-secondary)]">
          {staysOnThisComputer(saved) ? t.consentLocal(destinationHost(saved)) : t.consentCloud(destinationHost(saved))}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={() => setEditing(true)}>{t.change}</button>
          <button type="button" className={button} onClick={() => { forgetAiSettings(); setNote(t.forgotten); setEditing(true); }}>{t.forget}</button>
        </div>
      </section>
    );
  }

  return (
    <form
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3.5"
      data-testid="v2-ai-setup"
      onSubmit={(event) => {
        event.preventDefault();
        let checkedUrl = baseUrl.trim();
        if (kind === 'openai') {
          try { checkedUrl = normalisedOpenAiBaseUrl(checkedUrl); setBadUrl(false); } catch { setBadUrl(true); return; }
        }
        const next: AiProviderSettings = { kind, key: key.trim(), model: model.trim(), ...(kind === 'openai' ? { baseUrl: checkedUrl } : {}), consent: null };
        // Agreement carries over only to exactly the same destination.
        if (saved && consentFor(AI_REVIEW_CONSENT_VERSION, saved) === consentFor(AI_REVIEW_CONSENT_VERSION, next)) next.consent = saved.consent;
        saveAiSettings(next);
        setNote(null);
        setEditing(false);
      }}
    >
      <label className={label} htmlFor={`${id}-kind`}>{t.provider}</label>
      <select id={`${id}-kind`} className={field} value={kind} onChange={(event) => {
        const next = event.target.value as AiProviderKind;
        setKind(next); setModel(DEFAULT_AI_MODEL[next]); setBadUrl(false);
      }}>
        {availableAiProviderKinds().map((option) => <option key={option} value={option}>{t.providers[option]}</option>)}
      </select>
      {kind === 'openai' && (
        <div>
          <div role="group" aria-label="Models on this computer" className="flex flex-wrap gap-2">
            {LOCAL_PRESETS.map((preset) => (
              <button key={preset.name} type="button" className={button} aria-pressed={baseUrl === preset.url}
                onClick={() => { setBaseUrl(preset.url); setBadUrl(false); }}>{preset.name}</button>
            ))}
          </div>
          <label className={`${label} mt-2`} htmlFor={`${id}-url`}>{t.baseUrl}</label>
          <input id={`${id}-url`} type="url" required inputMode="url" autoComplete="off" className={field} value={baseUrl}
            aria-invalid={badUrl} aria-describedby={badUrl ? `${id}-url-error` : `${id}-url-hint`}
            onChange={(event) => { setBaseUrl(event.target.value); setBadUrl(false); }} />
          <p id={`${id}-url-hint`} className={hint}>{t.baseUrlHint}</p>
          {badUrl && <p id={`${id}-url-error`} role="alert" className="mt-1 text-xs text-[var(--text-primary)]">{t.invalidBaseUrl}</p>}
        </div>
      )}
      {kind === 'inflight' && <p className={hint}>{t.inflightHint}</p>}
      {kind !== 'inflight' && <>
      <div>
        <label className={label} htmlFor={`${id}-key`}>{kind === 'openai' ? t.keyOptional : t.key}</label>
        <input id={`${id}-key`} type="password" autoComplete="off" spellCheck={false} className={field} value={key} onChange={(event) => setKey(event.target.value)} />
        <p className={hint}>{t.keyHint}</p>
      </div>
      <div>
        <label className={label} htmlFor={`${id}-model`}>{t.model}</label>
        <input id={`${id}-model`} autoComplete="off" spellCheck={false} className={field} value={model} onChange={(event) => setModel(event.target.value)} />
        <p className={hint}>{kind === 'gemini' ? t.modelAuto : t.modelNeeded}</p>
      </div>
      </>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={button} data-testid="v2-ai-setup-save"
          disabled={((kind === 'gemini' || kind === 'anthropic') && !key.trim()) || (kind === 'openai' && !model.trim())}>{t.save}</button>
        {saved && <button type="button" className={button} onClick={() => setEditing(false)}>{t.cancel}</button>}
      </div>
      {note && <p role="status" className="text-xs text-[var(--text-secondary)]">{note}</p>}
    </form>
  );
}
