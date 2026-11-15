/**
 * The contracts between the app and a future Kestrel backend. Nothing here talks to a network: the app ships with
 * `OFFLINE_ACCOUNT` below, which is "signed out, Free, no cloud", and works fully with it. A real backend later
 * implements these without changing the offline app. See docs/BACKEND.md.
 */

/** What the person gives to register. Nothing else is asked for. Country is asked only when cloud storage is switched on. */
export interface Registration { username: string; password: string; country?: string }

export interface Session { accountId: string; username: string; expiresAtMs: number }

/** A recovery code is shown once at registration, because no email address is collected. */
export interface RegistrationResult { session: Session; recoveryCode: string }

export interface AuthProvider {
  register(details: Registration): Promise<RegistrationResult>;
  signIn(username: string, password: string): Promise<Session>;
  signOut(): Promise<void>;
  recover(username: string, recoveryCode: string, newPassword: string): Promise<{ session: Session; newRecoveryCode: string }>;
}

/** A signed statement from the licence server, checked against a public key built into the app, then cached for offline use. */
export interface SignedEntitlement {
  accountId: string;
  plan: 'free' | 'paid' | 'subscriber';
  /** Server-issued times in epoch ms. The app uses them for display only; the server enforces them. */
  issuedAtMs: number;
  cloudPaidThroughMs?: number;
  cloudQuotaBytes?: number;
  deviceLimit: number;
  signature: string;
}

export interface RegisteredDevice { deviceId: string; label: string; lastSeenMs: number }

export interface LicenceProvider {
  activate(session: Session, deviceLabel: string): Promise<SignedEntitlement>;
  refresh(session: Session): Promise<SignedEntitlement>;
  devices(session: Session): Promise<RegisteredDevice[]>;
  removeDevice(session: Session, deviceId: string): Promise<void>;
}

export type StorageRegion = 'uk' | 'eu' | 'us';

/** What is uploaded is the person's separate choice at each level; originals are never part of the first two. */
export type SyncLevel = 'recipes' | 'previews' | 'originals';

export interface SyncProvider {
  /** Fails unless the entitlement allows it; the server decides too. */
  upload(session: Session, level: SyncLevel, item: { id: string; bytes: Uint8Array; sha256: string }): Promise<void>;
  download(session: Session, id: string): Promise<Uint8Array>;
  usage(session: Session): Promise<{ usedBytes: number; quotaBytes: number; readOnlyUntilMs: number | null }>;
}

/** The app's default: no account, no cloud. Every method says so instead of reaching out. */
const none = () => Promise.reject(new Error('Accounts and cloud storage are not available in this version.'));
export const OFFLINE_ACCOUNT: { auth: AuthProvider; licence: LicenceProvider; sync: SyncProvider } = {
  auth: { register: none, signIn: none, signOut: () => Promise.resolve(), recover: none },
  licence: { activate: none, refresh: none, devices: () => Promise.resolve([]), removeDevice: none },
  sync: { upload: none, download: none, usage: none },
};

const EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];

/**
 * The region a chosen country is stored in. An explicit table: never guessed from an IP address or language, and a country
 * that is not listed gets no region (the app then says cloud storage is not yet available there) rather than a fallback.
 * The table lists what we intend to offer; it only becomes a promise once each region is verified.
 */
export function storageRegionFor(countryCode: string): StorageRegion | null {
  const code = countryCode.trim().toUpperCase();
  if (code === 'GB') return 'uk';
  if (code === 'US') return 'us';
  return EU.includes(code) ? 'eu' : null;
}
