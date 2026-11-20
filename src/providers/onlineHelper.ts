import { geminiRequest, readGeminiResponse, readModelList, GEMINI_BASE } from '../core/gemini';
import { HelperError, pickModel, type HelperAnswer } from '../core/onlineHelper';
import { readHelper, saveHelper } from './helperSettings';

// Defined in core so code outside the browser (the control plane, tests) can use it. Existing callers import it from here.
export { HelperError };

/**
 * Whatever answers questions about a photo. Today that is Google's Gemini, called directly with the user's own key.
 * Later it can be the app's own server, which holds the key and checks a licence, without anything else changing.
 */
export interface HelperTransport {
  /** Ask about one photo, given as a small JPEG in base64. Throws a HelperError when it cannot answer. */
  ask(jpegBase64: string, signal?: AbortSignal): Promise<HelperAnswer>;
}


type Fetcher = typeof fetch;

/** Prevent a stalled browser/API request from leaving species recognition spinning forever. */
export const HELPER_REQUEST_TIMEOUT_MS = 12_000;

async function call(fetcher: Fetcher, url: string, key: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const signal = init.signal;
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, HELPER_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      ...init, signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch (error) {
    if (timedOut) throw new HelperError('timeout');
    if (signal?.aborted || (error as Error).name === 'AbortError') throw error;
    throw new HelperError(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'other');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

/** The models a key can use. Also the simplest way to test a key.
 * Search a small bounded number of Google pages, stopping as soon as a suitable
 * Flash model is found. The cancel signal is shared across all pages so closing
 * setup does not leave an apparently endless key-check spinner.
 */
export async function checkKey(key: string, fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<{ model: string }> {
  const seen = new Set<string>();
  let pageToken: string | null = null;
  for (let page = 0; page < 5; page++) {
    if (signal?.aborted) throw new DOMException('Key check cancelled.', 'AbortError');
    const query = new URLSearchParams({ pageSize: '200' });
    if (pageToken) query.set('pageToken', pageToken);
    const { status, body } = await call(fetcher, `${GEMINI_BASE}/models?${query}`, key, { method: 'GET', signal });
    const read = readGeminiResponse(status, body);
    if ('failure' in read && read.failure !== 'other' && read.failure !== 'blocked') throw new HelperError(read.failure);
    if (status < 200 || status >= 300) throw new HelperError('other', 'The online helper could not be reached. Check the key and your connection.');
    const model = pickModel(readModelList(body));
    if (model) return { model };
    const record = body && typeof body === 'object' ? body as Record<string, unknown> : null;
    const next = record?.nextPageToken;
    if (typeof next !== 'string' || !next || next.length > 1024 || seen.has(next)) break;
    seen.add(next);
    pageToken = next;
  }
  throw new HelperError('other', 'This key has no supported Flash model available. Check your model access in Google AI Studio.');
}

/** Gemini, called straight from the browser with the user's own key. The key only ever goes to Google. */
export function geminiTransport(key: string, fetcher: Fetcher = fetch): HelperTransport {
  return {
    async ask(jpegBase64, signal) {
      const stored = readHelper();
      const model = stored.model ?? (await checkKey(key, fetcher)).model;
      if (!stored.model) saveHelper({ ...readHelper(), model });
      const { url, body } = geminiRequest(model, jpegBase64);
      const { status, body: reply } = await call(fetcher, url, key, { method: 'POST', body: JSON.stringify(body), signal });
      if (status === 404) saveHelper({ ...readHelper(), model: undefined }); // The model went away: choose again next time.
      const read = readGeminiResponse(status, reply);
      if ('failure' in read) throw new HelperError(read.failure);
      return read.answer;
    },
  };
}

/** A small, upright JPEG of a picture for sending. Drawing it again strips every bit of camera data, including location. */
export function imageForHelper(source: HTMLCanvasElement, edge = 640): string {
  const scale = Math.min(1, edge / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8).split(',')[1] ?? '';
}
