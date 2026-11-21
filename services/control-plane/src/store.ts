/**
 * The control plane's storage contract. Route handlers in app.ts only talk to this interface, never to SQL or
 * Firestore directly, so the two implementations cannot drift apart:
 *
 * - SqliteStore (sqliteStore.ts): node:sqlite. Local development and the default for tests.
 * - FirestoreStore (firestoreStore.ts): Google Cloud Firestore. What Cloud Run uses.
 *
 * Every operation that must be atomic (quota counters, device slots, single-use refresh tokens, idempotent billing
 * events, model promotion) is ONE method here, so each implementation can make it atomic its own way: a synchronous
 * BEGIN/COMMIT in SQLite, a transaction in Firestore. The business rules both share live in the pure helpers at the
 * bottom of this file.
 *
 * No photo, EXIF, image payload, provider key or raw token is ever stored. Times are epoch milliseconds.
 */

export type Role = 'user' | 'admin';
export type LicencePlan = 'free' | 'paid' | 'subscriber';
export type LicenceStatus = 'active' | 'trial' | 'expired' | 'revoked';
/** How an entitlement came about: a verified payment, a gift from the admin, or a typed KESTREL1 key. */
export type LicenceSource = 'purchase' | 'gift' | 'key';

export interface AccountRecord {
  accountId: string;
  emailHash: string;
  passwordHash: string;
  role: Role;
  status: 'active' | 'suspended';
  createdAtMs: number;
  /**
   * A standing, account-level "use Gemini" preference, set once by the person and kept across
   * devices - separate from and in addition to the per-request `userConsent` every /v1/ai/* call
   * still carries. This lets the app stop asking every single time once the person has opted in
   * once; it never replaces the per-request check.
   */
  aiConsent: boolean;
}

export interface LicenceRecord {
  licenceId: string;
  accountId: string | null;
  plan: LicencePlan;
  managedAi: boolean;
  status: LicenceStatus;
  maxDevices: number;
  offlineGraceDays: number;
  validUntilMs: number | null;
  updatedAtMs: number;
  /** Admin's note, e.g. who a gift key is for. Never shown to the licensee. */
  note: string | null;
  /** The major app version this licence covers (Pro is a one-off licence per major version). */
  majorVersion: number;
  /** True only when money was received. A gift is `paid: false` and still grants the plan. */
  paid: boolean;
  source: LicenceSource;
  /** SHA-256 of the person's email, so an entitlement can wait for them to sign in. Never the address itself. */
  emailHash: string | null;
}

export interface ActivationRecord {
  activationId: string;
  licenceId: string;
  deviceHash: string;
  platform: string;
  appVersion: string;
  lastSeenMs: number;
}

export interface QuotaRecord {
  accountId: string;
  periodStartMs: number;
  requestsUsed: number;
  requestsLimit: number;
}

export interface ModelAssetRecord {
  assetId: string;
  kind: string;
  version: string;
  channel: string;
  path: string;
  sha256: string;
  bytes: number;
  requiredAppMin: string;
  status: 'candidate' | 'live' | 'retired';
  createdAtMs: number;
}

export interface ReleaseRecord {
  platform: string;
  channel: string;
  version: string;
  url: string;
  notes: string;
  minSupported: string;
  publishedAtMs: number;
}

export interface AuditRecord {
  atMs: number;
  actor: string;
  action: string;
  outcome: 'allowed' | 'denied';
  detail: string;
}

export type ContactStatus = 'new' | 'read' | 'answered';
/** A message from the website's contact form. Stored only because the sender ticked the consent box. */
export interface ContactMessageRecord {
  messageId: string;
  receivedAtMs: number;
  name: string;
  email: string;
  message: string;
  status: ContactStatus;
}

export interface BillingEventRecord { eventId: string; eventType: string; receivedAtMs: number }

export interface BillingEvent {
  id: string;
  type: 'licence.created' | 'licence.renewed' | 'licence.revoked';
  data: { licenceId: string; plan?: 'paid' | 'subscriber'; validUntilMs?: number; managedAi?: boolean };
}

export type ActivationOutcome =
  | { ok: true; activationId: string; licence: LicenceRecord }
  | { ok: false; reason: 'not_active' }
  | { ok: false; reason: 'device_limit'; maxDevices: number };

export interface ActivationRequest {
  licenceId: string;
  /** Plan from the signed key, used only when the server has never seen this licence. */
  planIfNew: LicencePlan;
  deviceHash: string;
  platform: string;
  appVersion: string;
  /** A fresh id the store uses if this device takes a new slot. */
  newActivationId: string;
  nowMs: number;
}

export interface Store {
  readonly kind: 'sqlite' | 'firestore';

  // Accounts and sessions
  /** False when an account with that email hash already exists. */
  createAccount(account: AccountRecord): Promise<boolean>;
  getAccount(accountId: string): Promise<AccountRecord | undefined>;
  setAccountRole(accountId: string, role: Role): Promise<void>;
  /** The standing "use Gemini" account preference (see AccountRecord.aiConsent). */
  setAiConsent(accountId: string, consent: boolean): Promise<void>;
  findAccountByEmailHash(emailHash: string): Promise<AccountRecord | undefined>;
  addRefreshToken(tokenHash: string, accountId: string, expiresAtMs: number): Promise<void>;
  /** Single use: marks the token used and returns its account, or undefined when missing, used or expired. */
  consumeRefreshToken(tokenHash: string, nowMs: number): Promise<string | undefined>;

