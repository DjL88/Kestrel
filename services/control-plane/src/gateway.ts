/**
 * Managed AI gateway. Provider keys live only in this process's environment.
 * Every call is bounded by a hard timeout and its output is validated with the
 * same parsers the app uses, so nothing unchecked reaches a photo.
 */
import { GEMINI_BASE, geminiRequest, readGeminiResponse } from '../../../src/core/gemini.ts';
import { parseHelperAnswer, type HelperAnswer } from '../../../src/core/onlineHelper.ts';
import { RECIPE_PROMPT, parseRecipeProposal, type RecipeProposal } from '../../../src/core/recipeProposal.ts';
import { VERIFY_COLOUR_PROMPT, VERIFY_COLOUR_SCHEMA, parseColourVerification, type ColourVerificationAnswer } from '../../../src/core/colourVerification.ts';
import { ApiError } from './http.ts';

/** Raw upstream output. The gateway, not the provider, decides whether it is usable. */
export interface AiProvider {
  readonly name: string;
  identify(jpegBase64: string, signal: AbortSignal): Promise<string>;
  suggest(jpegBase64: string, signal: AbortSignal): Promise<string>;
  /** A plain-English second opinion on the colour grade of a photo the person has already finished editing. */
  verifyColour(jpegBase64: string, signal: AbortSignal): Promise<string>;
}

/** Run one upstream call with a hard deadline. A hang becomes a finite, retryable error. */
export async function withDeadline<T>(timeoutMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ApiError(504, 'AI_UPSTREAM_TIMEOUT', 'The AI provider did not answer in time. Try again later.', true));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'AI_UPSTREAM_FAILED', 'The AI provider could not be reached. Try again later.', true);
  } finally {
    clearTimeout(timer);
  }
}

export async function identify(provider: AiProvider, jpegBase64: string, timeoutMs: number): Promise<HelperAnswer> {
  const text = await withDeadline(timeoutMs, (signal) => provider.identify(jpegBase64, signal));
  const answer = typeof text === 'string' ? parseHelperAnswer(text) : null;
  if (!answer) throw new ApiError(502, 'AI_UPSTREAM_MALFORMED', 'The AI provider gave an answer Kestrel could not use.', true);
  return answer;
}

export async function suggest(provider: AiProvider, jpegBase64: string, timeoutMs: number): Promise<RecipeProposal> {
  const text = await withDeadline(timeoutMs, (signal) => provider.suggest(jpegBase64, signal));
  const proposal = typeof text === 'string' ? parseRecipeProposal(text) : null;
  if (!proposal) throw new ApiError(502, 'AI_UPSTREAM_MALFORMED', 'The AI provider gave an answer Kestrel could not use.', true);
  return proposal;
}

/**
 * A second opinion on a FINISHED edit's colour grade. Complements, and never overrides, the on-device,
 * measured Colour Confidence check - this is just a plain-English plausibility read from the cloud model.
 */
export async function verifyColour(provider: AiProvider, jpegBase64: string, timeoutMs: number): Promise<ColourVerificationAnswer> {
  const text = await withDeadline(timeoutMs, (signal) => provider.verifyColour(jpegBase64, signal));
  const answer = typeof text === 'string' ? parseColourVerification(text) : null;
  if (!answer) throw new ApiError(502, 'AI_UPSTREAM_MALFORMED', 'The AI provider gave an answer Kestrel could not use.', true);
  return answer;
}

/** Google Gemini, called from the server with the server's key. Reuses the app's request builder. */
export function geminiProvider(apiKey: string, model: string, fetcher: typeof fetch = fetch): AiProvider {
  const post = async (body: unknown, signal: AbortSignal) => {
    const response = await fetcher(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  return {
    name: 'gemini',
    async identify(jpegBase64, signal) {
      const { status, body } = await post(geminiRequest(model, jpegBase64).body, signal);
      const read = readGeminiResponse(status, body);
      if ('failure' in read) throw new Error(`gemini ${read.failure}`);
      return JSON.stringify(read.answer);
    },
    async suggest(jpegBase64, signal) {
      const { status, body } = await post({
        contents: [{ role: 'user', parts: [{ text: RECIPE_PROMPT }, { inlineData: { mimeType: 'image/jpeg', data: jpegBase64 } }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }, signal);
      if (status < 200 || status >= 300) throw new Error(`gemini ${status}`);
      const text = (body as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string') throw new Error('gemini empty');
      return text;
    },
    async verifyColour(jpegBase64, signal) {
      const { status, body } = await post({
        contents: [{ role: 'user', parts: [{ text: VERIFY_COLOUR_PROMPT }, { inlineData: { mimeType: 'image/jpeg', data: jpegBase64 } }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: VERIFY_COLOUR_SCHEMA, temperature: 0 },
      }, signal);
      if (status < 200 || status >= 300) throw new Error(`gemini ${status}`);
      const text = (body as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string') throw new Error('gemini empty');
      return text;
    },
  };
}
