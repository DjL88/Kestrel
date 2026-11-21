import { authorizeUrl, challengeFor, CLOUD_DRIVES, exchangeBody, explainSignInError, isConfigured, makeVerifier, needsRefresh, parseTokens, refreshBody, type CloudDriveKind, type Tokens } from '../core/cloudDrive';
import { isDesktopApp } from './desktopShell';

/**
 * Signing in to Dropbox, Google Drive or OneDrive from the web build: a small pop-up, the provider's own sign-in page, and a
 * one-time code that Kestrel swaps for a token itself. The password never passes through Kestrel. Tokens stay on this device.
 */
const TOKENS = 'kestrel.cloud-tokens.v1.';
const REDIRECT = () => `${location.origin}/oauth-callback.html`;
const env = import.meta.env as Record<string, string | undefined>;

export const clientIdFor = (kind: CloudDriveKind) => env[CLOUD_DRIVES[kind].clientIdEnv];
const secretFor = (kind: CloudDriveKind) => { const name = CLOUD_DRIVES[kind].clientSecretEnv; return name ? env[name] : undefined; };

/** Offered only when this build has been registered with the provider and can open a sign-in window. */
export const cloudDriveAvailable = (kind: CloudDriveKind) => isConfigured(clientIdFor(kind)) && !isDesktopApp();

export function cloudDriveUnavailableReason(kind: CloudDriveKind): string | null {
  if (!isConfigured(clientIdFor(kind))) return `This copy of Kestrel is not yet registered with ${CLOUD_DRIVES[kind].name}. Use the ${CLOUD_DRIVES[kind].name} folder on your computer for now.`;
  if (isDesktopApp()) return `Signing in to ${CLOUD_DRIVES[kind].name} from the desktop app is coming. Use its folder on your computer, or sign in from the web version.`;
  return null;
}

type Answer = { code: string | null; state: string | null; error: string | null };

function waitForAnswer(popup: Window | null, state: string, timeoutMs = 180_000): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('kestrel-oauth') : null;
    const finish = (fn: () => void) => { window.removeEventListener('message', onMessage); channel?.close(); clearInterval(poll); clearTimeout(timer); fn(); };
    const accept = (data: unknown) => { const m = data as { kestrelOAuth?: boolean } & Answer; if (m?.kestrelOAuth && m.state === state) finish(() => resolve(m)); };
    const onMessage = (event: MessageEvent) => { if (event.origin === location.origin) accept(event.data); };
    window.addEventListener('message', onMessage);
    if (channel) channel.onmessage = (event) => accept(event.data);
    const poll = setInterval(() => { if (popup?.closed) finish(() => reject(new Error(explainSignInError('access_denied')))); }, 700);
    const timer = setTimeout(() => finish(() => reject(new Error(explainSignInError(null)))), timeoutMs);
  });
}

async function tokenRequest(kind: CloudDriveKind, body: URLSearchParams, now: number, previousRefresh?: string): Promise<Tokens> {
  let response: Response;
  try { response = await fetch(CLOUD_DRIVES[kind].tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }); }
  catch { throw new Error(`Could not reach ${CLOUD_DRIVES[kind].name}. Check your connection.`); }
  const json = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(explainSignInError(json?.error));
  return parseTokens(json, now, previousRefresh);
}

/** Open the provider's sign-in, and return tokens once the person has agreed. Must be called from a click. */
export async function signInToCloudDrive(kind: CloudDriveKind, now = Date.now()): Promise<Tokens> {
  const reason = cloudDriveUnavailableReason(kind);
  if (reason) throw new Error(reason);
  const clientId = clientIdFor(kind)!;
  const verifier = makeVerifier(crypto.getRandomValues(new Uint8Array(32)));
  const state = makeVerifier(crypto.getRandomValues(new Uint8Array(32)));
  const url = authorizeUrl(CLOUD_DRIVES[kind], { clientId, redirectUri: REDIRECT(), state, challenge: await challengeFor(verifier) });
  const popup = window.open(url, 'kestrel-oauth', 'popup,width=520,height=720');
  if (!popup) throw new Error('Your browser blocked the sign-in window. Allow pop-ups for this page and try again.');
  const answer = await waitForAnswer(popup, state);
  if (answer.error || !answer.code) throw new Error(explainSignInError(answer.error));
  return tokenRequest(kind, exchangeBody(CLOUD_DRIVES[kind], { clientId, clientSecret: secretFor(kind), code: answer.code, verifier, redirectUri: REDIRECT() }), now);
}

export function saveTokens(connectionId: string, tokens: Tokens): void { try { localStorage.setItem(TOKENS + connectionId, JSON.stringify(tokens)); } catch { /* this session only */ } }
const memory = new Map<string, Tokens>();
export function rememberTokens(connectionId: string, tokens: Tokens): void { memory.set(connectionId, tokens); saveTokens(connectionId, tokens); }
export function forgetTokens(connectionId: string): void { memory.delete(connectionId); try { localStorage.removeItem(TOKENS + connectionId); } catch { /* nothing */ } }
export function hasTokens(connectionId: string): boolean { return readTokens(connectionId) !== null; }
function readTokens(connectionId: string): Tokens | null {
  const held = memory.get(connectionId);
  if (held) return held;
  try { const stored = JSON.parse(localStorage.getItem(TOKENS + connectionId) ?? 'null') as Tokens | null; if (stored?.accessToken) { memory.set(connectionId, stored); return stored; } } catch { /* none */ }
  return null;
}

/** A current access token for one connection, refreshed quietly when it is about to expire. */
export async function accessTokenFor(connectionId: string, kind: CloudDriveKind, now = Date.now()): Promise<string> {
  const tokens = readTokens(connectionId);
  if (!tokens) throw new Error(`Sign in to ${CLOUD_DRIVES[kind].name} again.`);
  if (!needsRefresh(tokens, now)) return tokens.accessToken;
  if (!tokens.refreshToken) throw new Error(`Sign in to ${CLOUD_DRIVES[kind].name} again.`);
  try {
    const fresh = await tokenRequest(kind, refreshBody({ clientId: clientIdFor(kind) ?? '', clientSecret: secretFor(kind), refreshToken: tokens.refreshToken }), now, tokens.refreshToken);
    rememberTokens(connectionId, fresh);
    return fresh.accessToken;
  } catch (error) {
    // A network failure keeps the sign-in; only a refused refresh asks the person to sign in again.
    if (error instanceof Error && /Could not reach/.test(error.message)) throw error;
    throw new Error(`Sign in to ${CLOUD_DRIVES[kind].name} again.`);
  }
}
