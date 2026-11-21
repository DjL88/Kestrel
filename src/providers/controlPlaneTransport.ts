/**
 * The online helper through Kestrel's own control plane (services/control-plane)
 * instead of a user's Google key. Same HelperTransport interface, so callers do
 * not change. The provider key stays on the server; this side holds only a
 * short-lived session token and checks every answer again before use.
 */
import { HelperError, parseHelperAnswer, type HelperAnswer } from '../core/onlineHelper';
import { inspectJpeg } from '../core/jpegInspect';
// Type-only: the browser transport module reads Vite settings at load time.
import type { HelperTransport } from './onlineHelper';

/** Slightly longer than the server's own 12 s upstream deadline, so the server's answer wins. */
export const CONTROL_PLANE_TIMEOUT_MS = 15_000;

function base64Bytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function controlPlaneTransport(
  baseUrl: string, session: () => string | null, fetcher: typeof fetch = fetch,
): HelperTransport {
  const origin = new URL(baseUrl);
  if (origin.protocol !== 'https:' && origin.hostname !== 'localhost' && origin.hostname !== '127.0.0.1') {
    throw new Error('The control plane must be reached over https.');
  }
  return {
    async ask(jpegBase64, signal): Promise<HelperAnswer> {
      const token = session();
      if (!token) throw new HelperError('auth', 'Sign in to use the online helper.');
      // Never send a photo that still carries camera data: the redraw in imageForHelper should guarantee this.
      const facts = inspectJpeg(base64Bytes(jpegBase64));
      if (!facts || facts.hasMetadata) throw new HelperError('other', 'This photo could not be prepared for sending without its camera data.');

      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, CONTROL_PLANE_TIMEOUT_MS);
      let status: number, body: unknown;
      try {
        const response = await fetcher(new URL('/v1/ai/identify', origin).toString(), {
          method: 'POST', signal: controller.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ image: jpegBase64, userConsent: true }),
          cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
        });
        status = response.status;
        body = await response.json().catch(() => null);
      } catch (error) {
        if (timedOut) throw new HelperError('timeout');
        if (signal?.aborted || (error as Error).name === 'AbortError') throw error;
        throw new HelperError(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'other');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }

      const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
      if (status === 401 || status === 403) throw new HelperError('auth', code === 'AI_NOT_ENTITLED' ? 'The online helper is not part of this plan.' : 'Your session has ended. Sign in again to use the online helper.');
      if (status === 429) throw new HelperError('rate');
      if (status === 504) throw new HelperError('timeout');
      if (status < 200 || status >= 300) throw new HelperError('other');
      // The server already checked this; check again, because nothing unchecked reaches a photo.
      const answer = parseHelperAnswer(JSON.stringify(body));
      if (!answer) throw new HelperError('other');
      return answer;
    },
  };
}
