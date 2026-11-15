import { HELPER_PROMPT, HELPER_SCHEMA, parseHelperAnswer, type HelperAnswer, type HelperFailure } from './onlineHelper';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** The request for one photo. The key goes in a header, never in the address or the body, so it is not logged or cached. */
export function geminiRequest(model: string, jpegBase64: string) {
  return {
    url: `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`,
    body: {
      contents: [{ role: 'user', parts: [{ text: HELPER_PROMPT }, { inlineData: { mimeType: 'image/jpeg', data: jpegBase64 } }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: HELPER_SCHEMA, temperature: 0 },
    },
  };
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Understand a reply from Gemini: an answer to use, or a reason it cannot be used. */
export function readGeminiResponse(status: number, body: unknown): { answer: HelperAnswer } | { failure: HelperFailure } {
  const error = isObject(body) && isObject(body.error) ? body.error : null;
  if (status === 429 || error?.status === 'RESOURCE_EXHAUSTED') return { failure: 'rate' };
  if (status === 401 || status === 403 || error?.status === 'UNAUTHENTICATED' || error?.status === 'PERMISSION_DENIED' ||
    (status === 400 && typeof error?.message === 'string' && /api key/i.test(error.message))) return { failure: 'auth' };
  if (status < 200 || status >= 300 || error) return { failure: 'other' };
  if (!isObject(body)) return { failure: 'other' };
  if (isObject(body.promptFeedback) && body.promptFeedback.blockReason) return { failure: 'blocked' };
  const candidate = Array.isArray(body.candidates) && isObject(body.candidates[0]) ? body.candidates[0] : null;
  if (!candidate) return { failure: 'blocked' };
  if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') return { failure: 'blocked' };
  const parts = isObject(candidate.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const text = parts.map((part) => (isObject(part) && typeof part.text === 'string' ? part.text : '')).join('');
  const answer = text ? parseHelperAnswer(text) : null;
  return answer ? { answer } : { failure: 'other' };
}

/** The models a key can use, from the list reply, ignoring anything that does not look right. */
export function readModelList(body: unknown): { name: string; supportedGenerationMethods: string[] }[] {
  if (!isObject(body) || !Array.isArray(body.models)) return [];
  return body.models.flatMap((entry) => (isObject(entry) && typeof entry.name === 'string' && entry.name.length < 120
    ? [{ name: entry.name, supportedGenerationMethods: Array.isArray(entry.supportedGenerationMethods) ? entry.supportedGenerationMethods.filter((m): m is string => typeof m === 'string') : [] }] : []));
}
