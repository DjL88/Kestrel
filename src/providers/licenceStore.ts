import { useSyncExternalStore } from 'react';
import { LICENCE_MESSAGES, verifyLicence } from '../core/licence';

export type LicenceState = { status: 'none' } | { status: 'checking' } | { status: 'valid' } | { status: 'invalid'; message: string };

const KEY = 'kestrel.licence.v1';
let state: LicenceState = { status: 'none' };
const listeners = new Set<() => void>();
const set = (next: LicenceState) => { state = next; listeners.forEach((listener) => listener()); };

const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

/** Check the key kept on this device. Run once when the app opens. */
export async function loadLicence() {
  const key = read();
  if (!key) { set({ status: 'none' }); return; }
  set({ status: 'checking' });
  const result = await verifyLicence(key);
  set(result.ok ? { status: 'valid' } : { status: 'invalid', message: LICENCE_MESSAGES[result.reason] });
}

/** Check a pasted key and, if it is good, keep it. Returns a plain message when it is not. */
export async function saveLicence(key: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await verifyLicence(key);
  if (!result.ok) return { ok: false, message: LICENCE_MESSAGES[result.reason] };
  try { localStorage.setItem(KEY, key.trim()); } catch { return { ok: false, message: 'Could not keep the key on this device. Check that storage is not full or blocked.' }; }
  set({ status: 'valid' });
  return { ok: true };
}

export function removeLicence() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to remove */ }
  set({ status: 'none' });
}

export function useLicence(): LicenceState {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => state, () => state);
}
