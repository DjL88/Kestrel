import { useSyncExternalStore } from 'react';
import { LICENCE_MESSAGES, verifyLicence } from '../core/licence';
import { decideAccess, decideAccountAccess, parseControlPlaneUrl, parsePinnedKeys, platformOf, renewalDue, type AccessDecision, type AccountStanding, type OnlineStanding } from '../core/licenceOnline';
import { version as appVersion } from '../../package.json';
import { isDesktopApp } from './desktopShell';
import { firebaseAuth } from './firebaseAuth';
import { LicenceSync, type LicenceStatus } from './licenceSync';
import type { ProPlan } from '../core/proCheckout';
import { setSignedInHint } from './featureFlagsStore';
import { clearProfile } from './launchMemory';

export type LicenceState =
  | { status: 'none' }
  | { status: 'checking' }
  | { status: 'valid'; online: OnlineStanding; access: AccessDecision; /** First use of this key here, for the one-time check-in; null when not asked. */ firstUseMs: number | null }
  | { status: 'account'; standing: AccountStanding; access: AccessDecision }
  | { status: 'invalid'; message: string };

const KEY = 'kestrel.licence.v1';
const RENEW_CHECK_MS = 6 * 60 * 60 * 1000;
let state: LicenceState = { status: 'none' };
const listeners = new Set<() => void>();
const set = (next: LicenceState) => { state = next; listeners.forEach((listener) => listener()); };

/**
 * Set once, read once by the Settings screen: whether the last launch found an account's offline
 * Pro confirmation past its window (the stored grant's `offlineUntilMs`, 30 days by default from
 * the control plane). Local work is never touched; only the account session and Pro status reset,
 * so the person is asked to sign in again rather than silently kept "signed in" with Basic features.
 */
let expiredAccountNotice = false;
export function consumeExpiredAccountNotice(): boolean {
  const had = expiredAccountNotice;
  expiredAccountNotice = false;
  return had;
}

const storage = {
  getItem: (name: string) => { try { return localStorage.getItem(name); } catch { return null; } },
  setItem: (name: string, value: string) => { localStorage.setItem(name, value); },
  removeItem: (name: string) => { try { localStorage.removeItem(name); } catch { /* nothing to remove */ } },
};

/**
 * The control plane this build talks to. Both are build settings, not secrets: VITE_KESTREL_CONTROL_PLANE_URL (https)
 * and VITE_KESTREL_GRANT_KEYS ("keyId=base64publicKey"). Without both, keys still work fully offline.
 */
const sync = new LicenceSync({
  baseUrl: parseControlPlaneUrl(import.meta.env?.VITE_KESTREL_CONTROL_PLANE_URL),
  grantKeys: parsePinnedKeys(import.meta.env?.VITE_KESTREL_GRANT_KEYS),
  storage,
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
  platform: platformOf(isDesktopApp(), typeof navigator === 'undefined' ? '' : navigator.userAgent),
  appVersion,
});

/** When the stored key was first used on this device (see NEW_DEVICE_CHECK_IN_DAYS). Read whenever a key is loaded or saved. */
let firstUseMs: number | null = null;
const valid = (online: OnlineStanding): LicenceState => ({ status: 'valid', online, access: decideAccess(true, online, Date.now(), firstUseMs), firstUseMs });
const storedKey = () => storage.getItem(KEY);

