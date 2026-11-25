import type { AuthProvider, Session, SignInProvider } from '../core/cloudInterfaces';
import type { SignInPlatform } from '../core/signInOptions';
import { isDesktopApp } from './desktopShell';
import { friendlyAuthError } from '../core/authError';
import { challengeFor, explainSignInError, makeVerifier, parseCallbackQuery } from '../core/cloudDrive';
import { desktopGoogleClient, googleCodeExchangeBody, googleSignInUrl, GOOGLE_TOKEN_URL, idTokenFromAnswer } from '../core/desktopGoogleSignIn';

/** Public web configuration from Firebase. These are identifiers, not secrets (see docs/BACKEND.md). */
const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const isSignInConfigured = () => Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);

/** The Google desktop OAuth client this build signs in with, if any (see desktopGoogleSignIn.ts). */
const googleDesktop = desktopGoogleClient(env as Record<string, string | undefined>);
export const isDesktopGoogleConfigured = () => googleDesktop !== null;

export function signInPlatform(): SignInPlatform {
  if (!isDesktopApp()) return 'web';
  const agent = navigator.userAgent;
  return /iPhone|iPad/.test(agent) ? 'ios' : /Android/.test(agent) ? 'android' : 'desktop';
}

/** The Firebase code is loaded only when someone opens sign-in, so offline use and start-up never pay for it. */
async function firebase() {
  const [{ initializeApp, getApps }, auth] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  // Never attach InFlight authentication to an unrelated Firebase app that another
  // optional service may have initialised first in this webview.
  const app = getApps().find((candidate) => candidate.name === 'kestrel-auth') ?? initializeApp(config, 'kestrel-auth');
  return { auth, instance: auth.getAuth(app) };
}

const toSession = (user: import('firebase/auth').User, provider: SignInProvider): Session => ({
  accountId: user.uid,
  provider,
  email: user.email ?? undefined,
  displayName: user.displayName ?? undefined,
  expiresAtMs: Date.now() + 60 * 60 * 1000,
});

const providerOf = (user: import('firebase/auth').User): SignInProvider =>
  user.providerData.some((p) => p.providerId === 'apple.com') ? 'apple'
    : user.providerData.some((p) => p.providerId === 'password') ? 'password' : 'google';



/** Email and password work in the browser and, unlike pop-ups, would also work in the installed apps; the apps still wait on their own Settings wiring. */
async function withAuth<T>(run: (a: Awaited<ReturnType<typeof firebase>>) => Promise<T>): Promise<T> {
  if (!isSignInConfigured()) throw new Error('Sign-in is not set up in this build.');
  try { return await run(await firebase()); } catch (error) { throw new Error(friendlyAuthError(error)); }
}

/** Request a fresh verification email for the current signed-in user, never an arbitrary address. */
export function resendAccountVerification(): Promise<'already_verified' | 'sent'> {
  return withAuth(async ({ auth, instance }) => {
    await instance.authStateReady();
    const user = instance.currentUser;
    if (!user) throw new Error('Sign in again before requesting verification.');
    await auth.reload(user);
    if (instance.currentUser?.uid !== user.uid) throw new Error('The account changed. Sign in again.');
    if (user.emailVerified) return 'already_verified';
    await auth.sendEmailVerification(user);
    return 'sent';
  });
}

const randomToken = () => makeVerifier(crypto.getRandomValues(new Uint8Array(32)));
const loopbackError = (error: unknown) => new Error(typeof error === 'string' ? error : 'Google sign-in did not finish. Try again.');

/**
 * Desktop: Google's page opens in the person's normal browser (where they are probably signed in already), a one-shot
 * listener on this computer receives the one-time code, the app swaps it for Google's ID token, and Firebase signs in
 * with that token. Uses the same loopback listener and HTTP client as the Google Drive connection.
 */
async function signInWithGoogleOnDesktop(client: NonNullable<typeof googleDesktop>): Promise<import('../core/cloudInterfaces').Session> {
  const { invoke } = await import('@tauri-apps/api/core');
  const verifier = randomToken();
  const state = randomToken();
  const nonce = randomToken();
  const challenge = await challengeFor(verifier);
  let redirectUri: string;
  try { redirectUri = await invoke<string>('oauth_listen_start'); } catch (error) { throw loopbackError(error); }
  let query: string;
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(googleSignInUrl({ clientId: client.clientId, redirectUri, state, challenge, nonce }));
    query = await invoke<string>('oauth_listen_wait', { timeoutSecs: 180 });
  } catch (error) {
    await invoke('oauth_listen_stop').catch(() => undefined);
    throw loopbackError(error);
  }
  const answer = parseCallbackQuery(query, state);
  if (answer.error || !answer.code) throw new Error(explainSignInError(answer.error));
  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
  let response: Response;
  try {
    response = await tauriFetch(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: googleCodeExchangeBody({ clientId: client.clientId, clientSecret: client.clientSecret, code: answer.code, verifier, redirectUri }) });
  } catch { throw new Error('Could not reach Google. Check your connection.'); }
  const json = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(explainSignInError(json?.error));
  const idToken = idTokenFromAnswer(json, { clientId: client.clientId, nonce });
  return withAuth(async ({ auth, instance }) => toSession((await auth.signInWithCredential(instance, auth.GoogleAuthProvider.credential(idToken))).user, 'google'));
}

export const firebaseAuth: AuthProvider = {
  signInWithEmail: (email, password) => withAuth(async ({ auth, instance }) => toSession((await auth.signInWithEmailAndPassword(instance, email.trim(), password)).user, 'password')),
  createAccount: (email, password) => withAuth(async ({ auth, instance }) => {
    const { user } = await auth.createUserWithEmailAndPassword(instance, email.trim(), password);
    await auth.sendEmailVerification(user).catch(() => undefined);
    return toSession(user, 'password');
  }),
  sendPasswordReset: (email) => withAuth(({ auth, instance }) => auth.sendPasswordResetEmail(instance, email.trim())),
  async signIn(provider) {
    if (!isSignInConfigured()) throw new Error('Sign-in is not set up in this build.');
    if (signInPlatform() === 'desktop' && provider === 'google' && googleDesktop) return signInWithGoogleOnDesktop(googleDesktop);
    if (signInPlatform() !== 'web') throw new Error('Google and Apple sign-in are not built for installed apps yet. Use email and password here, or sign in on the web.');
    try {
      const { auth, instance } = await firebase();
      const chosen = provider === 'apple' ? new auth.OAuthProvider('apple.com') : new auth.GoogleAuthProvider();
      if (provider === 'apple') { chosen.addScope('email'); chosen.addScope('name'); }
      const result = await auth.signInWithPopup(instance, chosen);
      return toSession(result.user, provider);
    } catch (error) {
      throw new Error(friendlyAuthError(error));
    }
  },
  async signOut() {
    if (!isSignInConfigured()) return;
    const { auth, instance } = await firebase();
    await auth.signOut(instance);
  },
  async idToken(forceRefresh = false) {
    if (!isSignInConfigured()) return null;
    const { instance } = await firebase();
    await instance.authStateReady();
    return instance.currentUser ? instance.currentUser.getIdToken(forceRefresh) : null;
  },
  async current() {
    if (!isSignInConfigured()) return null;
    const { auth, instance } = await firebase();
    await instance.authStateReady();
    return instance.currentUser ? toSession(instance.currentUser, providerOf(instance.currentUser)) : null;
  },
};
