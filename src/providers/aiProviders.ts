/**
 * The person's own AI, for a second opinion on colour and light: their own Google Gemini, Anthropic or
 * OpenAI-compatible key, or a model running on their own computer (Ollama, LM Studio). Nothing is sent until
 * they have chosen a provider, entered its details and agreed to send a small preview there
 * (`AI_REVIEW_CONSENT_VERSION`); the preview carries no location, camera details or file name.
 *
 * Keys are kept on this device only, in Kite44's own storage. They are never put in a project backup.
 *
 * Google Vertex AI was removed (21 Nov 2026): its standard endpoint (`aiplatform.googleapis.com`) rejects a
 * plain API key outright and needs a Google Cloud OAuth2 access token instead, which this hand-built request
 * never supplied - a person who set it up with a normal Vertex key would always have got a 401. Plain Gemini
 * (`generativelanguage.googleapis.com`), which only ever needed an API key, covers the same models.
 */
import { AI_REVIEW_SCHEMA, parseAiReview, type AiReview } from '../core/aiReview';

export type AiProviderKind = 'gemini' | 'anthropic' | 'openai';
export const AI_PROVIDER_KINDS: readonly AiProviderKind[] = ['gemini', 'anthropic', 'openai'];

export interface AiProviderSettings {
  kind: AiProviderKind;
  /** Optional for an OpenAI-compatible model on this computer (Ollama, LM Studio). */
  key: string;
  /** The model's id; for Gemini it is chosen automatically when left empty. */
  model: string;
  /** OpenAI-compatible only: the API's base address, e.g. http://localhost:11434/v1 for Ollama. */
  baseUrl?: string;
  /** The consent version and destination host agreed to, e.g. "review-1@api.anthropic.com". */
  consent: string | null;
}

export const DEFAULT_AI_MODEL: Record<AiProviderKind, string> = {
  gemini: '',
  anthropic: 'claude-opus-5-5',
  openai: '',
};

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
export const AI_REQUEST_TIMEOUT_MS = 45_000;

export class AiReviewError extends Error {
  constructor(readonly reason: 'setup' | 'key' | 'offline' | 'timeout' | 'refused' | 'unreadable' | 'other', message = '') {
    super(message);
    this.name = 'AiReviewError';
  }
}

/**
 * Canonical base for an OpenAI-compatible provider. Remote previews and
 * bearer keys require HTTPS; plain HTTP is permitted only for localhost.
 * Reject credentials, query strings and fragments in the API base address.
 */
export function normalisedOpenAiBaseUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw.trim()); }
  catch { throw new AiReviewError('setup', 'Enter a complete AI address, such as http://localhost:11434/v1.'); }
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
      url.username || url.password || url.search || url.hash) {
    throw new AiReviewError('setup', 'Use HTTPS for a remote AI or http://localhost for a model on this computer. Do not put keys in the address.');
  }
  return url.href.replace(/\/+$/, '');
}

/** Where a preview goes, said by host name in the consent text and recorded with the consent. */
export function destinationHost(settings: Pick<AiProviderSettings, 'kind' | 'baseUrl'>): string {
  if (settings.kind === 'gemini') return 'generativelanguage.googleapis.com';
  if (settings.kind === 'anthropic') return 'api.anthropic.com';
  try { return new URL(normalisedOpenAiBaseUrl(settings.baseUrl ?? '')).host || 'unknown'; } catch { return 'unknown'; }
}

