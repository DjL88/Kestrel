/**
 * Google sign-in for the installed desktop app. Firebase's pop-up cannot run inside the app's webview, so the app opens
 * Google's own page in the person's normal browser, receives a one-time code on a loopback address on this computer
 * (OAuth 2.0 authorisation code with PKCE), swaps it for Google's ID token, and hands that token to Firebase. The
 * password never passes through InFlight. Pure: no network, no browser.
 */
export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface DesktopGoogleClient { clientId: string; clientSecret?: string }

const usable = (value: string | undefined) => typeof value === 'string' && value.trim().length > 6 ? value.trim() : undefined;

/**
 * The Google "Desktop app" OAuth client for sign-in. A dedicated client is preferred; the Google Drive desktop client
 * is reused when it is the only one, because both live in the owner's Google Cloud project. Firebase accepts the token
 * only if that client is in the Firebase project or on its Google provider's safelist.
 */
export function desktopGoogleClient(env: Record<string, string | undefined>): DesktopGoogleClient | null {
  const own = usable(env.VITE_GOOGLE_SIGNIN_CLIENT_ID);
  if (own) return { clientId: own, clientSecret: usable(env.VITE_GOOGLE_SIGNIN_CLIENT_SECRET) };
  const drive = usable(env.VITE_GOOGLE_DRIVE_CLIENT_ID);
  return drive ? { clientId: drive, clientSecret: usable(env.VITE_GOOGLE_DRIVE_CLIENT_SECRET) } : null;
}

/** Google's sign-in page asking only who the person is (openid, email, profile). No offline access, no other data. */
export function googleSignInUrl(args: { clientId: string; redirectUri: string; state: string; challenge: string; nonce: string }): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  const params: Record<string, string> = {
    response_type: 'code', client_id: args.clientId, redirect_uri: args.redirectUri, state: args.state, nonce: args.nonce,
    code_challenge: args.challenge, code_challenge_method: 'S256', scope: 'openid email profile', prompt: 'select_account',
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/** Form body for swapping the one-time code for tokens. */
export function googleCodeExchangeBody(args: { clientId: string; clientSecret?: string; code: string; verifier: string; redirectUri: string }): URLSearchParams {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code: args.code, client_id: args.clientId, code_verifier: args.verifier, redirect_uri: args.redirectUri });
  if (args.clientSecret) body.set('client_secret', args.clientSecret);
  return body;
}

function decodeSegment(segment: string): unknown {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))));
}

/**
 * The ID token from Google's answer, after checking it was minted for this client and this attempt (audience and nonce).
 * Its signature is checked by Firebase, which is the party that trusts it; this check only refuses a token that could not
 * belong to this sign-in, so a mix-up fails here with a plain message instead of later.
 */
export function idTokenFromAnswer(body: unknown, expected: { clientId: string; nonce: string }): string {
  const idToken = (body as { id_token?: unknown } | null)?.id_token;
  if (typeof idToken !== 'string' || idToken.split('.').length !== 3) throw new Error('Google did not confirm who you are. Try again.');
  let claims: { aud?: unknown; nonce?: unknown };
  try { claims = decodeSegment(idToken.split('.')[1]!) as typeof claims; } catch { throw new Error('Google did not confirm who you are. Try again.'); }
  if (claims.aud !== expected.clientId || claims.nonce !== expected.nonce) throw new Error('That Google answer was not for this sign-in. Try again.');
  return idToken;
}
