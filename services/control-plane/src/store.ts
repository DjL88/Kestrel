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

export type AccountStatus = 'active' | 'suspended' | 'merged';

export interface AccountRecord {
  accountId: string;
  emailHash: string;
  passwordHash: string;
  role: Role;
  /** 'merged': brought into another account by the person (accountMerge.ts); undoable for 30 days. */
  status: AccountStatus;
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
  /** Suspends or restores an account (acceptable use). A suspended account cannot sign in or use a session. */
  setAccountStatus(accountId: string, status: AccountStatus): Promise<void>;
  /** The standing "use Gemini" account preference (see AccountRecord.aiConsent). */
  setAiConsent(accountId: string, consent: boolean): Promise<void>;
  /**
   * The person's app preferences kept with the account (quick setup's answers: language, what they shoot, experience,
   * cloud choice, Flight mode, finished). Small, checked by the route, and removed with the account.
   */
  getPreferences(accountId: string): Promise<Record<string, unknown> | undefined>;
  setPreferences(accountId: string, preferences: Record<string, unknown>): Promise<void>;
  findAccountByEmailHash(emailHash: string): Promise<AccountRecord | undefined>;
  /**
   * Account deletion (accountErasure.ts), atomic: the account row and its email link, every refresh token, the AI
   * allowance, and each licence's device records go. Licences stay as rows (a Paddle refund still finds its licence by
   * the order, and purchase records are kept for tax law) but lose the account and email hash and are revoked. Audit
   * entries are append-only and keep only the opaque account id. Returns how many licences were detached.
   */
  eraseAccount(accountId: string, nowMs: number): Promise<{ licences: number }>;
  addRefreshToken(tokenHash: string, accountId: string, expiresAtMs: number): Promise<void>;
  /** Single use: marks the token used and returns its account, or undefined when missing, used or expired. */
  consumeRefreshToken(tokenHash: string, nowMs: number): Promise<string | undefined>;

  // Licences and devices
  insertLicence(licence: LicenceRecord): Promise<void>;
  /** Atomic and idempotent on `licenceId`: an existing licence is returned unchanged and `created` is false. */
  grantLicence(licence: LicenceRecord): Promise<{ created: boolean; licence: LicenceRecord }>;
  /** Attaches every unclaimed licence for this email to the account. Returns how many were attached. */
  claimLicencesForEmail(emailHash: string, accountId: string): Promise<number>;
  /**
   * Put a KESTREL1 key's licence on an account (the person signed up after using the key with no account). Atomic:
   * 'attached' when it had no account (created from `ifNew` when the key was never activated), 'already' when it is
   * on this account, 'other' when another account holds it (never moved here: that is an account merge).
   */
  attachLicenceToAccount(licenceId: string, accountId: string, ifNew: LicenceRecord): Promise<'attached' | 'already' | 'other'>;
  getLicence(licenceId: string): Promise<LicenceRecord | undefined>;
  listLicencesForAccount(accountId: string): Promise<LicenceRecord[]>;
  /** Move one licence between accounts, only if it is still on `from` (account merge and its undo). Its devices come with it. */
  reassignLicence(licenceId: string, fromAccountId: string, toAccountId: string): Promise<boolean>;
  hasActiveManagedAi(accountId: string): Promise<boolean>;
  /** Atomic: creates the licence row if unknown, checks it is active, reuses this device's slot or takes a free one. */
  activateDevice(request: ActivationRequest): Promise<ActivationOutcome>;
  /** False when there is no such licence. */
  setLicenceStatus(licenceId: string, status: LicenceStatus, nowMs: number): Promise<boolean>;
  /**
   * Sets when the licence stops (a subscription's paid-through date plus grace), leaving its status alone, so a
   * refunded or revoked licence is never switched back on by a renewal. False when there is no such licence.
   */
  setLicenceValidUntil(licenceId: string, validUntilMs: number, nowMs: number): Promise<boolean>;
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

  // Desktop releases
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
  return { licenceId, accountId: null, plan, managedAi: false, status: 'active', maxDevices: 5, offlineGraceDays: 30, validUntilMs: null, updatedAtMs: nowMs, note: null, majorVersion: 1, paid: false, source: 'key', emailHash: null, ...extra };
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
