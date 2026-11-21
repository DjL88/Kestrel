import type { AuthProvider, Session, SignInProvider } from '../core/cloudInterfaces';
import type { SignInPlatform } from '../core/signInOptions';
import { isDesktopApp } from './desktopShell';

/** Public web configuration from Firebase. These are identifiers, not secrets (see docs/BACKEND.md). */
const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const isSignInConfigured = () => Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);

export function signInPlatform(): SignInPlatform {
  if (!isDesktopApp()) return 'web';
  const agent = navigator.userAgent;
  return /iPhone|iPad/.test(agent) ? 'ios' : /Android/.test(agent) ? 'android' : 'desktop';
}

/** The Firebase code is loaded only when someone opens sign-in, so offline use and start-up never pay for it. */
async function firebase() {
  const [{ initializeApp, getApps }, auth] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  const app = getApps()[0] ?? initializeApp(config);
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

const friendly = (error: unknown): string => {
  const code = (error as { code?: string })?.code ?? '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Sign-in was cancelled. Nothing changed.';
  if (code === 'auth/popup-blocked') return 'Your browser blocked the sign-in window. Allow pop-ups for this page and try again.';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return 'That email and password do not match. Check them or reset your password.';
  if (code === 'auth/email-already-in-use') return 'There is already an account with that email. Sign in instead, or reset your password.';
  if (code === 'auth/weak-password') return 'Choose a longer password (at least 6 characters).';
  if (code === 'auth/invalid-email') return 'That does not look like an email address.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a few minutes and try again.';
  if (code === 'auth/network-request-failed') return 'Could not reach the sign-in service. Check your connection; Kestrel still works offline.';
  return 'Sign-in did not complete. Nothing changed and Kestrel still works without an account.';
};

/** Email and password work in the browser and, unlike pop-ups, would also work in the installed apps; the apps still wait on their own Settings wiring. */
async function withAuth<T>(run: (a: Awaited<ReturnType<typeof firebase>>) => Promise<T>): Promise<T> {
  if (!isSignInConfigured()) throw new Error('Sign-in is not set up in this build.');
  try { return await run(await firebase()); } catch (error) { throw new Error(friendly(error)); }
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
    if (signInPlatform() !== 'web') throw new Error('Sign-in on the installed apps is not built yet. You can sign in from the web version.');
    try {
      const { auth, instance } = await firebase();
      const chosen = provider === 'apple' ? new auth.OAuthProvider('apple.com') : new auth.GoogleAuthProvider();
      if (provider === 'apple') { chosen.addScope('email'); chosen.addScope('name'); }
      const result = await auth.signInWithPopup(instance, chosen);
      return toSession(result.user, provider);
    } catch (error) {
      throw new Error(friendly(error));
    }
  },
  async signOut() {
    if (!isSignInConfigured()) return;
    const { auth, instance } = await firebase();
    await auth.signOut(instance);
  },
  async current() {
    if (!isSignInConfigured()) return null;
    const { auth, instance } = await firebase();
    await instance.authStateReady();
    return instance.currentUser ? toSession(instance.currentUser, providerOf(instance.currentUser)) : null;
  },
};
