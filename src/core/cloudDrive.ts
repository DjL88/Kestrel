/**
 * Sign-in providers for Dropbox, Google Drive and OneDrive. Pure: no network, no browser. The person signs in once with
 * their own account (OAuth 2.0 authorisation code with PKCE, so no secret has to ship in the app) and Kestrel only ever
 * sees its own folder: Dropbox "App folder", Google's `drive.file` scope, OneDrive's App Folder. Nothing else in the
 * account is visible to Kestrel, and nothing is sent anywhere but the provider the person chose.
 */
export type CloudDriveKind = 'dropbox' | 'googledrive' | 'onedrive';

export interface CloudDriveConfig {
  kind: CloudDriveKind;
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Extra query parameters that make the provider hand back a refresh token. */
  authorizeExtras: Record<string, string>;
  /** Where the owner registers the app and gets the client id. Shown in the setup guide, not to end users. */
  consoleUrl: string;
  /** The build setting that holds the public client id. */
  clientIdEnv: string;
  /** Optional: only for providers that insist on one (Google "Desktop app" clients). Not confidential by the provider's own rules. */
  clientSecretEnv?: string;
}

export const CLOUD_DRIVES: Record<CloudDriveKind, CloudDriveConfig> = {
  dropbox: {
    kind: 'dropbox', name: 'Dropbox',
    authorizeUrl: 'https://www.dropbox.com/oauth2/authorize', tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scopes: ['files.content.read', 'files.content.write', 'account_info.read'],
    authorizeExtras: { token_access_type: 'offline' },
    consoleUrl: 'https://www.dropbox.com/developers/apps', clientIdEnv: 'VITE_DROPBOX_APP_KEY',
  },
  googledrive: {
    kind: 'googledrive', name: 'Google Drive',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    authorizeExtras: { access_type: 'offline', prompt: 'consent' },
    consoleUrl: 'https://console.cloud.google.com/apis/credentials', clientIdEnv: 'VITE_GOOGLE_DRIVE_CLIENT_ID', clientSecretEnv: 'VITE_GOOGLE_DRIVE_CLIENT_SECRET',
  },
  onedrive: {
    kind: 'onedrive', name: 'Microsoft OneDrive',
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['Files.ReadWrite.AppFolder', 'offline_access'],
    authorizeExtras: {},
    consoleUrl: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade', clientIdEnv: 'VITE_ONEDRIVE_CLIENT_ID',
  },
};

export const isCloudDrive = (kind: string): kind is CloudDriveKind => kind in CLOUD_DRIVES;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** RFC 7636 code verifier from 32 random bytes (43 characters). */
export function makeVerifier(bytes: Uint8Array): string {
  if (bytes.length < 32) throw new Error('A PKCE verifier needs at least 32 random bytes.');
  return toBase64Url(bytes);
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** S256 challenge: base64url(sha256(verifier)). */
export async function challengeFor(verifier: string): Promise<string> {
  if (!BASE64URL.test(verifier)) throw new Error('The verifier is not URL-safe.');
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export function authorizeUrl(config: CloudDriveConfig, args: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const url = new URL(config.authorizeUrl);
  const params: Record<string, string> = {
    response_type: 'code', client_id: args.clientId, redirect_uri: args.redirectUri, state: args.state,
    code_challenge: args.challenge, code_challenge_method: 'S256', scope: config.scopes.join(' '), ...config.authorizeExtras,
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export interface Tokens { accessToken: string; refreshToken?: string; /** Epoch ms. */ expiresAt: number }

/** Read a token answer. A missing refresh token on a refresh keeps the old one (providers differ). */
export function parseTokens(body: unknown, now: number, previousRefresh?: string): Tokens {
  const b = body as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown } | null;
  if (!b || typeof b.access_token !== 'string' || !b.access_token) throw new Error('The sign-in answer had no access token.');
  const seconds = typeof b.expires_in === 'number' && b.expires_in > 0 ? b.expires_in : 3600;
  return { accessToken: b.access_token, refreshToken: typeof b.refresh_token === 'string' ? b.refresh_token : previousRefresh, expiresAt: now + seconds * 1000 };
}

/** Refresh a minute early so a request never goes out with a token that dies on the way. */
export const needsRefresh = (tokens: Tokens, now: number) => now >= tokens.expiresAt - 60_000;

/** Form body for the code exchange. */
export function exchangeBody(config: CloudDriveConfig, args: { clientId: string; clientSecret?: string; code: string; verifier: string; redirectUri: string }): URLSearchParams {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code: args.code, client_id: args.clientId, code_verifier: args.verifier, redirect_uri: args.redirectUri });
  if (args.clientSecret) body.set('client_secret', args.clientSecret);
  return body;
}

export function refreshBody(args: { clientId: string; clientSecret?: string; refreshToken: string }): URLSearchParams {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: args.refreshToken, client_id: args.clientId });
  if (args.clientSecret) body.set('client_secret', args.clientSecret);
  return body;
}

/** Plain reasons for the things that go wrong at sign-in. */
export function explainSignInError(code: string | null | undefined): string {
  switch (code) {
    case 'access_denied': return 'Sign-in was cancelled. Nothing changed.';
    case 'invalid_client': return 'This copy of Kestrel is not yet registered with that service. Use the folder option for now.';
    case 'state_mismatch': return 'The sign-in answer did not match this request, so it was ignored. Try again.';
    case 'invalid_grant': return 'The sign-in has expired or was withdrawn. Sign in again.';
    default: return 'Sign-in did not finish. Nothing changed; try again.';
  }
}

/** Whether this build has been given a client id for a provider. Without one the option is shown but not offered. */
export const isConfigured = (clientId: string | undefined) => typeof clientId === 'string' && clientId.trim().length > 6;

/** Where the system browser comes back to on desktop: a one-shot listener on this computer only (see src-tauri/src/oauth_loopback.rs). */
export const DESKTOP_REDIRECT = 'http://localhost:53682/oauth-callback';

/** Read the query string the listener hands back. The state must match the one sent, or the answer is ignored. */
export function parseCallbackQuery(query: string, expectedState: string): { code: string | null; error: string | null } {
  const params = new URLSearchParams(query.replace(/^\?/, ''));
  if (params.get('state') !== expectedState) return { code: null, error: 'state_mismatch' };
  return { code: params.get('code'), error: params.get('error') };
}
