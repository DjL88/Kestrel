import type { AuthProvider, Session, SignInProvider } from '../core/cloudInterfaces';
import type { SignInPlatform } from '../core/signInOptions';
import { isDesktopApp } from './desktopShell';
import { friendlyAuthError } from '../core/authError';
import { challengeFor, explainSignInError, makeVerifier, parseCallbackQuery } from '../core/cloudDrive';
import { desktopGoogleClient, googleCodeExchangeBody, googleSignInUrl, GOOGLE_TOKEN_URL, idTokenFromAnswer } from '../core/desktopGoogleSignIn';
import { appleAnswerFromQuery, appleSignInPageUrl, desktopAppleConfig, sha256Hex } from '../core/desktopAppleSignIn';

/** Public web configuration from Firebase. These are identifiers, not secrets (see docs/BACKEND.md). */
const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

/** Work to do just before signing out, such as removing this device's push token. */
const beforeSignOut = new Set<() => Promise<void>>();
export function onBeforeSignOut(fn: () => Promise<void>): () => void { beforeSignOut.add(fn); return () => { beforeSignOut.delete(fn); }; }

export const isSignInConfigured = () => Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);

/** The Google desktop OAuth client this build signs in with, if any (see desktopGoogleSignIn.ts). */
const googleDesktop = desktopGoogleClient(env as Record<string, string | undefined>);
export const isDesktopGoogleConfigured = () => googleDesktop !== null;

/** The website's Apple sign-in page this build sends desktop users to, if any (see desktopAppleSignIn.ts). */
const appleDesktop = desktopAppleConfig(env as Record<string, string | undefined>);
export const isDesktopAppleConfigured = () => appleDesktop !== null;

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
  return { auth, instance: authInstance(auth, app) };
}

/**
 * The web build uses Firebase's normal set-up, which includes pop-up sign-in. The installed apps sign in through the
 * person's own browser instead, so they leave out the pop-up helper: it loads Google scripts and a hidden frame that the
 * app's security policy blocks, and waiting for them stalled every sign-in in the desktop app.
 */
function authInstance(auth: typeof import('firebase/auth'), app: import('firebase/app').FirebaseApp) {
  if (!isDesktopApp()) return auth.getAuth(app);
  try {
    return auth.initializeAuth(app, { persistence: [auth.indexedDBLocalPersistence, auth.browserLocalPersistence] });
  } catch {
    return auth.getAuth(app); // Already set up earlier in this window.
  }
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

/**
 * Desktop: InFlight's Apple sign-in page on the website opens in the person's normal browser, Apple's own sign-in runs
 * there, and the page hands Apple's ID token to the one-shot listener on this computer. Firebase signs in with that
 * token and the raw nonce, which never leaves the app (the page and Apple only see its hash).
 */
async function signInWithAppleOnDesktop(config: NonNullable<typeof appleDesktop>): Promise<import('../core/cloudInterfaces').Session> {
  const { invoke } = await import('@tauri-apps/api/core');
  const state = randomToken();
  const rawNonce = randomToken();
  const hashedNonce = await sha256Hex(rawNonce);
  try { await invoke<string>('oauth_listen_start'); } catch (error) { throw loopbackError(error); }
  let query: string;
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(appleSignInPageUrl(config, { state, hashedNonce }));
    query = await invoke<string>('oauth_listen_wait', { timeoutSecs: 300 });
  } catch (error) {
    await invoke('oauth_listen_stop').catch(() => undefined);
    throw new Error(typeof error === 'string' ? error : 'Apple sign-in did not finish. Try again.');
  }
  const answer = appleAnswerFromQuery(query, { state, servicesId: config.servicesId, hashedNonce });
  return withAuth(async ({ auth, instance }) => {
    const credential = new auth.OAuthProvider('apple.com').credential({ idToken: answer.idToken, rawNonce });
    const { user } = await auth.signInWithCredential(instance, credential);
    // Apple gives the name only on the first sign-in, outside the token; keep it so the account is not nameless.
    if (answer.displayName && !user.displayName) await auth.updateProfile(user, { displayName: answer.displayName }).catch(() => undefined);
    return toSession(user, 'apple');
  });
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
    if (signInPlatform() === 'desktop' && provider === 'apple' && appleDesktop) return signInWithAppleOnDesktop(appleDesktop);
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
    // Stop alerts on this device first, while the session can still say whose device it was (G20 push).
    await Promise.all([...beforeSignOut].map((fn) => fn().catch(() => undefined)));
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