/** Ask the control plane about this device's key when the stored grant is due for renewal (or never checked). */
async function renewIfDue(key: string, force = false) {
  if (!sync.configured || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  const current = state.status === 'valid' ? state.online : null;
  const grant = current?.kind === 'active' || current?.kind === 'unreachable' ? current.grant : null;
  // A fresh grant needs nothing; anything else (never checked, unreachable, revoked, no free slot) is asked again.
  if (!force && grant && !renewalDue(grant, Date.now())) return;
  const online = await sync.activate(key);
  if (storedKey() === key.trim()) set(valid(online));
}

let timer: ReturnType<typeof setInterval> | null = null;
function keepRenewing() {
  if (timer || typeof window === 'undefined') return;
  const check = () => {
    const key = storedKey();
    if (key) void renewIfDue(key);
    else void renewAccountIfDue();
  };
  timer = setInterval(check, RENEW_CHECK_MS);
  window.addEventListener('online', check);
}

const accountState = (standing: AccountStanding): LicenceState => ({ status: 'account', standing, access: decideAccountAccess(standing, Date.now()) });

/**
 * After signing in: ask the control plane for this device's grant using the account. Without a purchase or gift the
 * account stays Free. A pasted key, if there is one, is untouched and still decides on its own.
 */
export async function activateFromAccount(idToken: string): Promise<'pro' | 'free' | 'limit' | 'revoked' | 'unreachable' | 'not_set_up'> {
  if (!sync.configured) return 'not_set_up';
  const standing = await sync.activateAccount(idToken);
  if (!standing) return 'unreachable';
  setSignedInHint(true);
  // Bought outright: keep the buyer's own key on this device, so Pro no longer depends on the account or our service.
  if (standing.kind === 'active' && standing.licenceKey && !storedKey() && (await adoptKey(standing.licenceKey))) return 'pro';
  if (!storedKey()) set(standing.kind === 'no_licence' ? { status: 'none' } : accountState(standing));
  if (standing.kind === 'active') keepRenewing();
  return standing.kind === 'active' ? 'pro' : standing.kind === 'no_licence' ? 'free' : standing.kind === 'device_limit' ? 'limit' : 'revoked';
}

let accountRenewing = false;
async function renewAccountIfDue() {
  if (state.status !== 'account' || state.standing.kind !== 'active') return;
  const grant = state.standing.grant;
  const current = state;
  if (grant.plan === 'free') return;
  if (!decideAccountAccess(current.standing, Date.now()).pro) {
    leaveAccount();
    expiredAccountNotice = true;
    void firebaseAuth.signOut().catch(() => undefined);
    return;
  }
  if (accountRenewing || !renewalDue(grant, Date.now()) || navigator.onLine === false) return;
  accountRenewing = true;
  try {
    const token = await firebaseAuth.idToken();
    if (token && state === current) await activateFromAccount(token);
  } catch {
    // Keep using the verified grant until its offline window ends.
  } finally {
    accountRenewing = false;
  }
}

/**
 * Signing out of the account removes its Pro from this device (a pasted key is separate and stays), and the launch
 * welcome's memory of who signed in, so an automatic sign-out (an expired grant) never leaves a stale "Welcome back".
 */
export function leaveAccount() {
  sync.forgetAccount();
  setSignedInHint(false);
  clearProfile();
  if (state.status === 'account') set({ status: 'none' });
}

/**
 * Whether this device's licence state is known yet: true once loadLicence has read what is kept here (before any
 * online renewal), or at once when nothing is kept, which is Free. Lets the splash start with the right logo.
 */
let launchReadDone = false;
const settle = (next: LicenceState) => { launchReadDone = true; set(next); };
const licenceKnown = () => launchReadDone || (!storedKey() && !sync.hasStoredAccountGrant());

export function useLicenceKnown(): boolean {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, licenceKnown, () => false);
}

/** Check the key kept on this device. Run once when the app opens. */
export async function loadLicence() {
  try {
    await readStoredLicence();
  } finally {
    if (!launchReadDone) settle(state);
  }
}

async function readStoredLicence() {
  const key = storedKey();
  if (!key) {
    const stored = await sync.storedAccountStanding();
    if (stored) {
      const access = decideAccountAccess(stored, Date.now());
      // The grant's signature still verifies, but its offline window (offlineGraceDays, 30 by
      // default) has passed with no successful online check in that time: a previously paid
      // grant, not one that was always 'no_licence'/free. Treat this like a lapsed session, not a
      // quiet downgrade - clear it and the account sign-in, so Settings can ask the person to sign
      // in again rather than show them as still "signed in" with only Basic features.
      if (stored.kind === 'active' && stored.grant.plan !== 'free' && !access.pro) {
        leaveAccount();
        void firebaseAuth.signOut().catch(() => {});
        expiredAccountNotice = true;
        settle({ status: 'none' });
        return;
      }
      settle({ status: 'account', standing: stored, access });
      keepRenewing();
      void renewAccountIfDue();
    } else {
      settle({ status: 'none' });
    }
    return;
  }
  set({ status: 'checking' });
  const result = await verifyLicence(key);
  if (!result.ok) { settle({ status: 'invalid', message: LICENCE_MESSAGES[result.reason] }); return; }
  firstUseMs = await sync.firstUse(key, Date.now());
  settle(valid(await sync.storedStanding(key)));
  keepRenewing();
  await renewIfDue(key);
}

/** Keep a key the account handed over, exactly as a pasted one. False if it does not check out or cannot be kept. */
async function adoptKey(key: string): Promise<boolean> {
  const result = await verifyLicence(key);
  if (!result.ok) return false;
  try { localStorage.setItem(KEY, key.trim()); } catch { return false; }
  firstUseMs = await sync.firstUse(key, Date.now());
  set(valid(await sync.storedStanding(key)));
  keepRenewing();
  await renewIfDue(key, true);
  return true;
}