/** True when the preview never leaves this computer (an OpenAI-compatible model on localhost). */
export function staysOnThisComputer(settings: Pick<AiProviderSettings, 'kind' | 'baseUrl'>): boolean {
  if (settings.kind !== 'openai') return false;
  try {
    const host = new URL(normalisedOpenAiBaseUrl(settings.baseUrl ?? '')).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch { return false; }
}

export function consentFor(version: string, settings: Pick<AiProviderSettings, 'kind' | 'baseUrl'>): string {
  if (settings.kind === 'openai') {
    // A changed host, API path or transport requires fresh photo-upload consent.
    // Invalid legacy addresses must not crash the Settings screen.
    try { return `${version}@${normalisedOpenAiBaseUrl(settings.baseUrl ?? '')}`; }
    catch { return `${version}@invalid-endpoint`; }
  }
  return `${version}@${destinationHost(settings)}`;
}

/** The HTTP request for Gemini and OpenAI-compatible providers. Pure, so it can be tested. */
export function buildAiRequest(settings: AiProviderSettings, prompt: string, jpegBase64: string): { url: string; init: RequestInit } {
  const json = { 'content-type': 'application/json' };
  if (settings.kind === 'gemini') {
    const model = settings.model.replace(/^models\//, '');
    const url = `${GEMINI}/models/${encodeURIComponent(model)}:generateContent`;
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: jpegBase64 } }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    };
    return { url, init: { method: 'POST', headers: { ...json, 'x-goog-api-key': settings.key }, body: JSON.stringify(body) } };
  }
  if (settings.kind === 'openai') {
    const base = normalisedOpenAiBaseUrl(settings.baseUrl ?? '');
    const body = {
      model: settings.model,
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpegBase64}` } },
      ] }],
      response_format: { type: 'json_schema', json_schema: { name: 'colour_review', schema: AI_REVIEW_SCHEMA } },
    };
    const headers: Record<string, string> = { ...json };
    if (settings.key.trim()) headers.authorization = `Bearer ${settings.key.trim()}`;
    return { url: `${base}/chat/completions`, init: { method: 'POST', headers, body: JSON.stringify(body) } };
  }
  throw new AiReviewError('setup', 'Claude uses the Anthropic SDK, not a hand-built request.');
}

/** The answer text from a Gemini or OpenAI-compatible reply, or null. */
export function readAiAnswer(kind: AiProviderKind, body: unknown): string | null {
  const record = body as Record<string, unknown> | null;
  if (!record || typeof record !== 'object') return null;
  if (kind === 'gemini') {
    const candidate = (record.candidates as { content?: { parts?: { text?: string }[] }; finishReason?: string }[] | undefined)?.[0];
    if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'PROHIBITED_CONTENT') throw new AiReviewError('refused');
    const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('');
    return text || null;
  }
  const choice = (record.choices as { message?: { content?: unknown; refusal?: unknown } }[] | undefined)?.[0];
  if (choice?.message?.refusal) throw new AiReviewError('refused');
  return typeof choice?.message?.content === 'string' ? choice.message.content : null;
}

async function send(url: string, init: RequestInit, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, AI_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch (error) {
    if (timedOut) throw new AiReviewError('timeout');
    if (signal?.aborted) throw error;
    throw new AiReviewError(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'other');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Claude, through Anthropic's own SDK (loaded only when chosen), with structured output and refusal fallback. */
async function askClaude(settings: AiProviderSettings, prompt: string, jpegBase64: string, signal?: AbortSignal): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // The person's own key, used from their own device: there is no Kite44 server in between.
  const client = new Anthropic({ apiKey: settings.key.trim(), dangerouslyAllowBrowser: true, timeout: AI_REQUEST_TIMEOUT_MS, maxRetries: 1 });
  try {
    const response = await client.beta.messages.create({
      model: settings.model.trim() || DEFAULT_AI_MODEL.anthropic,
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: AI_REVIEW_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBase64 } },
        { type: 'text', text: prompt },
      ] }],
    }, { signal });
    if (response.stop_reason === 'refusal') throw new AiReviewError('refused');
    const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
    if (!text) throw new AiReviewError('unreadable');
    return text;
  } catch (error) {
    if (error instanceof AiReviewError || signal?.aborted) throw error;
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw new AiReviewError('key');
    if (error instanceof Anthropic.APIConnectionTimeoutError) throw new AiReviewError('timeout');
    if (error instanceof Anthropic.APIConnectionError) throw new AiReviewError(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'other');
    throw new AiReviewError('other', error instanceof Anthropic.APIError ? error.message : '');
  }
}

/**
 * Ask the chosen provider for a review of one small JPEG (base64). Returns only a checked answer; throws an
 * AiReviewError when it can't (no consent, bad key, offline, refused, or an answer that isn't the expected shape).
 */
export async function askForReview(settings: AiProviderSettings, consentVersion: string, prompt: string, jpegBase64: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<AiReview> {
  if (settings.consent !== consentFor(consentVersion, settings)) throw new AiReviewError('setup');
  if (settings.kind !== 'openai' && !settings.key.trim()) throw new AiReviewError('setup');
  if (settings.kind === 'openai' && !settings.model.trim()) throw new AiReviewError('setup');
  let text: string | null;
  if (settings.kind === 'anthropic') {
    text = await askClaude(settings, prompt, jpegBase64, signal);
  } else {
    // Gemini picks a suitable model for the key when none is given (the species helper's own choice).
    const pick = async () => (await import('./onlineHelper')).checkKey(settings.key.trim(), fetcher, signal);
    const resolved = settings.kind === 'gemini' && !settings.model.trim() ? { ...settings, model: (await pick()).model } : settings;
    const { url, init } = buildAiRequest(resolved, prompt, jpegBase64);
    const { status, body } = await send(url, init, signal, fetcher);
    if (status === 401 || status === 403) throw new AiReviewError('key');
    if (status < 200 || status >= 300) throw new AiReviewError('other', `The provider answered with status ${status}.`);
    text = readAiAnswer(settings.kind, body);
  }
  const review = text ? parseAiReview(text) : null;
  if (!review) throw new AiReviewError('unreadable');
  return review;
}
