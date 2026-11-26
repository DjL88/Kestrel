import type { Session } from '../core/cloudInterfaces';
import type { SignInPlatform } from '../core/signInOptions';
import { LinkingError, type LinkingProblem, type SignInMethod } from '../core/accountLinking';
import { emailNextStep, profileFromSession, type EmailFailure, type LaunchProfile } from '../core/launchWelcome';
import { consumeLinkedMethod, emailFailureOf, firebaseAuth, isDesktopAppleConfigured, isDesktopGoogleConfigured, signInPlatform } from './firebaseAuth';
import { activateFromAccount, attachDeviceKeyToAccount, leaveAccount } from './licenceStore';
import { clearProfile, writeProfile } from './launchMemory';

/**
 * One way to sign in (which is also signing up), shared by Settings → Account and the launch welcome so they cannot
 * drift. Each function returns a plain result the screen words in the person's language. Every function takes an
 * optional `deps` so the unit tests run without Firebase, the licence service or real storage.
 */

export type LicenceOutcome = 'pro' | 'free' | 'limit' | 'revoked' | 'unreachable' | 'not_set_up' | 'no_token';
export type DeviceKeyAttach = Awaited<ReturnType<typeof attachDeviceKeyToAccount>>;
/** What happened after signing in: Pro for this device, a way in added to the account, a device key moved onto it. */
export type LicenceLink = { outcome: LicenceOutcome; linked: SignInMethod | null; attached: DeviceKeyAttach | null };

/** Google or Apple. Failures other than account linking (cancelled, blocked pop-up) still throw their plain message. */
export type ProviderResult =
  | { kind: 'signed-in'; session: Session; licence: LicenceLink }
  | { kind: 'linking'; problem: LinkingProblem };

/** `message` is the plain English the sign-in service's error was worded as, for screens that show it as it is. */
export type EmailResult =
  | { kind: 'signed-in'; session: Session; licence: LicenceLink }
  | { kind: 'created'; session: Session }
  | { kind: 'offer-create'; message: string }
  | { kind: 'wrong-password'; message: string }
  | { kind: 'error'; failure: EmailFailure; message: string }
  | { kind: 'linking'; problem: LinkingProblem };

export type SignInDeps = {
  auth: {
    signIn(provider: 'apple' | 'google'): Promise<Session>;
    signInWithEmail(email: string, password: string): Promise<Session>;
    createAccount(email: string, password: string): Promise<Session>;
    signOut(): Promise<void>;
    idToken(forceRefresh?: boolean): Promise<string | null>;
    setKeepSignedIn(keep: boolean): Promise<void>;
    consumeLinkedMethod(): SignInMethod | null;
    signInPlatform(): SignInPlatform;
    isDesktopAppleConfigured(): boolean;
    isDesktopGoogleConfigured(): boolean;
  };
  licence: {
    attachDeviceKeyToAccount(idToken: string): Promise<DeviceKeyAttach>;
    activateFromAccount(idToken: string): Promise<Exclude<LicenceOutcome, 'no_token'>>;
    leaveAccount(): void;
  };
  memory: {
    writeProfile(profile: LaunchProfile, keep: boolean): void;
    clearProfile(): void;
  };
};

const realDeps: SignInDeps = {
  auth: {
    signIn: (provider) => firebaseAuth.signIn(provider),
    signInWithEmail: (email, password) => firebaseAuth.signInWithEmail(email, password),
    createAccount: (email, password) => firebaseAuth.createAccount(email, password),
    signOut: () => firebaseAuth.signOut(),
    idToken: (forceRefresh) => firebaseAuth.idToken(forceRefresh),
    setKeepSignedIn: (keep) => firebaseAuth.setKeepSignedIn(keep),
    consumeLinkedMethod,
    signInPlatform,
    isDesktopAppleConfigured,
    isDesktopGoogleConfigured,
  },
  licence: { attachDeviceKeyToAccount, activateFromAccount, leaveAccount },
  memory: { writeProfile: (profile, keep) => writeProfile(profile, keep), clearProfile: () => clearProfile() },
};

const using = (deps: Partial<SignInDeps>): SignInDeps => ({ ...realDeps, ...deps });
const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'The account request did not complete.');

/**
 * Signing in only creates a record. This asks whether the account has a purchase or gift, in the same order Settings
 * always has: the way in just added to the account, then a Pro key used on this device before signing up goes onto the
 * account (never silently from another account), then Pro for this device.
 */