/** The key kept on this device, to show the person so they can keep a copy. Null when there is none. */
export const deviceLicenceKey = (): string | null => storedKey();

/** Check a pasted key and, if it is good, keep it and activate this device when online. */
export async function saveLicence(key: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await verifyLicence(key);
  if (!result.ok) return { ok: false, message: LICENCE_MESSAGES[result.reason] };
  try { localStorage.setItem(KEY, key.trim()); } catch { return { ok: false, message: 'Could not keep the key on this device. Check that storage is not full or blocked.' }; }
  firstUseMs = await sync.firstUse(key, Date.now());
  set(valid(await sync.storedStanding(key)));
  keepRenewing();
  await renewIfDue(key, true);
  return { ok: true };
}

/** Remove the key from this device, freeing its slot on the server when it can be reached. */
export async function removeLicence() {
  const key = storedKey();
  if (key && state.status === 'valid') {
    const activationId = state.online.kind === 'active' || state.online.kind === 'unreachable' ? state.online.activationId : null;
    if (activationId) await sync.deactivate(key, activationId);
  }
  storage.removeItem(KEY);
  sync.forget();
  firstUseMs = null;
  set({ status: 'none' });
}

/** Ask the server now (the Licence screen's "Check now"). */
export async function checkLicenceNow() {
  const key = storedKey();
  if (key && state.status === 'valid') await renewIfDue(key, true);
}

/** The key's status and devices from the server, or null when it cannot be reached or this build has no server. */
export async function licenceDevices(): Promise<LicenceStatus | null> {
  const key = storedKey();
  return key ? sync.status(key) : null;
}

/** Free one of the key's devices. Freeing this one drops back to the key alone until the next check. */
export async function freeLicenceDevice(activationId: string): Promise<boolean> {
  const key = storedKey();
  if (!key) return false;
  const ok = await sync.deactivate(key, activationId);
  if (ok && state.status === 'valid') set(valid(await sync.storedStanding(key)));
  return ok;
}

/** Account-based licences have no pasted key; these calls never activate a device. */
export const accountLicenceDevices = (idToken: string) => sync.accountDevices(idToken);
/** After signing up or in: put the KESTREL1 key saved on this device on the account, so its devices come too. */
export async function attachDeviceKeyToAccount(idToken: string): Promise<'none' | 'attached' | 'already' | 'other' | 'invalid' | 'unreachable'> {
  const key = storedKey();
  if (!key) return 'none';
  return sync.attachKey(idToken, key);
}
export const freeAccountLicenceDevice = (idToken: string, activationId: string) => sync.releaseAccountDevice(idToken, activationId);
/** Why the last device free was refused, in the server's kind words, when the yearly allowance is used up. */
export const deviceReleaseRefusal = (): string | null => sync.releaseRefusal;

/** Buying Pro (see src/core/proCheckout.ts). After a paid answer, activateFromAccount puts Pro on this device. */
export const startProCheckout = (idToken: string, plan?: ProPlan) => sync.startProCheckout(idToken, plan);
export const proCheckoutStatus = (idToken: string, checkoutId: string) => sync.proCheckoutStatus(idToken, checkoutId);
/** Manage or cancel Pro (see src/core/proCheckout.ts): Paddle runs the cancellation; the server then moves the end date. */
export const manageProSubscription = (idToken: string) => sync.manageProSubscription(idToken);
/** Cloud top-ups (src/v2/ui/useCloudTopUp.ts): the server credits the balance only after Paddle confirms the payment. */
export const startTopUpCheckout = (idToken: string, pence: number) => sync.startTopUpCheckout(idToken, pence);
export const topUpCheckoutStatus = (idToken: string, checkoutId: string) => sync.topUpCheckoutStatus(idToken, checkoutId);
export const licenceOnlineConfigured = () => sync.configured;
/** Where and how to reach account-only services (cloud processing) right now; null when signed out or the session ended. */
export const accountConnection = () => sync.accountConnection();

/** Whether this device holds a paid plan (Pro or Pro Plus; never Basic, which is free) right now: a valid key or an account grant that unlocks Pro. */
export const hasPaidPlan = (): boolean => (state.status === 'valid' || state.status === 'account') && state.access.pro;

export function useLicence(): LicenceState {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => state, () => state);
}
