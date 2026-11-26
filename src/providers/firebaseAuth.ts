import type { AuthProvider, Session, SignInProvider } from '../core/cloudInterfaces';
import { signInOptions, type SignInPlatform } from '../core/signInOptions';
import { isDesktopApp } from './desktopShell';
import { friendlyAuthError } from '../core/authError';
import type { EmailFailure } from '../core/launchWelcome';
import { LinkingError, linkingProblem, methodsFromProviderIds, signInWithHeldLink, type SignInMethod } from '../core/accountLinking';
import { challengeFor, explainSignInError, makeVerifier, parseCallbackQuery } from '../core/cloudDrive';
import { desktopGoogleClient, googleCodeExchangeBody, googleSignInUrl, GOOGLE_TOKEN_URL, idTokenFromAnswer } from '../core/desktopGoogleSignIn';
import { appleAnswerFromQuery, appleSignInPageUrl, desktopAppleConfig, sha256Hex } from '../core/desktopAppleSignIn';

/** Public web configuration from Firebase. These are identifiers, not secrets (see docs/BACKEND.md). */
const env = (import.meta.env ?? {}) as ImportMetaEnv; // empty under Node (unit tests), so importing this module never needs Vite
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

/** Sign in with Microsoft is switched on per build, once its provider is enabled in the Firebase console. */
export const isMicrosoftSignInEnabled = () => env.VITE_MICROSOFT_SIGN_IN === '1' || env.VITE_MICROSOFT_SIGN_IN === 'true';

/** The sign-in options for this build and device. */
export const currentSignInOptions = () => signInOptions(signInPlatform(), isSignInConfigured(), isDesktopGoogleConfigured(), isDesktopAppleConfigured(), isMicrosoftSignInEnabled());

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
  emailVerified: user.emailVerified,
});

const providerOf = (user: import('firebase/auth').User): SignInProvider =>
  user.providerData.some((p) => p.providerId === 'apple.com') ? 'apple'
    : user.providerData.some((p) => p.providerId === 'microsoft.com') ? 'microsoft'
    : user.providerData.some((p) => p.providerId === 'password') ? 'password' : 'google';

/**
 * The pop-up provider for Google, Apple or Microsoft. Microsoft uses the "common" tenant, so both personal accounts and
 * work or school (Microsoft 365) accounts can sign in, and always asks which account, so a shared PC is not a trap.
 */
function popupProvider(auth: typeof import('firebase/auth'), method: 'google' | 'apple' | 'microsoft') {
  if (method === 'google') return new auth.GoogleAuthProvider();
  const chosen = new auth.OAuthProvider(method === 'apple' ? 'apple.com' : 'microsoft.com');
  chosen.addScope('email');
  if (method === 'apple') chosen.addScope('name');
  else { chosen.addScope('openid'); chosen.addScope('profile'); chosen.setCustomParameters({ tenant: 'common', prompt: 'select_account' }); }
  return chosen;
}

/** Which method a pop-up provider choice is, for the methods that can open one. */
const popupMethod = (method: SignInMethod | SignInProvider): 'google' | 'apple' | 'microsoft' => (method === 'apple' || method === 'microsoft' ? method : 'google');



/** Email and password work in the browser and, unlike pop-ups, would also work in the installed apps; the apps still wait on their own Settings wiring. */
async function withAuth<T>(run: (a: Awaited<ReturnType<typeof firebase>>) => Promise<T>): Promise<T> {
  if (!isSignInConfigured()) throw new Error('Sign-in is not set up in this build.');
  try { return await run(await firebase()); } catch (error) {
    if (error instanceof LinkingError) throw error; // the screen words it in the person's language
    throw new Error(friendlyAuthError(error), { cause: error }); // Firebase's own error stays on cause (see emailFailureOf)
  }
}

/** Firebase's error code, on the error itself or on the one withAuth kept as `cause`. */
const firebaseCodeOf = (error: unknown): string => {
  const own = (error as { code?: unknown } | null)?.code;
  if (typeof own === 'string') return own;
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof cause === 'string' ? cause : '';
};

/**
 * Whether the sign-in service itself answered with this error (an `auth/` code). False when its code could not even be
 * loaded, as when the app is offline and the sign-in code was never downloaded.
 */
export const isSignInServiceError = (error: unknown): boolean => firebaseCodeOf(error).startsWith('auth/');

