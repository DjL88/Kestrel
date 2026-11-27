/**
 * Apple sign-in for the installed desktop app. Apple only returns to an HTTPS address registered on the Services ID,
 * never to this computer, so the app opens InFlight's own sign-in page (`/apple-signin` on the website) in the person's
 * normal browser. That page runs Apple's sign-in, then hands Apple's ID token to the app's one-shot loopback listener
 * (the one Google sign-in and the cloud drives use). The app checks the token and gives it to Firebase with the raw
 * nonce, which only the app knows. The password never passes through InFlight. Pure: no network, no browser.
 */

/** The Services ID registered with Apple and on Firebase Auth's Apple provider (project kestrel-photo). Public. */
export const DEFAULT_APPLE_SERVICES_ID = 'app.kestrel.photo.web';

export interface DesktopAppleConfig { servicesId: string; pageUrl: string }

const usable = (value: string | undefined) => typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

/**
 * Where the desktop app sends people to sign in with Apple, or null when this build has no website address. The page
 * lives on the InFlight website (`VITE_KESTREL_SITE_URL`); its address is registered as a return URL with Apple.
 */
export function desktopAppleConfig(env: Record<string, string | undefined>): DesktopAppleConfig | null {
  const site = usable(env.VITE_KESTREL_SITE_URL);
  if (!site) return null;
  let origin: URL;
  try { origin = new URL(site); } catch { return null; }
  if (origin.protocol !== 'https:') return null;
  return { servicesId: usable(env.VITE_APPLE_SERVICES_ID) ?? DEFAULT_APPLE_SERVICES_ID, pageUrl: new URL('/apple-signin', origin.origin).toString() };
}

/** Lower-case hex SHA-256, the form Apple and Firebase expect for the nonce in the token. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The website page that runs Apple's sign-in for this attempt. Only the state and the hashed nonce travel. */
export function appleSignInPageUrl(config: DesktopAppleConfig, args: { state: string; hashedNonce: string }): string {
  const url = new URL(config.pageUrl);
  url.searchParams.set('state', args.state);
  url.searchParams.set('nonce', args.hashedNonce);
  return url.toString();
}

function decodeSegment(segment: string): unknown {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))));
}

export interface AppleAnswer { idToken: string; displayName?: string }

/**
 * Apple's answer as the sign-in page handed it to the loopback listener. Refuses an answer for another attempt (state),
 * another app (audience) or another nonce. Firebase checks the token's signature; this only stops a mix-up early.
 */
export function appleAnswerFromQuery(query: string, expected: { state: string; servicesId: string; hashedNonce: string }): AppleAnswer {
  const params = new URLSearchParams(query.replace(/^\?/, ''));
  if (params.get('state') !== expected.state) throw new Error('The sign-in answer did not match this request, so it was ignored. Try again.');
  const error = params.get('error');
  if (error) throw new Error(error === 'popup_closed_by_user' || error === 'user_cancelled_authorize' ? 'Sign-in was cancelled. Nothing changed.' : 'Apple sign-in did not finish. Nothing changed; try again.');
  const idToken = params.get('id_token');
  if (!idToken || idToken.split('.').length !== 3) throw new Error('Apple did not confirm who you are. Try again.');
  let claims: { aud?: unknown; nonce?: unknown; iss?: unknown };
  try { claims = decodeSegment(idToken.split('.')[1]!) as typeof claims; } catch { throw new Error('Apple did not confirm who you are. Try again.'); }
  if (claims.iss !== 'https://appleid.apple.com' || claims.aud !== expected.servicesId || claims.nonce !== expected.hashedNonce) {
    throw new Error('That Apple answer was not for this sign-in. Try again.');
  }
  // Apple sends the person's name only the first time they sign in to InFlight, and never inside the token.
  const name = [params.get('first_name'), params.get('last_name')].map((part) => part?.trim()).filter(Boolean).join(' ').slice(0, 120);
  return name ? { idToken, displayName: name } : { idToken };
}

/** Plain-English text for a failure after Apple answered (Firebase refused it, or the network was down). */
export function appleFirebaseFailureMessage(error: unknown): string {
  const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : '';
  if (code === 'auth/network-request-failed') return 'InFlight could not reach its sign-in service. Check your internet connection and try again.';
  if (code === 'auth/invalid-credential' || code === 'auth/invalid-id-token' || code === 'auth/operation-not-allowed') return `Apple confirmed you, but InFlight's sign-in service refused the answer (${code}). Nothing changed. Try again, or use email or Google.`;
  if (code === 'auth/account-exists-with-different-credential') return 'This email already has an InFlight account that signs in another way. Sign in that way, then add Apple in Settings.';
  return error instanceof Error && error.message ? `Apple sign-in did not finish: ${error.message}` : 'Apple sign-in did not finish. Nothing changed; try again.';
}
