import { useSyncExternalStore } from 'react';
import { HELPER_CONSENT_VERSION, type HelperSettings } from '../core/onlineHelper';

const KEY = 'kestrel.helper.v1';

export interface StoredHelper extends HelperSettings {
  /** The model last chosen for this key, so the list is not asked for every photo. */
  model?: string;
}

const EMPTY: StoredHelper = { enabled: false, consent: null, key: '' };

export function readHelper(): StoredHelper {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<StoredHelper> | null;
    if (!raw || typeof raw !== 'object') return EMPTY;
    return {
      enabled: raw.enabled === true,
      consent: typeof raw.consent === 'string' ? raw.consent : null,
      key: typeof raw.key === 'string' ? raw.key : '',
      ...(typeof raw.model === 'string' ? { model: raw.model } : {}),
    };
  } catch { return EMPTY; }
}

export function saveHelper(settings: StoredHelper): void {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* The settings last for this visit only. */ }
  notify();
}

export function forgetHelper(): void {
  try { localStorage.removeItem(KEY); } catch { /* Nothing stored. */ }
  notify();
}

/** Consent is recorded together with the exact terms it was given for. */
export const consentGiven = (): string => HELPER_CONSENT_VERSION;

// A tiny store, so the settings dialog and everything that depends on the settings stay in step.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

let snapshot: StoredHelper = readHelper();
let snapshotRaw = '';
function current(): StoredHelper {
  let raw = '';
  try { raw = localStorage.getItem(KEY) ?? ''; } catch { /* Fall back to the last known settings. */ return snapshot; }
  if (raw !== snapshotRaw) { snapshotRaw = raw; snapshot = readHelper(); }
  return snapshot;
}

export const useHelperSettings = (): StoredHelper => useSyncExternalStore(subscribe, current, current);

let dialogOpen = false;
export const useHelperDialog = (): boolean => useSyncExternalStore(subscribe, () => dialogOpen, () => false);
export function openHelperDialog(open = true): void { dialogOpen = open; notify(); }

/** Tell everything that the settings changed. */
export const changed = notify;

/**
 * The online helper is hidden for now: the key will live in a backend secret once Kite44 is deployed, so people are not
 * asked to bring their own. A build made with VITE_SHOW_ONLINE_HELPER=true shows it again (the browser tests use that).
 */
export const ONLINE_HELPER_VISIBLE = import.meta.env?.VITE_SHOW_ONLINE_HELPER === 'true';
