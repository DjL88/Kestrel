import { useSyncExternalStore } from 'react';
import { LICENCE_MESSAGES, verifyLicence } from '../core/licence';
import { decideAccess, decideAccountAccess, parseControlPlaneUrl, parsePinnedKeys, platformOf, renewalDue, type AccessDecision, type AccountStanding, type OnlineStanding } from '../core/licenceOnline';
import { version as appVersion } from '../../package.json';
import { isDesktopApp } from './desktopShell';
import { firebaseAuth } from './firebaseAuth';
import { LicenceSync, type LicenceStatus } from './licenceSync';
import { setSignedInHint } from './featureFlagsStore';

export type LicenceState =
  | { status: 'none' }
  | { status: 'checking' }
  | { status: 'valid'; online: OnlineStanding; access: AccessDecision }
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

const valid = (online: OnlineStanding): LicenceState => ({ status: 'valid', online, access: decideAccess(true, online, Date.now()) });
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
  timer = setInterval(() => { const key = storedKey(); if (key) void renewIfDue(key); }, RENEW_CHECK_MS);
  window.addEventListener('online', () => { const key = storedKey(); if (key) void renewIfDue(key); });
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
  if (!storedKey()) set(standing.kind === 'no_licence' ? { status: 'none' } : accountState(standing));
  return standing.kind === 'active' ? 'pro' : standing.kind === 'no_licence' ? 'free' : standing.kind === 'device_limit' ? 'limit' : 'revoked';
}

/** Signing out of the account removes its Pro from this device (a pasted key is separate and stays). */
export function leaveAccount() {
  sync.forgetAccount();
  setSignedInHint(false);
  if (state.status === 'account') set({ status: 'none' });
}

/** Check the key kept on this device. Run once when the app opens. */
export async function loadLicence() {
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
        sync.forgetAccount();
        void firebaseAuth.signOut().catch(() => {});
        expiredAccountNotice = true;
        set({ status: 'none' });
        return;
      }
      set({ status: 'account', standing: stored, access });
    } else {
      set({ status: 'none' });
    }
    return;
  }
  set({ status: 'checking' });
  const result = await verifyLicence(key);
  if (!result.ok) { set({ status: 'invalid', message: LICENCE_MESSAGES[result.reason] }); return; }
  set(valid(await sync.storedStanding(key)));
  keepRenewing();
  await renewIfDue(key);
}

/** Check a pasted key and, if it is good, keep it and activate this device when online. */
export async function saveLicence(key: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await verifyLicence(key);
  if (!result.ok) return { ok: false, message: LICENCE_MESSAGES[result.reason] };
  try { localStorage.setItem(KEY, key.trim()); } catch { return { ok: false, message: 'Could not keep the key on this device. Check that storage is not full or blocked.' }; }
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

export const licenceOnlineConfigured = () => sync.configured;

export function useLicence(): LicenceState {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => state, () => state);
}