  // Licences and devices
  insertLicence(licence: LicenceRecord): Promise<void>;
  /** Atomic and idempotent on `licenceId`: an existing licence is returned unchanged and `created` is false. */
  grantLicence(licence: LicenceRecord): Promise<{ created: boolean; licence: LicenceRecord }>;
  /** Attaches every unclaimed licence for this email to the account. Returns how many were attached. */
  claimLicencesForEmail(emailHash: string, accountId: string): Promise<number>;
  getLicence(licenceId: string): Promise<LicenceRecord | undefined>;
  listLicencesForAccount(accountId: string): Promise<LicenceRecord[]>;
  hasActiveManagedAi(accountId: string): Promise<boolean>;
  /** Atomic: creates the licence row if unknown, checks it is active, reuses this device's slot or takes a free one. */
  activateDevice(request: ActivationRequest): Promise<ActivationOutcome>;
  /** False when there is no such licence. */
  setLicenceStatus(licenceId: string, status: LicenceStatus, nowMs: number): Promise<boolean>;
  /** Extends validity and reactivates. Undefined when there is no such licence. */
  extendLicence(licenceId: string, days: number, nowMs: number): Promise<number | undefined>;
  /** Most recently changed first. */
  listLicences(limit: number): Promise<LicenceRecord[]>;
  /** Most recently seen first. */
  listActivations(limit: number): Promise<ActivationRecord[]>;
  /** One licence's devices, most recently seen first. */
  listActivationsForLicence(licenceId: string): Promise<ActivationRecord[]>;
  /** Frees the device's slot. False when there is no such activation. */
  deactivateDevice(activationId: string): Promise<boolean>;

  // Managed AI allowance
  /** Atomic: starts a new period when due, then takes one unit if any remain. */
  reserveQuota(accountId: string, nowMs: number, periodMs: number): Promise<boolean>;
  refundQuota(accountId: string): Promise<void>;
  getQuota(accountId: string): Promise<QuotaRecord | undefined>;
  setQuotaLimit(accountId: string, requestsLimit: number, nowMs: number): Promise<void>;
  /** Most recent period first. */
  listQuotas(limit: number): Promise<QuotaRecord[]>;

  // Billing
  /** Atomic and idempotent on the event id: 'replayed' means nothing changed. */
  applyBillingEvent(event: BillingEvent, nowMs: number): Promise<'applied' | 'replayed'>;
  /** Newest first. */
  listBillingEvents(limit: number): Promise<BillingEventRecord[]>;

  // Models and releases
  /** False when that asset version is already registered on that channel. */
  insertModelAsset(asset: ModelAssetRecord): Promise<boolean>;
  listLiveModelAssets(channel: string): Promise<ModelAssetRecord[]>;
  /** Atomic: retires the live version, makes this one live, bumps the channel's manifest revision. False if unknown. */
  promoteModelAsset(assetId: string, version: string, channel: string): Promise<boolean>;
  /** False when that release version is already published on that channel. */
  insertRelease(release: ReleaseRecord): Promise<boolean>;
  listReleases(platform: string, channel: string): Promise<ReleaseRecord[]>;

  // Contact form
  insertContactMessage(message: ContactMessageRecord): Promise<void>;
  /** Newest first. */
  listContactMessages(limit: number): Promise<ContactMessageRecord[]>;
  /** False when there is no such message. */
  setContactMessageStatus(messageId: string, status: ContactStatus): Promise<boolean>;

  // Settings, counts and audit
  getSetting(name: string): Promise<string | undefined>;
  setSetting(name: string, value: string): Promise<void>;
  counts(): Promise<{ accounts: number; licences: number; activations: number }>;
  /** Append-only. Nothing updates or deletes audit entries. */
  audit(entry: AuditRecord): Promise<void>;
  /** Newest first. */
  listAudit(limit: number): Promise<AuditRecord[]>;

  close(): Promise<void>;
}

// ---- Shared rules (pure), so both stores decide the same way ----------------------------------------------------

export const DAY_MS = 86_400_000;
export const AUDIT_DETAIL_MAX = 500;
/** AI requests per period for an account nobody has set an allowance for (schema.sql has the same default). */
export const QUOTA_DEFAULT_LIMIT = 500;

export function newLicence(licenceId: string, plan: LicencePlan, nowMs: number, extra: Partial<LicenceRecord> = {}): LicenceRecord {
  return { licenceId, accountId: null, plan, managedAi: false, status: 'active', maxDevices: 3, offlineGraceDays: 30, validUntilMs: null, updatedAtMs: nowMs, note: null, majorVersion: 1, paid: false, source: 'key', emailHash: null, ...extra };
}

export function licenceIsUsable(licence: LicenceRecord, nowMs: number): boolean {
  return licence.status !== 'revoked' && licence.status !== 'expired' && (licence.validUntilMs === null || licence.validUntilMs > nowMs);
}

export function extendedUntil(validUntilMs: number | null, days: number, nowMs: number): number {
  return Math.max(validUntilMs ?? nowMs, nowMs) + days * DAY_MS;
}

/** What a billing event does to a licence (undefined licence = not known yet). Undefined result = no change. */
export function licenceAfterBillingEvent(event: BillingEvent, current: LicenceRecord | undefined, nowMs: number): LicenceRecord | undefined {
  const { licenceId, plan, validUntilMs, managedAi } = event.data;
  if (event.type === 'licence.created') {
    return current ? undefined : newLicence(licenceId, plan ?? 'paid', nowMs, { managedAi: managedAi ?? false, validUntilMs: validUntilMs ?? null });
  }
  if (!current) return undefined;
  if (event.type === 'licence.renewed') return { ...current, status: 'active', validUntilMs: validUntilMs ?? null, updatedAtMs: nowMs };
  return { ...current, status: 'revoked', updatedAtMs: nowMs };
}

export const clipAuditDetail = (detail: string) => detail.slice(0, AUDIT_DETAIL_MAX);
