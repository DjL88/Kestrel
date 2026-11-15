import { geminiRequest, readGeminiResponse, readModelList, GEMINI_BASE } from '../core/gemini';
import { failureMessage, pickModel, type HelperAnswer, type HelperFailure } from '../core/onlineHelper';
import { readHelper, saveHelper } from './helperSettings';

/**
 * Whatever answers questions about a photo. Today that is Google's Gemini, called directly with the user's own key.
 * Later it can be the app's own server, which holds the key and checks a licence, without anything else changing.
 */
export interface HelperTransport {
  /** Ask about one photo, given as a small JPEG in base64. Throws a HelperError when it cannot answer. */
  ask(jpegBase64: string, signal?: AbortSignal): Promise<HelperAnswer>;
}

export class HelperError extends Error {
  constructor(readonly failure: HelperFailure, message = failureMessage(failure).text) { super(message); }
}

type Fetcher = typeof fetch;

async function call(fetcher: Fetcher, url: string, key: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new HelperError(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'other');
  }
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** The models a key can use. Also the simplest way to test a key. */
export async function checkKey(key: string, fetcher: Fetcher = fetch): Promise<{ model: string }> {
  const { status, body } = await call(fetcher, `${GEMINI_BASE}/models?pageSize=200`, key, { method: 'GET' });
  const read = readGeminiResponse(status, body);
  if ('failure' in read && read.failure !== 'other' && read.failure !== 'blocked') throw new HelperError(read.failure);
  if (status < 200 || status >= 300) throw new HelperError('other', 'The online helper could not be reached. Check the key and your connection.');
  const model = pickModel(readModelList(body));
  if (!model) throw new HelperError('other', 'This key has no suitable model available.');
  return { model };
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