/** What went wrong with an email sign-in or sign-up, for the screens to choose their next step (launchWelcome). */
export function emailFailureOf(error: unknown): EmailFailure {
  switch (firebaseCodeOf(error)) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return 'wrong-or-unknown';
    case 'auth/email-already-in-use': return 'in-use';
    case 'auth/weak-password': return 'weak-password';
    case 'auth/invalid-email': return 'invalid-email';
    case 'auth/network-request-failed': return 'offline';
    default: return 'other';
  }
}

/**
 * Web only: whether this sign-in survives closing the browser ("Keep me signed in"). Called straight AFTER a successful
 * sign-in, so the Google or Apple pop-up still opens inside the person's click (Safari blocks it otherwise); Firebase
 * moves the signed-in user to the new storage. keep = true sets the remembering storage (indexedDB) again, because an
 * earlier session-only sign-in in this page left Firebase on session storage; keep = false limits it to this session.
 * The installed apps always remember, so this does nothing there. Rejects when the browser cannot apply the choice; for
 * keep = false the caller then signs out rather than silently remembering.
 */
async function setKeepSignedIn(keep: boolean): Promise<void> {
  if (!isSignInConfigured() || signInPlatform() !== 'web') return;
  const { auth, instance } = await firebase();
  await auth.setPersistence(instance, keep ? auth.indexedDBLocalPersistence : auth.browserSessionPersistence);
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
  return signInWithHeldLink(credential, method, {
    signIn: async (c) => (await auth.signInWithCredential(instance, c)).user,
    afterSignIn: (user) => afterSignIn(auth, user),
    hold: (pending) => { pendingLink = pending; },
  });
}

/**
 * Sign in to a second, existing account without leaving this one, to prove it may be merged (accountMerge). Uses its
 * own Firebase app kept in memory only, removed straight after; returns that account's ID token. Never creates one.
 */
export async function signInOtherAccount(method: SignInMethod, email?: string, password?: string): Promise<string> {
  if (!isSignInConfigured()) throw new Error('Sign-in is not set up in this build.');
  const [{ initializeApp, deleteApp }, auth] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  const app = initializeApp(config, `kestrel-merge-${Date.now()}`);
  try {
    const other = auth.initializeAuth(app, { persistence: auth.inMemoryPersistence, ...(isDesktopApp() ? {} : { popupRedirectResolver: auth.browserPopupRedirectResolver }) });
    let user: import('firebase/auth').User;
    if (method === 'password') {
      if (!email?.trim() || !password) throw new Error('Enter the other account’s email and password.');
      user = (await auth.signInWithEmailAndPassword(other, email.trim(), password)).user;
    } else {
      if (signInPlatform() !== 'web') throw new Error('On the desktop app, sign in to the other account with its email and password, or merge on the web version.');
      user = (await auth.signInWithPopup(other, popupProvider(auth, popupMethod(method)))).user;
    }
    return await user.getIdToken();
  } catch (error) {
    if (error instanceof Error && !(error as { code?: string }).code) throw error;
    throw new Error(friendlyAuthError(error));
  } finally {
    await deleteApp(app).catch(() => undefined);
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
        if (signInPlatform() !== 'web') throw new Error('Adding Google, Apple or Microsoft is not built for this app yet. Add it on the web version.');
        await auth.linkWithPopup(user, popupProvider(auth, popupMethod(method)));
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

export const firebaseAuth: AuthProvider & { setKeepSignedIn(keep: boolean): Promise<void> } = {
  setKeepSignedIn,
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
    if (signInPlatform() !== 'web') throw new Error('Google, Apple and Microsoft sign-in are not built for installed apps yet. Use email and password here, or sign in on the web.');
    try {
      const { auth, instance } = await firebase();
      if (provider === 'password') throw new Error('Use the email and password form.');
      const method = popupMethod(provider);
      const chosen = popupProvider(auth, method);
      try {
        const result = await auth.signInWithPopup(instance, chosen);
        await afterSignIn(auth, result.user);
        return toSession(result.user, provider);
      } catch (error) {
        if (codeOf(error) === 'auth/account-exists-with-different-credential') {
          const credential = method === 'google' ? auth.GoogleAuthProvider.credentialFromError(error as never) : auth.OAuthProvider.credentialFromError(error as never);
          if (credential) pendingLink = { credential, method };
          throw new LinkingError('use-existing-method');
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof LinkingError) throw error;
      throw new Error(friendlyAuthError(error), { cause: error });
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