export async function linkLicenceOutcome(deps: Partial<SignInDeps> = {}): Promise<LicenceLink> {
  const { auth, licence } = using(deps);
  const token = await auth.idToken(true).catch(() => null);
  if (!token) return { outcome: 'no_token', linked: null, attached: null };
  const linked = auth.consumeLinkedMethod();
  const attached = await licence.attachDeviceKeyToAccount(token);
  const outcome = await licence.activateFromAccount(token);
  return { outcome, linked, attached };
}

/** Remember who signed in, for the launch welcome; `keep` false lasts this browser session only. */
function remember(session: Session, keep: boolean, deps: SignInDeps) {
  deps.memory.writeProfile(profileFromSession({ email: session.email, displayName: session.displayName }), keep);
}

/**
 * Google or Apple. `onSignedIn` hears of the session as soon as sign-in succeeds, before the licence is checked, so a
 * screen can show "signed in" while it waits.
 */
export async function signInWithProvider(provider: 'apple' | 'google', keep: boolean, deps: Partial<SignInDeps> = {}, onSignedIn?: (session: Session) => void): Promise<ProviderResult> {
  const d = using(deps);
  let session: Session;
  try {
    await d.auth.setKeepSignedIn(keep);
    session = await d.auth.signIn(provider);
  } catch (error) {
    if (error instanceof LinkingError) return { kind: 'linking', problem: error.problem };
    throw error;
  }
  remember(session, keep, d);
  onSignedIn?.(session);
  return { kind: 'signed-in', session, licence: await linkLicenceOutcome(d) };
}

async function emailStep(stage: 'signIn' | 'create', run: () => Promise<Session>, keep: boolean, d: SignInDeps): Promise<Session | EmailResult> {
  try {
    await d.auth.setKeepSignedIn(keep);
    return await run();
  } catch (error) {
    if (error instanceof LinkingError) return { kind: 'linking', problem: error.problem };
    const failure = emailFailureOf(error);
    const message = messageOf(error);
    const next = emailNextStep(stage, failure);
    return next === 'offer-create' ? { kind: 'offer-create', message }
      : next === 'say-wrong-password' ? { kind: 'wrong-password', message }
      : { kind: 'error', failure, message };
  }
}
const isResult = (value: Session | EmailResult): value is EmailResult => 'kind' in value;

/** Sign in with email and password. If that email and password match no account, offers to create one. */
export async function continueWithEmail(email: string, password: string, keep: boolean, deps: Partial<SignInDeps> = {}, onSignedIn?: (session: Session) => void): Promise<EmailResult> {
  const d = using(deps);
  const step = await emailStep('signIn', () => d.auth.signInWithEmail(email, password), keep, d);
  if (isResult(step)) return step;
  remember(step, keep, d);
  onSignedIn?.(step);
  return { kind: 'signed-in', session: step, licence: await linkLicenceOutcome(d) };
}

/** Create the account (a verification email is sent). If the email already has one, the password was wrong. */
export async function createWithEmail(email: string, password: string, keep: boolean, deps: Partial<SignInDeps> = {}): Promise<EmailResult> {
  const d = using(deps);
  const step = await emailStep('create', () => d.auth.createAccount(email, password), keep, d);
  if (isResult(step)) return step;
  remember(step, keep, d);
  return { kind: 'created', session: step };
}

/**
 * Sign out of the account, then remove its Pro and the launch profile from this device. The local part always runs,
 * even when Firebase fails; a network failure is ignored (nothing online is needed to sign out here), anything else is
 * reported after this device is cleared.
 */
export async function signOutEverywhere(deps: Partial<SignInDeps> = {}): Promise<void> {
  const d = using(deps);
  let failure: unknown = null;
  try { await d.auth.signOut(); } catch (error) { failure = error; }
  d.licence.leaveAccount();
  d.memory.clearProfile();
  if (failure !== null && emailFailureOf(failure) !== 'offline') throw failure;
}

/** Ways to sign in this build offers here: email always; Apple and Google on the web, or a desktop app set up for them. */
export function availableProviders(deps: Partial<SignInDeps> = {}): ('apple' | 'google' | 'email')[] {
  const { auth } = using(deps);
  const platform = auth.signInPlatform();
  const web = platform === 'web';
  const desktop = platform === 'desktop';
  return [
    ...(web || (desktop && auth.isDesktopAppleConfigured()) ? ['apple' as const] : []),
    ...(web || (desktop && auth.isDesktopGoogleConfigured()) ? ['google' as const] : []),
    'email' as const,
  ];
}
