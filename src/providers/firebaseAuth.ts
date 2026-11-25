import type { AuthProvider, Session, SignInProvider } from '../core/cloudInterfaces';
import type { SignInPlatform } from '../core/signInOptions';
import { isDesktopApp } from './desktopShell';
import { friendlyAuthError } from '../core/authError';
import { LinkingError, linkingProblem, methodsFromProviderIds, type SignInMethod } from '../core/accountLinking';
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
  try { return await run(await firebase()); } catch (error) {
    if (error instanceof LinkingError) throw error; // the screen words it in the person's language
    throw new Error(friendlyAuthError(error));
  }
}

// ---- One account, several ways in (account linking) -------------------------------------------------------------
// When someone signs in with Google or Apple and their email already has an InFlight account that signs in another
// way, Firebase refuses rather than making a second account. The new way in is kept here (in memory only), and added
// to the account as soon as they sign in the way they already use. Nothing is ever merged silently.
type Auth = typeof import('firebase/auth');
type Instance = import('firebase/auth').Auth;
let pendingLink: { credential: import('firebase/auth').AuthCredential; method: SignInMethod } | null = null;
let justLinked: SignInMethod | null = null;
/** The way of signing in that was added to the account at the last sign-in, once; null otherwise. */
export function consumeLinkedMethod(): SignInMethod | null { const m = justLinked; justLinked = null; return m; }
const codeOf = (error: unknown) => (error as { code?: string })?.code ?? '';

async function afterSignIn(auth: Auth, user: import('firebase/auth').User) {
  const pending = pendingLink;
  if (!pending) return;
  pendingLink = null;
  try { await auth.linkWithCredential(user, pending.credential); justLinked = pending.method; } catch { /* left as it was: they can add it in Settings */ }
}

/** Sign in, or (mode 'link') add this way in to the signed-in account, with a credential from Google or Apple. */
async function useCredential(auth: Auth, instance: Instance, credential: import('firebase/auth').AuthCredential, method: SignInMethod, mode: 'signIn' | 'link'): Promise<import('firebase/auth').User> {
  if (mode === 'link') {
    await instance.authStateReady();
    const user = instance.currentUser;
    if (!user) throw new Error('Sign in first, then add another way to sign in.');
    try { await auth.linkWithCredential(user, credential); } catch (error) {
      const problem = linkingProblem(codeOf(error));
      if (problem) throw new LinkingError(problem);
      throw error;
    }
    return user;
  }
  try {
    const user = await useCredential(auth, instance, credential, 'apple', mode);
    await afterSignIn(auth, user);
    return user;
  } catch (error) {
    if (codeOf(error) === 'auth/account-exists-with-different-credential') { pendingLink = { credential, method }; throw new LinkingError('use-existing-method'); }
    throw error;
  }
}

/** The ways the signed-in account can sign in (Google, Apple, email and password). Empty when signed out. */
export async function signInMethods(): Promise<SignInMethod[]> {
  if (!isSignInConfigured()) return [];
  const { instance } = await firebase();
  await instance.authStateReady();
  return methodsFromProviderIds(instance.currentUser?.providerData.map((p) => p.providerId) ?? []);
}

/** Add Google, Apple, or a password for the account's own email, to the signed-in account. Never creates an account. */
export async function addSignInMethod(method: SignInMethod, password?: string): Promise<SignInMethod[]> {
  if (method === 'google' && signInPlatform() === 'desktop' && googleDesktop) await signInWithGoogleOnDesktop(googleDesktop, 'link');
  else if (method === 'apple' && signInPlatform() === 'desktop' && appleDesktop) await signInWithAppleOnDesktop(appleDesktop, 'link');
  else await withAuth(async ({ auth, instance }) => {
    await instance.authStateReady();
    const user = instance.currentUser;
    if (!user) throw new Error('Sign in first, then add another way to sign in.');
    try {
      if (method === 'password') {
        if (!user.email || !password) throw new Error('Choose a password for signing in with your email.');
        await auth.linkWithCredential(user, auth.EmailAuthProvider.credential(user.email, password));
      } else {
        if (signInPlatform() !== 'web') throw new Error('Adding Google or Apple is not built for this app yet. Add it on the web version.');
        const chosen = method === 'apple' ? new auth.OAuthProvider('apple.com') : new auth.GoogleAuthProvider();
        await auth.linkWithPopup(user, chosen);
      }
    } catch (error) {
      const problem = linkingProblem(codeOf(error));
      if (problem) throw new LinkingError(problem);
      throw error;
    }
  });
  return signInMethods();
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
async function signInWithGoogleOnDesktop(client: NonNullable<typeof googleDesktop>, mode: 'signIn' | 'link' = 'signIn'): Promise<import('../core/cloudInterfaces').Session> {
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
  if (answer.error || !answer.code) throw new Error(`${explainSignInError(answer.error)} (Google: ${answer.error ?? 'no code returned'})`);
  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
  let response: Response;
  try {
    response = await tauriFetch(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: googleCodeExchangeBody({ clientId: client.clientId, clientSecret: client.clientSecret, code: answer.code, verifier, redirectUri }) });
  } catch { throw new Error('Could not reach Google. Check your connection.'); }
  const json = await response.json().catch(() => null) as { error?: string } | null;
  // Name Google's own reason too, so a refusal can be traced without a debug build.
  if (!response.ok) throw new Error(`${explainSignInError(json?.error)} (Google: ${json?.error ?? `HTTP ${response.status}`})`);
  const idToken = idTokenFromAnswer(json, { clientId: client.clientId, nonce });
  return withAuth(async ({ auth, instance }) => toSession(await useCredential(auth, instance, auth.GoogleAuthProvider.credential(idToken), 'google', mode), 'google'));
}

/**
 * Desktop: InFlight's Apple sign-in page on the website opens in the person's normal browser, Apple's own sign-in runs
 * there, and the page hands Apple's ID token to the one-shot listener on this computer. Firebase signs in with that
 * token and the raw nonce, which never leaves the app (the page and Apple only see its hash).
 */
async function signInWithAppleOnDesktop(config: NonNullable<typeof appleDesktop>, mode: 'signIn' | 'link' = 'signIn'): Promise<import('../core/cloudInterfaces').Session> {
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
  signInWithEmail: (email, password) => withAuth(async ({ auth, instance }) => {
    const { user } = await auth.signInWithEmailAndPassword(instance, email.trim(), password);
    await afterSignIn(auth, user);
    return toSession(user, 'password');
  }),
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
      try {
        const result = await auth.signInWithPopup(instance, chosen);
        await afterSignIn(auth, result.user);
        return toSession(result.user, provider);
      } catch (error) {
        if (codeOf(error) === 'auth/account-exists-with-different-credential') {
          const credential = provider === 'apple' ? auth.OAuthProvider.credentialFromError(error as never) : auth.GoogleAuthProvider.credentialFromError(error as never);
          if (credential) pendingLink = { credential, method: provider === 'apple' ? 'apple' : 'google' };
          throw new LinkingError('use-existing-method');
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof LinkingError) throw error;
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
