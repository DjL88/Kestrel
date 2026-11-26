/**
 * Microsoft (Entra ID / Microsoft 365, and personal Microsoft accounts) sign-in. Pure: no network, no browser.
 *
 * The web build uses Firebase Auth's `microsoft.com` provider in a pop-up, tenant `common`. The installed desktop app
 * opens Microsoft's own page in the person's normal browser, receives a one-time code on the loopback listener the
 * cloud drives and Google sign-in already use (authorisation code with PKCE, public client, no secret), swaps it for
 * Microsoft's ID token and hands that to Firebase. Firebase's documentation says it may not accept a Microsoft token
 * handed over this way, so the desktop route stays behind `VITE_MICROSOFT_DESKTOP_SIGNIN=on` until a real sign-in in an
 * installed build has proved it (owner, 26 Nov 2026). The web pop-up itself is switched on by VITE_MICROSOFT_SIGN_IN.
 */
export const MICROSOFT_TENANT = 'common';
export const MICROSOFT_AUTHORIZE_URL = `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/authorize`;
export const MICROSOFT_TOKEN_URL = `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/token`;

export interface DesktopMicrosoftClient {
  /** The Entra app's Application (client) ID: the same app Firebase Auth's Microsoft provider is set up with. */
  clientId: string;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const on = (value: string | undefined) => ['1', 'true', 'on'].includes(value?.trim().toLowerCase() ?? '');

/** Whether this build shows Sign in with Microsoft at all (set once the provider is enabled in Firebase Auth). */
export const microsoftSignInEnabled = (env: Record<string, string | undefined>) => on(env.VITE_MICROSOFT_SIGN_IN);

/**
 * The Entra client the desktop app signs in with, or null when the desktop route is off. Needs Microsoft switched on for
 * the build, the desktop flag, and an Entra client id: a dedicated one, else the OneDrive one, because both are the same
 * InFlight app registration (owner's tenant, 26 Nov 2026).
 */
export function desktopMicrosoftClient(env: Record<string, string | undefined>): DesktopMicrosoftClient | null {
  if (!microsoftSignInEnabled(env) || !on(env.VITE_MICROSOFT_DESKTOP_SIGNIN)) return null;
  const clientId = [env.VITE_MICROSOFT_SIGNIN_CLIENT_ID, env.VITE_ONEDRIVE_CLIENT_ID].map((v) => v?.trim()).find((v) => v && GUID.test(v));
  return clientId ? { clientId } : null;
}

/** Microsoft's sign-in page asking only who the person is (openid, email, profile). No files, no offline access. */
export function microsoftSignInUrl(args: { clientId: string; redirectUri: string; state: string; challenge: string; hashedNonce: string }): string {
  const url = new URL(MICROSOFT_AUTHORIZE_URL);
  const params: Record<string, string> = {
    response_type: 'code', response_mode: 'query', client_id: args.clientId, redirect_uri: args.redirectUri, state: args.state,
    nonce: args.hashedNonce, code_challenge: args.challenge, code_challenge_method: 'S256', scope: 'openid email profile', prompt: 'select_account',
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/** Form body for swapping the one-time code for tokens. A public client: no secret is ever sent. */
export function microsoftCodeExchangeBody(args: { clientId: string; code: string; verifier: string; redirectUri: string }): URLSearchParams {
  return new URLSearchParams({ grant_type: 'authorization_code', code: args.code, client_id: args.clientId, code_verifier: args.verifier, redirect_uri: args.redirectUri, scope: 'openid email profile' });
}

function decodeSegment(segment: string): unknown {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))));
}

/**
 * The ID token from Microsoft's answer, after checking it was minted for this app, by Microsoft, for this attempt
 * (audience, issuer, nonce). Firebase checks the signature; this only refuses a token that cannot belong to this sign-in.
 */
export function microsoftIdTokenFromAnswer(body: unknown, expected: { clientId: string; hashedNonce: string }): string {
  const idToken = (body as { id_token?: unknown } | null)?.id_token;
  if (typeof idToken !== 'string' || idToken.split('.').length !== 3) throw new Error('Microsoft did not confirm who you are. Try again.');
  let claims: { aud?: unknown; nonce?: unknown; iss?: unknown; tid?: unknown };
  try { claims = decodeSegment(idToken.split('.')[1]!) as typeof claims; } catch { throw new Error('Microsoft did not confirm who you are. Try again.'); }
  const issuerOk = typeof claims.iss === 'string' && typeof claims.tid === 'string' && claims.iss === `https://login.microsoftonline.com/${claims.tid}/v2.0`;
  if (claims.aud !== expected.clientId || claims.nonce !== expected.hashedNonce || !issuerOk) throw new Error('That Microsoft answer was not for this sign-in. Try again.');
  return idToken;
}

/** Firebase's refusal codes that mean it will not take a Microsoft token from the desktop app (see the note above). */
export function desktopMicrosoftRefused(code: string): boolean {
  return code === 'auth/invalid-credential' || code === 'auth/invalid-idp-response' || code === 'auth/argument-error';
}

export const DESKTOP_MICROSOFT_REFUSED = 'The sign-in service did not accept Microsoft sign-in from the desktop app. Nothing changed. Sign in with Microsoft on the web version, or use email and password here.';
