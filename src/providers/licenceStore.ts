import { useSyncExternalStore } from 'react';
import { LICENCE_MESSAGES, verifyLicence } from '../core/licence';
import { decideAccess, parseControlPlaneUrl, parsePinnedKeys, platformOf, renewalDue, type AccessDecision, type OnlineStanding } from '../core/licenceOnline';
import { version as appVersion } from '../../package.json';
import { isDesktopApp } from './desktopShell';
import { LicenceSync, type LicenceStatus } from './licenceSync';

export type LicenceState =
  | { status: 'none' }
  | { status: 'checking' }
  | { status: 'valid'; online: OnlineStanding; access: AccessDecision }
  | { status: 'invalid'; message: string };

const KEY = 'kestrel.licence.v1';
const RENEW_CHECK_MS = 6 * 60 * 60 * 1000;
let state: LicenceState = { status: 'none' };
const listeners = new Set<() => void>();
const set = (next: LicenceState) => { state = next; listeners.forEach((listener) => listener()); };

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

/** Check the key kept on this device. Run once when the app opens. */
export async function loadLicence() {
  const key = storedKey();
  if (!key) { set({ status: 'none' }); return; }
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
