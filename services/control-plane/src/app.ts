import type { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { EntitlementGrant } from '../../../src/core/entitlementGrant.ts';
import { forPublicDocument, parseFlagSet, resolveFlagsForGrant, MAX_GRANT_FLAGS, type Audience, type FlagSet } from '../../../src/core/featureFlags.ts';
import { parseDataManifest, type DataManifest } from '../../../src/core/dataUpdateManifest.ts';
import { verifyLicence } from '../../../src/core/licence.ts';
import { newerRelease } from '../../../src/core/desktopRelease.ts';
import { inspectJpeg } from '../../../src/core/jpegInspect.ts';
import type { Config } from './config.ts';
import { hashPassword, randomId, sha256Hex, signEnvelope, signSession, uuid, verifyPassword, verifySession, verifyWebhook, type SessionClaims } from './crypto.ts';
import { SqliteStore } from './sqliteStore.ts';
import { MemoryDemoStudio, publicExamples, adminExamples, type DemoStudioStore, type ExampleFields } from './demoStudio.ts';
import { licenceIsUsable, newLicence, type AuditRecord, type Store } from './store.ts';
import { geminiProvider, identify, suggest, verifyColour, type AiProvider } from './gateway.ts';
import type { CommerceLedger } from './commerce/ledger.ts';
import type { TransactionRecord } from './commerce/records.ts';
import { emailHashOf, giftEntitlement } from './entitlement.ts';
import { googleKeysFromNetwork, verifyGoogleIdToken, GOOGLE_CERTS_URL, type GoogleKeys } from './googleIdToken.ts';
import { APPLE_ISSUER, APPLE_KEYS_URL, FIREBASE_KEYS_URL, firebaseIssuer, oidcKeysFromNetwork, verifyOidcIdToken, type OidcKeys } from './oidcIdToken.ts';
import { UK_VAT_THRESHOLD_PENCE, UK_VAT_WARNING_PENCE } from './commerce/turnover.ts';
import { CLOUD_KINDS, DEFAULT_MAX_JOB_MS, type CloudJobRecord, type CloudOptions } from './cloudJobs.ts';
import { LEARNING_ACTIONS, LEARNING_CAPABILITIES, LEARNING_SOURCES, type LearningSink } from './learningSignal.ts';
import { SAFE_COPY_LEVELS, SAFE_COPY_MAX_BYTES, safeCopyKey, type SafeCopyOptions } from './safeCopy.ts';
import type { SpendOptions } from './spendGuard.ts';
import { ApiError, matchRoute, parseJson, readBody, send, type Reply, type Request, type Route } from './http.ts';

export const MAX_IMAGE_BYTES = 512 * 1024;
export const MAX_IMAGE_EDGE = 1024;
const DAY_MS = 86_400_000;
const QUOTA_PERIOD_MS = 30 * DAY_MS;
const REFRESH_TTL_MS = 30 * DAY_MS;
const SumupNotification = z.object({ event_type: z.string().min(1).max(64), id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/) });
const offlineDeadline = (licence: { offlineGraceDays: number; validUntilMs: number | null }, now: number) =>
  Math.min(now + licence.offlineGraceDays * DAY_MS, licence.validUntilMs ?? Infinity);

export interface AppOptions {
  config: Config;
  store?: Store;
  commerce?: Pick<CommerceLedger, 'getTaxSettings' | 'updateTaxSettings' | 'recordTurnover' | 'ossQuarter'>;
  pricing?: Pick<CommerceLedger, 'latestPriceReview'>;
  /** Paid checkouts for the admin console's Payments table (the Firestore commerce ledger). */
  payments?: { listTransactions(limit: number): Promise<TransactionRecord[]> };
  /** Re-fetches and matches SumUp checkout and transaction records before fulfilling a server-owned order. */
  settleSumupPro?: (checkoutId: string) => Promise<void>;
  /** Google's ID-token signing keys. Injected for tests; fetched from Google otherwise. */
  googleKeys?: GoogleKeys;
  firebaseKeys?: OidcKeys;
  /** Apple's signing keys. Tests supply their own; production reads them from Apple. */
  appleKeys?: OidcKeys;
  /** Injected for tests. Defaults to Gemini when a server key is configured, otherwise none. */
  provider?: AiProvider | null;
  now?: () => number;
  /** Backend-only demo image store; Cloud Run supplies GCS+Firestore, local tests use memory. */
  demoStudio?: DemoStudioStore;
  /** Cloud Processing Engine. Absent in production until the owner approves the bucket and runner: the routes then answer 503. */
  cloud?: CloudOptions;
  /** Opt-in learning signal. Absent in production until approved: the routes then answer 503. */
  learning?: LearningSink;
  /** Managed safe copy (opt-in backup). Absent in production until a bucket exists and is approved: routes answer 503. */
  safeCopy?: SafeCopyOptions;
  /** Hard monthly ceiling on metered spend (Gemini, cloud jobs). Absent: no guard (development and tests). */
  spend?: SpendOptions;
  /** Production sets this: the cloud, safe copy and learning features stay OFF until an admin switches them on. Tests and development leave them on. */
  requireAdminSwitch?: boolean;
}

// ---- Schemas: the contract, also published as OpenAPI ------------------------

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const Version = z.string().regex(/^\d+\.\d+\.\d+$/);
const Platform = z.enum(['windows', 'macos', 'web', 'ios', 'android']);
const ImageBody = z.object({
  image: z.string().min(4).max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8).describe('Base64 JPEG, redrawn so it carries no camera metadata'),
  userConsent: z.boolean().describe('Must be true: the person agreed to send this photo'),
}).strict();
const AdminTaxSettings = z.object({
  ukVatRegistered: z.boolean(),
  ukVatNumber: z.string().max(22).optional(),
  b2cPricing: z.enum(['exclusive', 'inclusive']),
  localTaxes: z.record(z.string().regex(/^[A-Z]{2}(?:-[A-Z0-9]{1,8})?$/), z.object({
    enabled: z.boolean(), rateBasisPoints: z.number().int().min(0).max(10000),
  }).strict()),
}).strict().refine(settings => !settings.ukVatRegistered ||
  /^(?:GB)?\d{9}(?:\d{3})?$/.test(settings.ukVatNumber?.replace(/\s/g, '').toUpperCase() ?? ''), {
  message: 'Enter the HMRC VAT registration number before turning on UK VAT.',
  path: ['ukVatNumber'],
});
const SignedEnvelopeSchema = z.object({ payload: z.unknown(), signature: z.string(), keyId: z.string() });

const DemoDetails = z.object({
  title: z.string().trim().min(1).max(80),
  subject: z.string().trim().max(120),
  credit: z.string().trim().max(200),
  alt: z.string().trim().min(1).max(220),
}).strict();
const DemoEdit = z.object({
  exposure: z.number().finite().min(-2).max(2),
  warmth: z.number().finite().min(-2).max(2),
  colour: z.number().finite().min(-2).max(2),
  brightness: z.number().finite().min(-2).max(2).optional(),
  contrast: z.number().finite().min(-2).max(2).optional(),
  highlights: z.number().finite().min(-2).max(2).optional(),
  shadows: z.number().finite().min(-2).max(2).optional(),
  whites: z.number().finite().min(-2).max(2).optional(),
  blacks: z.number().finite().min(-2).max(2).optional(),
  vibrance: z.number().finite().min(-2).max(2).optional(),
  texture: z.number().finite().min(-2).max(2).optional(),
  clarity: z.number().finite().min(-2).max(2).optional(),
  sharpen: z.number().finite().min(-2).max(2).optional(),
  denoise: z.number().finite().min(0).max(2).optional(),
  // Real PhotoEditor masks are shaped by its own editing model. Save only
  // a bounded, owner-authenticated JSON recipe; request limit is 128 KiB.
  masks: z.array(z.unknown()).max(8).optional(),
}).strict();
const DemoFraming = z.object({
  ratio: z.number().finite().min(0.1).max(10).nullable(),
  turns: z.number().int().min(-360).max(360),
  straighten: z.number().finite().min(-45).max(45),
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  size: z.number().finite().min(0.08).max(1).optional(),
  free: z.boolean().optional(),
}).strict();
/** Slider name to value: short identifiers and bounded numbers only, so a free-text field cannot hide in here. */
const SliderMap = z.record(z.string().regex(/^[a-z][a-zA-Z0-9]{0,23}$/), z.number().finite().min(-100).max(100)).refine((m) => Object.keys(m).length <= 16, 'at most 16 sliders');
const Sha = z.string().regex(/^[0-9a-f]{64}$/);
export const Schemas = {
  AdminSwitch: z.object({ key: z.enum(['managed-ai', 'cloud-processing', 'safe-copy', 'learning-signal']), on: z.boolean() }).strict(),
  SafeCopyLevels: z.object({ levels: z.object({ recipes: z.boolean(), previews: z.boolean(), originals: z.boolean() }).partial().strict() }).strict(),
  SafeCopyUpload: z.object({ level: z.enum(SAFE_COPY_LEVELS), sha256: Sha, bytes: z.number().int().positive() }).strict(),
  SafeCopyObject: z.object({ level: z.enum(SAFE_COPY_LEVELS), sha256: Sha }).strict(),
  DemoCreate: DemoDetails.extend({ jpegBase64: z.string().min(128).max(2_200_000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict(),
  DemoSave: DemoDetails.extend({ revision: z.number().int().positive(), edit: DemoEdit, framing: DemoFraming }).strict(),
  DemoRevision: z.object({ revision: z.number().int().positive() }).strict(),
  DemoPublish: z.object({ revision: z.number().int().positive(), published: z.boolean() }).strict(),
  SessionRequest: z.object({ email: z.string().email().max(254), password: z.string().min(8).max(200) }).strict(),
  RefreshRequest: z.object({ refreshToken: z.string().min(20).max(200) }).strict(),
  SessionResponse: z.object({ accessToken: z.string(), refreshToken: z.string(), expiresIn: z.number() }),
  ActivateRequest: z.object({ licenceKey: z.string().min(10).max(2000), deviceHash: Hex64, platform: Platform, appVersion: Version }).strict(),
  LicenceStatusRequest: z.object({ licenceKey: z.string().min(10).max(2000), deviceHash: Hex64 }).strict(),
  LicenceStatusResponse: z.object({
    status: z.enum(['active', 'revoked', 'expired', 'unknown']), validUntilMs: z.number().nullable(), maxDevices: z.number(),
    devices: z.array(z.object({ activationId: z.string(), platform: z.string(), appVersion: z.string(), lastSeenMs: z.number(), thisDevice: z.boolean() })),
  }),
  DeactivateRequest: z.object({ licenceKey: z.string().min(10).max(2000), activationId: z.string().min(1).max(64) }).strict(),
  AccountActivateRequest: z.object({ deviceHash: Hex64, platform: Platform, appVersion: Version }).strict(),
  ActivateResponse: z.object({ grant: SignedEnvelopeSchema, activationId: z.string() }),
  EntitlementsResponse: z.object({
    plans: z.array(z.object({ licenceId: z.string(), plan: z.string(), status: z.string(), managedAi: z.boolean(), offlineGraceDays: z.number(), majorVersion: z.number(), paid: z.boolean(), source: z.string() })),
    aiQuota: z.object({ requestsUsed: z.number(), requestsLimit: z.number(), periodEndsMs: z.number() }).nullable(),
    /**
     * The account's own standing "use Gemini" choice, set once and kept across devices. Separate from
     * `managedAi` above (whether the plan includes the online helper at all) and from the per-request
     * `userConsent` flag every /v1/ai/* call still carries: this is what lets the app stop asking every time.
     */
    aiConsent: z.boolean(),
    nextRevalidationMs: z.number(),
  }),
  CloudJobRequest: z.object({ kind: z.enum(CLOUD_KINDS), inputBytes: z.number().int().positive(), userConsent: z.boolean() }).strict(),
  LearningSignal: z.object({
    source: z.enum(LEARNING_SOURCES), capability: z.enum(LEARNING_CAPABILITIES), action: z.enum(LEARNING_ACTIONS),
    candidateRank: z.number().int().min(1).max(3).optional(),
    proposal: SliderMap, final: SliderMap, appVersion: Version,
  }).strict(),
  ImageRequest: ImageBody,
  IdentifyResponse: z.object({ kind: z.string(), species: z.string().nullable(), scientific: z.string().nullable(), confidence: z.enum(['high', 'medium', 'low']), tags: z.array(z.string()), abstained: z.boolean() }),
  SuggestResponse: z.object({ proposal: z.record(z.string(), z.number()), alreadyBalanced: z.boolean() }),
  VerifyColourResponse: z.object({
    plausible: z.boolean(),
    concerns: z.array(z.enum(['skinTone', 'skyOrFoliage', 'clipping', 'oversaturated', 'flat', 'other'])),
    note: z.string().nullable(),
  }),
  ManifestResponse: SignedEnvelopeSchema,
  ReleaseResponse: z.object({ release: z.object({ version: z.string(), url: z.string(), notes: z.string(), minSupported: z.string(), publishedAt: z.string() }).nullable() }),
  WebhookEvent: z.object({
    id: z.string().min(1).max(128),
    type: z.enum(['licence.created', 'licence.renewed', 'licence.revoked']),
    data: z.object({ licenceId: z.string().min(1).max(64), plan: z.enum(['paid', 'subscriber']).optional(), validUntilMs: z.number().int().optional(), managedAi: z.boolean().optional() }).strict(),
  }).strict(),
  AdminAccount: z.object({ email: z.string().email(), password: z.string().min(12).max(200), role: z.enum(['user', 'admin']) }).strict(),
  AdminGrant: z.object({
    email: z.string().trim().email().max(254),
    plan: z.enum(['paid', 'subscriber']).default('paid'),
    majorVersion: z.number().int().min(1).max(99).default(1),
    managedAi: z.boolean().default(false),
    note: z.string().trim().max(200).optional().describe('Why this was given, e.g. "Camera club prize". Admin-only.'),
    validDays: z.number().int().min(1).max(3650).optional(),
  }).strict(),
  AdminIssue: z.object({
    plan: z.literal('paid'), managedAi: z.boolean().default(false), accountId: z.string().optional(), maxDevices: z.number().int().min(1).max(20).default(3),
    note: z.string().trim().max(200).optional().describe('Who the key is for, e.g. "Gift for the camera club". Admin-only.'),
    validDays: z.number().int().min(1).max(3650).optional().describe('Server-side expiry: activation and renewal stop after this many days. A key used fully offline is not checked against it.'),
  }).strict(),
  ProviderSignIn: z.object({ credential: z.string().min(20).max(4096) }).strict(),
  AdminGoogleSession: z.object({ credential: z.string().min(20).max(4096) }).strict(),
  AdminMessageStatus: z.object({ status: z.enum(['new', 'read', 'answered']) }).strict(),
  ContactRequest: z.object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(254),
    message: z.string().trim().min(1).max(5000),
    consent: z.literal(true).describe('The sender agreed that InFlight may store this message to reply to it'),
    website: z.string().max(200).optional().describe('Leave empty. Hidden from people; filled in by spam robots.'),
  }).strict(),
  AdminRevokeKey: z.object({ licenceKey: z.string().min(10).max(2000).describe('The whole key, so its signature can be checked. Only its licence id is kept.') }).strict(),
  AdminExtend: z.object({ days: z.number().int().min(1).max(365) }).strict(),
  AdminKillSwitch: z.object({ aiDisabled: z.boolean() }).strict(),
  AdminFlagSet: z.object({
    key: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/),
    flag: z.object({ default: z.boolean(), kill: z.boolean().optional(), minAppVersion: z.string().max(20).optional(), rules: z.array(z.unknown()).max(50) }).strict(),
  }).strict(),
  AdminFlagDelete: z.object({ key: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/) }).strict(),
  AdminQuota: z.object({ accountId: z.string(), requestsLimit: z.number().int().min(0).max(1_000_000) }).strict(),
  AdminModel: z.object({
    id: z.string(), kind: z.enum(['onnx', 'species-library', 'equipment']), version: z.string(), path: z.string(),
    sha256: Hex64, bytes: z.number().int().positive(), requiredAppMin: Version.default('0.0.0'), channel: z.enum(['stable', 'beta']).default('stable'),
    /** What the model does for the app (inputs, outputs, labels). Required for ONNX: the app only swaps a slot with an unchanged contract. */
    contract: z.string().max(80).optional(),
    /** The rights record for this exact version. Required for ONNX. Never stored in Git; weights are not either. */
    licence: z.object({ spdx: z.string().min(1).max(64), sourceUrl: z.string().url().max(300).startsWith('https://'), noticePath: z.string().max(180).optional(), rightsConfirmed: z.boolean() }).strict().optional(),
  }).strict(),
  AdminPromote: z.object({ id: z.string(), version: z.string(), channel: z.enum(['stable', 'beta']).default('stable') }).strict(),
  AdminRelease: z.object({ platform: z.enum(['windows', 'macos']), channel: z.enum(['stable', 'beta']).default('stable'), version: Version, url: z.string().url(), notes: z.string().max(4000).default(''), minSupported: Version.default('0.0.0') }).strict(),
  AiConsentRequest: z.object({ consent: z.boolean() }).strict(),
};

// ---- Small helpers -----------------------------------------------------------

/** Fixed-window limiter, per key. In-process; a multi-instance deployment needs a shared store. */
class RateLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}
  take(key: string, now: number): boolean {
    const hit = this.hits.get(key);
    if (!hit || now - hit.windowStart >= this.windowMs) { this.hits.set(key, { windowStart: now, count: 1 }); return true; }
    hit.count += 1;
    return hit.count <= this.limit;
  }
}

const versionAtLeast = (version: string, minimum: string) => version === minimum || newerRelease(version, minimum);

function decodeImage(base64: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new ApiError(400, 'IMAGE_INVALID', 'The image is not valid base64.');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) throw new ApiError(413, 'IMAGE_TOO_LARGE', 'The image is larger than 512 KB.');
  const facts = inspectJpeg(bytes);
  if (!facts) throw new ApiError(400, 'IMAGE_INVALID', 'The image is not a JPEG.');
  if (facts.width > MAX_IMAGE_EDGE || facts.height > MAX_IMAGE_EDGE) throw new ApiError(413, 'IMAGE_TOO_LARGE', 'The image is larger than 1024 pixels on a side.');
  if (facts.hasMetadata) throw new ApiError(400, 'IMAGE_HAS_METADATA', 'The image still carries camera metadata (EXIF or XMP), which can include location. InFlight only sends redrawn images.');
  return bytes;
}

// ---- The application -----------------------------------------------------------

export function createApp(options: AppOptions) {
  const { config, commerce } = options;
  if (!options.store && config.store !== 'sqlite') throw new Error('Open the Firestore store with openStore() and pass it in.');
  const store: Store = options.store ?? new SqliteStore(config.databasePath);
  const demoStudio: DemoStudioStore | null = options.demoStudio ?? (config.devMode ? new MemoryDemoStudio() : null);
  const now = options.now ?? Date.now;
  const provider: AiProvider | null = options.provider !== undefined
    ? options.provider
    : config.geminiApiKey ? geminiProvider(config.geminiApiKey, config.geminiModel) : null;
  const authLimiter = new RateLimiter(10, 60_000);
  const contactLimiter = new RateLimiter(5, 10 * 60_000);
  const contactGlobalLimiter = new RateLimiter(60, 60 * 60_000);
  const googleKeys = options.googleKeys ?? googleKeysFromNetwork();
  const appleKeys = options.appleKeys ?? oidcKeysFromNetwork(APPLE_KEYS_URL);
  const firebaseKeys: OidcKeys = options.firebaseKeys ?? oidcKeysFromNetwork(FIREBASE_KEYS_URL);
  const userGoogleKeys: OidcKeys = options.googleKeys ?? oidcKeysFromNetwork(GOOGLE_CERTS_URL);
  const adminEmailHashes = new Set(config.adminEmails.map((email) => sha256Hex(email)));
  const activateLimiter = new RateLimiter(20, 60_000);
  const sumupLimiter = new RateLimiter(90, 60_000);

  const audit = (actor: string, action: string, outcome: AuditRecord['outcome'], detail: string) => store.audit({ atMs: now(), actor, action, outcome, detail });

  async function bearer(req: Request): Promise<SessionClaims> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new ApiError(401, 'AUTH_REQUIRED', 'Sign in to use this.');
    const check = verifySession(header.slice(7), config.sessionSecret, now());
    if (!check.ok) throw new ApiError(401, check.code, check.code === 'AUTH_TOKEN_EXPIRED' ? 'Your session has ended. Sign in again.' : 'Sign in to use this.');
    const account = await store.getAccount(check.claims.sub);
    if (!account || account.status !== 'active') throw new ApiError(401, 'AUTH_TOKEN_INVALID', 'Sign in to use this.');
    return { ...check.claims, role: account.role === 'admin' ? 'admin' : 'user' };
  }

  async function issueSession(accountId: string, role: SessionClaims['role']) {
    const refreshToken = randomId(32);
    await store.addRefreshToken(sha256Hex(refreshToken), accountId, now() + REFRESH_TTL_MS);
    return { accessToken: signSession(accountId, role, config.sessionSecret, now()), refreshToken, expiresIn: 900 };
  }

  /**
   * People sign in with a provider's ID token, never a password. The email is the identity: a verified address creates
   * the account if it is new, and attaches any entitlement that was waiting for it (a purchase or a free grant).
   * Sessions from here are always plain user sessions, whatever role the account holds elsewhere.
   */
  async function signInWithProvider(provider: 'google' | 'apple' | 'firebase', email: string, privateRelay: boolean) {
    const emailHash = sha256Hex(email);
    let account = await store.findAccountByEmailHash(emailHash);
    if (!account) {
      await store.createAccount({ accountId: `acc_${randomId(12)}`, emailHash, passwordHash: `${provider}-only`, role: 'user', status: 'active', createdAtMs: now(), aiConsent: false });
      account = await store.findAccountByEmailHash(emailHash);
    }
    if (!account || account.status !== 'active') throw new ApiError(403, 'FORBIDDEN', 'This account is suspended.');
    const attached = await store.claimLicencesForEmail(emailHash, account.accountId);
    await audit(account.accountId, 'user.signin', 'allowed', `${provider}${attached ? ` attached=${attached}` : ''}`);
    return { ...(await issueSession(account.accountId, 'user')), signedInWith: provider, entitlementsAttached: attached, privateRelay };
  }
  function providerRoute(provider: 'google' | 'apple' | 'firebase'): Route {
    return {
      method: 'POST', path: `/v1/auth/${provider}`, summary: `Sign in with ${provider === 'apple' ? 'Apple' : provider === 'firebase' ? 'the app (Firebase)' : 'Google'}: exchange the provider's ID token for a session`, auth: 'none', body: Schemas.ProviderSignIn,
      handler: async (req) => {
        if (!authLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
        const body = parseJson(Schemas.ProviderSignIn, req.rawBody);
        const audiences = provider === 'apple' ? config.appleClientIds : provider === 'firebase' ? (config.firebaseProjectId ? [config.firebaseProjectId] : []) : config.userGoogleClientIds;
        if (audiences.length === 0) throw new ApiError(503, 'SIGNIN_UNAVAILABLE', `Sign in with ${provider === 'apple' ? 'Apple' : provider === 'firebase' ? 'the app' : 'Google'} is not set up on this server.`);
        const issuers = provider === 'apple' ? [APPLE_ISSUER] : provider === 'firebase' ? [firebaseIssuer(audiences[0]!)] : ['accounts.google.com', 'https://accounts.google.com'];
        // A Firebase token for an email that is not yet verified is refused here, so nobody can claim a purchase made for
        // someone else's address just by registering it.
        const check = await verifyOidcIdToken(body.credential, { issuers, audiences },
          provider === 'apple' ? appleKeys : provider === 'firebase' ? firebaseKeys : userGoogleKeys, now());
        if (!check.ok) {
          await audit('anonymous', 'user.signin', 'denied', `${provider} token ${check.reason}`);
          if (check.reason === 'keys_unavailable') throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'The sign-in provider could not be reached. Try again in a minute.', true);
          throw new ApiError(401, 'AUTH_FAILED', 'That sign-in could not be checked. Sign in again.');
        }
        return { status: 200, body: await signInWithProvider(provider, check.email, check.privateRelay) };
      },
    };
  }

  async function createAccount(email: string, password: string, role: 'user' | 'admin'): Promise<string> {
    const accountId = `acc_${randomId(12)}`;
    const created = await store.createAccount({ accountId, emailHash: sha256Hex(email.trim().toLowerCase()), passwordHash: hashPassword(password), role, status: 'active', createdAtMs: now(), aiConsent: false });
    if (!created) throw new ApiError(409, 'ACCOUNT_EXISTS', 'That account already exists.');
    return accountId;
  }

  /** Take one unit of AI allowance (atomically, in the store) or refuse. Returns the refund. */
  async function reserveQuota(accountId: string): Promise<() => Promise<void>> {
    if (!(await store.reserveQuota(accountId, now(), QUOTA_PERIOD_MS))) throw new ApiError(429, 'AI_QUOTA_EXHAUSTED', 'This account has used its AI allowance for this period.');
    let refunded = false;
    return async () => {
      if (refunded) return;
      refunded = true;
      await store.refundQuota(accountId);
    };
  }

  // ---- Admin on/off switches. Managed Gemini is on unless switched off (the existing `ai_disabled` setting, so the
  // existing admin control and this one are the same switch). The new features are off in production until an admin
  // switches them on. The older kill settings (cloud_disabled, safe_copy_disabled) still win.
  const SWITCHES = [
    { key: 'managed-ai', label: 'Managed Gemini helper', note: 'Sends one consented, metadata-free thumbnail at a time to Gemini. Counts against the monthly spend ceiling.' },
    { key: 'cloud-processing', label: 'Cloud processing', note: 'Heavier jobs (denoise, upscale, masks) for Pro. Needs the bucket and the runner job set up.' },
    { key: 'safe-copy', label: 'Safe copy (managed backup)', note: 'Opt-in backup to InFlight UK storage. Switching off stops uploads only; people can always read and delete their copy.' },
    { key: 'learning-signal', label: 'Learning signal', note: 'Opt-in anonymous corrections. Switching off stops sharing; opting out and deletion keep working.' },
  ] as const;
  type SwitchKey = typeof SWITCHES[number]['key'];
  const switchConfigured = (key: SwitchKey) => key === 'managed-ai' ? provider !== null : key === 'cloud-processing' ? !!options.cloud : key === 'safe-copy' ? !!options.safeCopy : !!options.learning;
  async function switchOn(key: SwitchKey): Promise<boolean> {
    if (key === 'managed-ai') return (await store.getSetting('ai_disabled')) !== '1';
    const legacy = key === 'cloud-processing' ? 'cloud_disabled' : key === 'safe-copy' ? 'safe_copy_disabled' : undefined;
    if (legacy && (await store.getSetting(legacy)) === '1') return false;
    const v = await store.getSetting(`switch_${key}`);
    return v === '1' || (v !== '0' && !options.requireAdminSwitch);
  }

  /** Reserve estimated metered spend; refuse with 503 when the month's ceiling would be passed. Returns the refund. */
  async function reserveSpend(pence: number, reservedAtMs = now()): Promise<() => Promise<void>> {
    const sp = options.spend;
    if (!sp) return async () => undefined;
    if (!(await sp.guard.reserve(reservedAtMs, pence, sp.ceilingPence))) throw new ApiError(503, 'SPEND_CEILING_REACHED', 'This month\'s spending limit for the online helper and cloud processing has been reached. Local work is unaffected.', true);
    let done = false;
    return async () => { if (done) return; done = true; await sp.guard.refund(reservedAtMs, pence); };
  }

  async function aiCall<T>(req: Request, work: (provider: AiProvider, image: string) => Promise<T>): Promise<T> {
    const claims = await bearer(req);
    const body = parseJson(Schemas.ImageRequest, req.rawBody);
    if (body.userConsent !== true) throw new ApiError(400, 'CONSENT_REQUIRED', 'InFlight needs your permission before sending a photo.');
    // A per-request click cannot override the account's separately revocable, default-off
    // managed-AI preference. Check the live store for every request (never a cached token
    // claim) before decoding, reserving quota or invoking the network provider.
    const account = await store.getAccount(claims.sub);
    if (account?.aiConsent !== true) throw new ApiError(403, 'AI_CONSENT_REQUIRED', 'Turn on the online AI helper in your account settings before sending a photo.');
    decodeImage(body.image);
    if (!(await switchOn('managed-ai'))) throw new ApiError(503, 'AI_DISABLED', 'The online helper is switched off for now.', true);
    if (!provider) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'The online helper is not set up on this server.');
    if (!(await store.hasActiveManagedAi(claims.sub))) throw new ApiError(403, 'AI_NOT_ENTITLED', 'The online helper is not part of this plan.');
    const refundSpend = await reserveSpend(options.spend?.aiCallPence ?? 0);
    const refund = await reserveQuota(claims.sub).catch(async (e) => { await refundSpend(); throw e; });
    try {
      return await work(provider, body.image);
    } catch (error) {
      await refund(); // A failed answer costs nothing.
      await refundSpend();
      throw error;
    }
  }

  // ---- Cloud Processing gate. Order matters: nothing is reserved or uploaded until every check has passed.
  /** Configured, kill switch and Pro. Runs on every request that starts work, not only on create. */
  async function cloudGate(accountId: string) {
    const cloud = options.cloud;
    if (!cloud) throw new ApiError(503, 'CLOUD_NOT_CONFIGURED', 'Cloud processing is not set up on this server.');
    // Kill switch: the settings key or a kill-switched flag. Checked live on every request.
    if (!(await switchOn('cloud-processing')) || (await loadFlags())['cloud.processing']?.kill === true) {
      await audit(accountId, 'cloud.job.create', 'denied', 'kill switch');
      throw new ApiError(503, 'CLOUD_DISABLED', 'Cloud processing is switched off for now.', true);
    }
    const licences = await store.listLicencesForAccount(accountId);
    if (!licences.some((l) => (l.plan === 'paid' || l.plan === 'subscriber') && licenceIsUsable(l, now()))) {
      await audit(accountId, 'cloud.job.create', 'denied', 'not Pro');
      throw new ApiError(403, 'CLOUD_NOT_ENTITLED', 'Cloud processing is part of Pro.');
    }
    return cloud;
  }
  async function cloudJobStart(req: Request): Promise<Reply> {
    const claims = await bearer(req);
    const body = parseJson(Schemas.CloudJobRequest, req.rawBody);
    if (body.userConsent !== true) throw new ApiError(400, 'CONSENT_REQUIRED', 'InFlight needs your permission before sending a photo to be processed.');
    const cloud = await cloudGate(claims.sub);
    if (body.inputBytes > cloud.maxInputBytes) throw new ApiError(413, 'CLOUD_INPUT_TOO_LARGE', 'This file is larger than cloud processing accepts.');
    const reservedAtMs = now();
    const spendPence = options.spend?.cloudJobPence ?? 0;
    const refundSpend = await reserveSpend(spendPence, reservedAtMs).catch(async (e) => { await audit(claims.sub, 'cloud.job.create', 'denied', 'spend ceiling'); throw e; });
    if (!(await cloud.ledger.reserve(claims.sub, reservedAtMs, cloud.jobsPerPeriod, QUOTA_PERIOD_MS))) {
      await refundSpend();
      await audit(claims.sub, 'cloud.job.create', 'denied', 'quota');
      throw new ApiError(429, 'CLOUD_QUOTA_EXHAUSTED', 'This account has used its cloud processing allowance for this period.');
    }
    const jobId = uuid();
    try {
      const upload = await cloud.runner.createUpload(jobId, body.inputBytes);
      await cloud.ledger.put({
        jobId, accountId: claims.sub, kind: body.kind, inputBytes: body.inputBytes,
        status: 'awaiting-upload', createdAtMs: reservedAtMs, consentAtMs: reservedAtMs,
        ...(options.spend ? { spendPence } : {}),
      });
      await audit(claims.sub, 'cloud.job.create', 'allowed', `${body.kind} ${jobId}`);
      return { status: 200, body: { jobId, uploadUrl: upload.uploadUrl, expiresAtMs: upload.expiresAtMs } };
    } catch (error) {
      await cloud.ledger.refund(claims.sub, reservedAtMs); // A job that never started costs nothing.
      await refundSpend();
      await cloud.runner.deleteInput(jobId).catch(() => undefined);
      throw new ApiError(502, 'CLOUD_RUNNER_FAILED', 'Cloud processing could not start. Nothing was uploaded or charged.', true);
    }
  }
  async function cloudJobOwned(req: Request, jobId: string) {
    const claims = await bearer(req);
    const record = await options.cloud?.ledger.get(jobId);
    // Someone else's job is indistinguishable from a missing one.
    if (!options.cloud || !record || record.accountId !== claims.sub) throw new ApiError(404, 'NOT_FOUND', 'No such job.');
    return { cloud: options.cloud, record };
  }

  async function settleFailedCloudJob(cloud: CloudOptions, record: CloudJobRecord): Promise<boolean> {
    const legacySpendPence = options.spend?.cloudJobPence ?? 0;
    if (cloud.settleFailed) return cloud.settleFailed(record.jobId, legacySpendPence);
    if (!(await cloud.ledger.transition(record.jobId, 'running', 'failed'))) return false;
    await cloud.ledger.refund(record.accountId, record.createdAtMs);
    await options.spend?.guard.refund(record.createdAtMs, record.spendPence ?? legacySpendPence);
    return true;
  }

  /** A stable pseudonym, so withdrawal can delete a person's signals without the store holding their account id. */
  const learningSubject = (accountId: string) => sha256Hex(`learning:${accountId}`);

  // ---- Managed safe copy. Uploads are gated; reading and deleting your own copy never is.
  function safeCopyCfg() {
    if (!options.safeCopy) throw new ApiError(503, 'SAFE_COPY_NOT_CONFIGURED', 'Safe copy is not set up on this server.');
    return options.safeCopy;
  }
  async function safeCopyUploadGate(accountId: string, level: typeof SAFE_COPY_LEVELS[number]) {
    const sc = safeCopyCfg();
    if (!(await switchOn('safe-copy'))) throw new ApiError(503, 'SAFE_COPY_DISABLED', 'Safe copy uploads are switched off for now. Your existing copy stays readable.', true);
    if (!(await sc.catalog.getSettings(accountId))[level]) throw new ApiError(403, 'SAFE_COPY_NOT_ENABLED', `Turn on safe copy for ${level} first. It is off until you choose.`);
    const plans = await store.listLicencesForAccount(accountId);
    if (!plans.some((l) => l.plan === 'subscriber' && licenceIsUsable(l, now()))) throw new ApiError(403, 'SAFE_COPY_NOT_ENTITLED', 'Managed storage is part of the Cloud plan.');
    return sc;
  }

  async function admin(req: Request, action: string): Promise<SessionClaims> {
    let claims: SessionClaims;
    try { claims = await bearer(req); } catch (error) { await audit('anonymous', action, 'denied', 'no valid session'); throw error; }
    if (claims.role !== 'admin') {
      await audit(claims.sub, action, 'denied', 'not an admin');
      throw new ApiError(403, 'FORBIDDEN', 'This needs an administrator.');
    }
    // With an allow-list configured, it is the final word: an admin role alone is not enough.
    if (adminEmailHashes.size > 0) {
      const account = await store.getAccount(claims.sub);
      if (!account || !adminEmailHashes.has(account.emailHash)) {
        await audit(claims.sub, action, 'denied', 'not on the admin allow-list');
        throw new ApiError(403, 'FORBIDDEN', 'This needs an administrator.');
      }
    }
    return claims;
  }

  async function adminDone(claims: SessionClaims, action: string, detail: string, body: unknown): Promise<Reply> {
    await audit(claims.sub, action, 'allowed', detail);
    return { status: 200, body };
  }

  // Feature flags live in one settings document (works on SQLite and Firestore alike). Rules for a named user hold the
  // SHA-256 of their email, never the address. Each device's grant carries the flags already resolved for that person.
  const FLAGS_SETTING = 'feature_flags';
  async function loadFlags(): Promise<FlagSet> {
    try { return parseFlagSet(JSON.parse((await store.getSetting(FLAGS_SETTING)) ?? '{}')); } catch { return {}; }
  }
  async function grantFlagsFor(audience: Audience, deviceHash: string, appVersion: string, nowMs: number): Promise<Pick<EntitlementGrant, 'flags'>> {
    const flags = await loadFlags();
    if (!Object.keys(flags).length) return {};
    const bucket = Number.parseInt(deviceHash.slice(0, 8), 16) % 100;
    return { flags: resolveFlagsForGrant(flags, { audience, nowMs, bucket, appVersion }) };
  }

  // Contract and licence per model version live in one settings document (works on SQLite and Firestore alike).
  const MODEL_META_SETTING = 'model_meta';
  type ModelMeta = Record<string, { contract?: string; licence?: { spdx: string; sourceUrl: string; noticePath?: string; rightsConfirmed: true; recordedAtMs: number } }>;
  async function loadModelMeta(): Promise<ModelMeta> {
    try { return JSON.parse((await store.getSetting(MODEL_META_SETTING)) ?? '{}') as ModelMeta; } catch { return {}; }
  }

  async function currentManifest(appVersion: string, channel: string): Promise<DataManifest> {
    const rows = await store.listLiveModelAssets(channel);
    const meta = await loadModelMeta();
    const assets = rows.filter((row) => versionAtLeast(appVersion, row.requiredAppMin))
      .map((row) => {
        const contract = meta[`${row.assetId}@${row.version}`]?.contract;
        return { id: row.assetId, kind: row.kind, version: row.version, path: row.path, bytes: row.bytes, sha256: row.sha256, ...(contract ? { contract } : {}) };
      });
    const manifest = parseDataManifest({ schema: 1, revision: Number((await store.getSetting(`manifest_revision_${channel}`)) ?? 1), assets });
    if (!manifest) throw new ApiError(500, 'MANIFEST_INVALID', 'The model registry is in an invalid state.');
    return manifest;
  }

  const routes: Route[] = [
    { method: 'GET', path: '/healthz', summary: 'Liveness', auth: 'none', handler: () => ({ status: 200, body: { ok: true } }) },


    // ---- Owner-approved, fixed photographs for the real website editor
    {
      method: 'GET', path: '/v1/demo/photos', summary: 'Read published photographs and exact approved edit recipes only', auth: 'none',
      handler: async () => ({
        status: 200, body: { photos: demoStudio ? publicExamples(await demoStudio.list(), (photo) => demoStudio.imageUrl(photo)) : [] },
      }),
    },
    {
      method: 'GET', path: '/v1/admin/demo/photos', summary: 'Private list of all staged and published demonstration photographs', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'demo.list');
        if (!demoStudio) throw new ApiError(503, 'DEMO_NOT_CONFIGURED', 'Photo storage is not set up on this server.');
        return adminDone(claims, 'demo.list', 'listed', { photos: adminExamples(await demoStudio.list(), (photo) => demoStudio.imageUrl(photo)) });
      },
    },
    {
      method: 'GET', path: '/v1/admin/demo/photos/:id/image', summary: 'Read a private draft preview with owner authentication', auth: 'admin',
      handler: async (req, params) => {
        const claims = await admin(req, 'demo.image');
        if (!demoStudio) throw new ApiError(503, 'DEMO_NOT_CONFIGURED', 'Photo storage is not set up on this server.');
        const jpeg = await demoStudio.image(params.id);
        return adminDone(claims, 'demo.image', params.id, { jpegBase64: jpeg.toString('base64') });
      },
    },
    {
      method: 'POST', path: '/v1/admin/demo/photos', summary: 'Add a stripped JPEG example as a private draft', auth: 'admin', body: Schemas.DemoCreate,
      handler: async (req) => {
        const claims = await admin(req, 'demo.create');
        if (!demoStudio) throw new ApiError(503, 'DEMO_NOT_CONFIGURED', 'Photo storage is not set up on this server.');
        const { jpegBase64, ...fields } = parseJson(Schemas.DemoCreate, req.rawBody);
        const photo = await demoStudio.create(Buffer.from(jpegBase64, 'base64'), fields, now());
        return adminDone(claims, 'demo.create', photo.id, { photo: { id: photo.id, revision: photo.revision } });
      },
    },
    {
      method: 'POST', path: '/v1/admin/demo/photos/:id/save', summary: 'Save draft subject, metadata, exact editor recipe and crop; not public until approved', auth: 'admin', body: Schemas.DemoSave,
      handler: async (req, params) => {
        const claims = await admin(req, 'demo.save');
        if (!demoStudio) throw new ApiError(503, 'DEMO_NOT_CONFIGURED', 'Photo storage is not set up on this server.');
        const { revision, ...changes } = parseJson(Schemas.DemoSave, req.rawBody);
        const photo = await demoStudio.save(params.id, revision, changes as unknown as ExampleFields, now());
        return adminDone(claims, 'demo.save', photo.id + ' revision=' + photo.revision, { revision: photo.revision });
      },
    },
    {
      method: 'POST', path: '/v1/admin/demo/photos/:id/publish', summary: 'Explicitly publish or unpublish a photo snapshot', auth: 'admin', body: Schemas.DemoPublish,
      handler: async (req, params) => {
        const claims = await admin(req, 'demo.publish');
        if (!demoStudio) throw new ApiError(503, 'DEMO_NOT_CONFIGURED', 'Photo storage is not set up on this server.');
        const { revision, published } = parseJson(Schemas.DemoPublish, req.rawBody);
        const photo = await demoStudio.publish(params.id, revision, published, now());
        return adminDone(claims, 'demo.publish', photo.id + ' published=' + published, { published: photo.published, revision: photo.revision });
      },
    },
    {
      method: 'POST', path: '/v1/admin/demo/photos/:id/delete', summary: 'Delete a draft and revoke its publication', auth: 'admin', body: Schemas.DemoRevision,
      handler: async (req, params) => {
        const claims = await admin(req, 'demo.delete');
        if (!demoStudio) throw new ApiError(503, 'DEMO_NOT_CONFIGURED', 'Photo storage is not set up on this server.');
        const { revision } = parseJson(Schemas.DemoRevision, req.rawBody);
        await demoStudio.remove(params.id, revision);
        return adminDone(claims, 'demo.delete', params.id, { deleted: true });
      },
    },

    // ---- Identity & licensing
    {
      method: 'POST', path: '/v1/auth/session', summary: 'Sign in; returns a 15-minute access token and a refresh token', auth: 'none',
      body: Schemas.SessionRequest, response: Schemas.SessionResponse,
      handler: async (req) => {
        if (!authLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
        const body = parseJson(Schemas.SessionRequest, req.rawBody);
        const account = await store.findAccountByEmailHash(sha256Hex(body.email.trim().toLowerCase()));
        if (!account || account.status !== 'active' || !verifyPassword(body.password, account.passwordHash)) {
          throw new ApiError(401, 'AUTH_FAILED', 'That email and password did not match.');
        }
        return { status: 200, body: await issueSession(account.accountId, account.role === 'admin' ? 'admin' : 'user') };
      },
    },
    {
      method: 'POST', path: '/v1/auth/refresh', summary: 'Exchange a refresh token (single use) for a new session', auth: 'none',
      body: Schemas.RefreshRequest, response: Schemas.SessionResponse,
      handler: async (req) => {
        const body = parseJson(Schemas.RefreshRequest, req.rawBody);
        const accountId = await store.consumeRefreshToken(sha256Hex(body.refreshToken), now());
        if (!accountId) throw new ApiError(401, 'AUTH_TOKEN_EXPIRED', 'Your session has ended. Sign in again.');
        const account = await store.getAccount(accountId);
        if (!account || account.status !== 'active') throw new ApiError(401, 'AUTH_TOKEN_INVALID', 'Sign in to use this.');
        return { status: 200, body: await issueSession(accountId, account.role === 'admin' ? 'admin' : 'user') };
      },
    },
    {
      method: 'POST', path: '/v1/licences/activate', summary: 'Activate a signed KESTREL1 licence key on a device; returns an Ed25519-signed offline grant', auth: 'none',
      body: Schemas.ActivateRequest, response: Schemas.ActivateResponse,
      handler: async (req) => {
        if (!activateLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
        const body = parseJson(Schemas.ActivateRequest, req.rawBody);
        const check = await verifyLicence(body.licenceKey, config.licencePublicKey);
        if (!check.ok) throw new ApiError(400, 'LICENCE_INVALID', 'That licence key was not recognised.');
        const t = now();
        const outcome = await store.activateDevice({
          licenceId: check.details.id, planIfNew: check.details.plan, deviceHash: body.deviceHash, platform: body.platform,
          appVersion: body.appVersion, newActivationId: `act_${randomId(12)}`, nowMs: t,
        });
        if (!outcome.ok && outcome.reason === 'not_active') throw new ApiError(403, 'LICENCE_NOT_ACTIVE', 'This licence is no longer active. Your local work is unaffected.');
        if (!outcome.ok) throw new ApiError(409, 'DEVICE_LIMIT', `This licence is already active on ${outcome.maxDevices} devices. Deactivate one first.`);
        const { activationId, licence } = outcome;
        const grant: EntitlementGrant = {
          schema: 1, grantId: `grt_${randomId(12)}`, plan: licence.plan as EntitlementGrant['plan'], managedAi: licence.managedAi,
          deviceHash: body.deviceHash, issuedAtMs: t, offlineUntilMs: offlineDeadline(licence, t),
          ...(await grantFlagsFor({ plan: licence.plan === 'free' ? 'basic' : 'pro' }, body.deviceHash, body.appVersion, t)),
        };
        return { status: 200, body: { grant: signEnvelope(grant, config.signingKey), activationId } };
      },
    },
    {
      method: 'POST', path: '/v1/me/activate', summary: 'Signed in: activate this device with the account\'s paid licence; returns an Ed25519-signed offline grant. Signing in alone grants nothing.', auth: 'user',
      body: Schemas.AccountActivateRequest, response: Schemas.ActivateResponse,
      handler: async (req) => {
        const claims = await bearer(req);
        if (!activateLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
        const body = parseJson(Schemas.AccountActivateRequest, req.rawBody);
        const t = now();
        const usable = (await store.listLicencesForAccount(claims.sub)).filter((l) => licenceIsUsable(l, t) && l.plan !== 'free');
        const licence = usable.sort((a, b) => Number(b.paid) - Number(a.paid) || b.majorVersion - a.majorVersion)[0];
        if (!licence) throw new ApiError(403, 'NO_LICENCE', 'This account has no Pro licence yet. Your local work is unaffected.');
        const outcome = await store.activateDevice({
          licenceId: licence.licenceId, planIfNew: licence.plan, deviceHash: body.deviceHash, platform: body.platform,
          appVersion: body.appVersion, newActivationId: `act_${randomId(12)}`, nowMs: t,
        });
        if (!outcome.ok && outcome.reason === 'not_active') throw new ApiError(403, 'LICENCE_NOT_ACTIVE', 'This licence is no longer active. Your local work is unaffected.');
        if (!outcome.ok) throw new ApiError(409, 'DEVICE_LIMIT', `This licence is already active on ${outcome.maxDevices} devices. Deactivate one first.`);
        const grant: EntitlementGrant = {
          schema: 1, grantId: `grt_${randomId(12)}`, plan: outcome.licence.plan as EntitlementGrant['plan'], managedAi: outcome.licence.managedAi,
          deviceHash: body.deviceHash, issuedAtMs: t, offlineUntilMs: offlineDeadline(outcome.licence, t),
          ...(await grantFlagsFor({ plan: outcome.licence.plan === 'free' ? 'basic' : 'pro', user: (await store.getAccount(claims.sub))?.emailHash }, body.deviceHash, body.appVersion, t)),
        };
        await audit(claims.sub, 'device.activate.account', 'allowed', outcome.activationId);
        return { status: 200, body: { grant: signEnvelope(grant, config.signingKey), activationId: outcome.activationId } };
      },
    },
    {
      method: 'POST', path: '/v1/licences/status', summary: 'For whoever holds the key: is it active, and on which devices', auth: 'none',
      body: Schemas.LicenceStatusRequest, response: Schemas.LicenceStatusResponse,
      handler: async (req) => {
        if (!activateLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
        const body = parseJson(Schemas.LicenceStatusRequest, req.rawBody);
        const check = await verifyLicence(body.licenceKey, config.licencePublicKey);
        if (!check.ok) throw new ApiError(400, 'LICENCE_INVALID', 'That licence key was not recognised.');
        const licence = await store.getLicence(check.details.id);
        if (!licence) return { status: 200, body: { status: 'unknown', validUntilMs: null, maxDevices: 3, devices: [] } };
        const devices = await store.listActivationsForLicence(licence.licenceId);
        const status = licence.status === 'revoked' ? 'revoked' : licenceIsUsable(licence, now()) ? 'active' : 'expired';
        return {
          status: 200, body: {
            status, validUntilMs: licence.validUntilMs, maxDevices: licence.maxDevices,
            devices: devices.map((d) => ({ activationId: d.activationId, platform: d.platform, appVersion: d.appVersion, lastSeenMs: d.lastSeenMs, thisDevice: d.deviceHash === body.deviceHash })),
          },
        };
      },
    },
    {
      method: 'POST', path: '/v1/licences/deactivate', summary: 'For whoever holds the key: free one of its device slots', auth: 'none', body: Schemas.DeactivateRequest,
      handler: async (req) => {
        if (!activateLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
        const body = parseJson(Schemas.DeactivateRequest, req.rawBody);
        const check = await verifyLicence(body.licenceKey, config.licencePublicKey);
        if (!check.ok) throw new ApiError(400, 'LICENCE_INVALID', 'That licence key was not recognised.');
        const devices = await store.listActivationsForLicence(check.details.id);
        if (!devices.some((d) => d.activationId === body.activationId) || !(await store.deactivateDevice(body.activationId))) {
          throw new ApiError(404, 'NOT_FOUND', 'That device is not using this licence.');
        }
        await audit(`licence:${check.details.id}`, 'device.deactivate.self', 'allowed', body.activationId);
        return { status: 200, body: { deactivated: true } };
      },
    },
    {
      method: 'GET', path: '/v1/me/entitlements', summary: 'Plans, AI allowance and when to check again', auth: 'user', response: Schemas.EntitlementsResponse,
      handler: async (req) => {
        const claims = await bearer(req);
        const plans = await store.listLicencesForAccount(claims.sub);
        const quota = await store.getQuota(claims.sub);
        const account = await store.getAccount(claims.sub);
        return {
          status: 200, body: {
            plans: plans.map((p) => ({ licenceId: p.licenceId, plan: p.plan, status: p.status, managedAi: p.managedAi, offlineGraceDays: p.offlineGraceDays, majorVersion: p.majorVersion, paid: p.paid, source: p.source })),
            aiQuota: quota ? { requestsUsed: quota.requestsUsed, requestsLimit: quota.requestsLimit, periodEndsMs: quota.periodStartMs + QUOTA_PERIOD_MS } : null,
            aiConsent: account?.aiConsent ?? false,
            nextRevalidationMs: now() + 7 * DAY_MS,
          },
        };
      },
    },
    {
      method: 'POST', path: '/v1/me/ai-consent', summary: 'Set or withdraw the standing "use Gemini" preference for this account', auth: 'user',
      body: Schemas.AiConsentRequest, response: z.object({ aiConsent: z.boolean() }),
      handler: async (req) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.AiConsentRequest, req.rawBody);
        await store.setAiConsent(claims.sub, body.consent);
        await audit(claims.sub, 'ai.consent.set', 'allowed', body.consent ? 'granted' : 'withdrawn');
        return { status: 200, body: { aiConsent: body.consent } };
      },
    },

    // ---- Managed AI gateway
    {
      method: 'POST', path: '/v1/ai/identify', summary: 'Identify the subject of one consented, metadata-free thumbnail', auth: 'user',
      body: Schemas.ImageRequest, response: Schemas.IdentifyResponse,
      handler: async (req) => {
        const answer = await aiCall(req, (p, image) => identify(p, image, config.aiTimeoutMs));
        return { status: 200, body: { ...answer, abstained: answer.species === null } };
      },
    },
    {
      method: 'POST', path: '/v1/ai/suggest', summary: 'Bounded slider proposals for one consented thumbnail. Never pixels.', auth: 'user',
      body: Schemas.ImageRequest, response: Schemas.SuggestResponse,
      handler: async (req) => {
        const proposal = await aiCall(req, (p, image) => suggest(p, image, config.aiTimeoutMs));
        return { status: 200, body: { proposal, alreadyBalanced: Object.keys(proposal).length === 0 } };
      },
    },
    {
      method: 'POST', path: '/v1/ai/verify-colour',
      summary: 'A plain-English second opinion on the colour grade of one consented, already-edited thumbnail. Complements, never overrides, the on-device measured check.',
      auth: 'user', body: Schemas.ImageRequest, response: Schemas.VerifyColourResponse,
      handler: async (req) => {
        const answer = await aiCall(req, (p, image) => verifyColour(p, image, config.aiTimeoutMs));
        return { status: 200, body: answer };
      },
    },

    // ---- Cloud Processing (Pro, consented, quota'd, kill-switched on every request)
    {
      method: 'POST', path: '/v1/cloud/jobs', summary: 'Start a cloud processing job: returns a short-lived signed upload URL', auth: 'user', body: Schemas.CloudJobRequest,
      handler: (req) => cloudJobStart(req),
    },
    {
      method: 'GET', path: '/v1/cloud/jobs/:id', summary: 'Status of one of your cloud processing jobs; a signed result URL once ready', auth: 'user',
      handler: async (req, params) => {
        const { cloud, record } = await cloudJobOwned(req, params.id!);
        let status = record.status;
        let resultUrl: string | undefined;
        if (record.status === 'running') {
          let p = await cloud.runner.poll(record.jobId);
          // Watchdog: a crashed runner writes no marker, so without this the job (and its spend) would stay 'running' forever.
          if (p.state === 'running' && now() - record.createdAtMs > (cloud.maxJobMs ?? DEFAULT_MAX_JOB_MS)) p = { state: 'failed' };
          if (p.state !== 'running') {
            // The job has ended: the input goes now, not at finish or at the lifecycle backstop.
            await cloud.runner.deleteInput(record.jobId);
            const changed = p.state === 'failed'
              ? await settleFailedCloudJob(cloud, record)
              : await cloud.ledger.transition(record.jobId, 'running', p.state);
            if (changed) {
              await audit(record.accountId, 'cloud.job.end', 'allowed', `${record.jobId} ${p.state}`);
            }
            status = (await cloud.ledger.get(record.jobId))?.status ?? 'finished';
          }
          if (status === 'ready' && p.state === 'ready') resultUrl = p.resultUrl;
        } else if (record.status === 'ready') {
          const p = await cloud.runner.poll(record.jobId);
          status = (await cloud.ledger.get(record.jobId))?.status ?? 'finished';
          if (status === 'ready' && p.state === 'ready') resultUrl = p.resultUrl;
        }
        return { status: 200, body: { jobId: record.jobId, status, kind: record.kind, ...(resultUrl ? { resultUrl } : {}), ...(status === 'failed' ? { failure: 'CLOUD_JOB_FAILED' } : {}) } };
      },
    },
    {
      method: 'POST', path: '/v1/cloud/jobs/:id/start', summary: 'Start processing once the upload has arrived (idempotent). Re-checks the kill switch and Pro', auth: 'user',
      handler: async (req, params) => {
        const { record } = await cloudJobOwned(req, params.id!);
        const cloud = await cloudGate(record.accountId);
        if (record.status !== 'awaiting-upload') return { status: 200, body: { jobId: record.jobId, status: record.status } };
        if (!(await cloud.runner.inputPresent(record.jobId))) throw new ApiError(409, 'CLOUD_INPUT_MISSING', 'The upload has not arrived yet.', true);
        if (!(await cloud.ledger.transition(record.jobId, 'awaiting-upload', 'running'))) {
          const current = await cloud.ledger.get(record.jobId);
          return { status: 200, body: { jobId: record.jobId, status: current?.status ?? 'finished' } };
        }
        // Cloud Run can accept a dispatch even if its response is lost. Keep the claim so a retry cannot send it again.
        try {
          await cloud.runner.start(record.jobId, record.kind);
        } catch {
          throw new ApiError(502, 'CLOUD_RUNNER_FAILED', 'Cloud processing could not be confirmed.', true);
        }
        return { status: 200, body: { jobId: record.jobId, status: 'running' } };
      },
    },
    {
      method: 'POST', path: '/v1/cloud/jobs/:id/finish', summary: 'Result collected or job cancelled: deletes the input and the result now (idempotent)', auth: 'user',
      handler: async (req, params) => {
        const { cloud, record } = await cloudJobOwned(req, params.id!);
        await cloud.ledger.put({ ...record, status: 'finished' });
        await cloud.runner.deleteInput(record.jobId);
        await cloud.runner.deleteResult(record.jobId);
        return { status: 200, body: { jobId: record.jobId, inputDeleted: true } };
      },
    },

    // ---- Opt-in learning signal (separate consent, deleted on withdrawal)
    {
      method: 'GET', path: '/v1/me/learning-consent', summary: 'Whether this account shares anonymous corrections to improve suggestions', auth: 'user',
      handler: async (req) => {
        const claims = await bearer(req);
        return { status: 200, body: { learningConsent: options.learning ? await options.learning.getConsent(learningSubject(claims.sub)) : false } };
      },
    },
    {
      method: 'POST', path: '/v1/me/learning-consent', summary: 'Opt in or out. Opting out deletes everything shared so far', auth: 'user', body: Schemas.AiConsentRequest,
      handler: async (req) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.AiConsentRequest, req.rawBody);
        const sink = options.learning;
        if (!sink) throw new ApiError(503, 'LEARNING_NOT_CONFIGURED', 'Sharing corrections is not set up on this server.');
        // Opting in needs the switch on; opting OUT (and the deletion that goes with it) always works.
        if (body.consent && !(await switchOn('learning-signal'))) throw new ApiError(503, 'LEARNING_DISABLED', 'Sharing corrections is switched off for now.', true);
        const subject = learningSubject(claims.sub);
        await sink.setConsent(subject, body.consent);
        const deleted = body.consent ? 0 : await sink.deleteBySubject(subject);
        await audit(claims.sub, 'learning.consent.set', 'allowed', body.consent ? 'granted' : `withdrawn deleted=${deleted}`);
        return { status: 200, body: { learningConsent: body.consent, deleted } };
      },
    },
    {
      method: 'POST', path: '/v1/learning/signals', summary: 'Legacy learning intake retired: a project/photo scope is mandatory for research contributions', auth: 'user', body: Schemas.LearningSignal,
      handler: async (req) => {
        await bearer(req);
        // Legacy requests do not identify the user's project or photo. Account
        // consent alone is NOT permission to share a private family album.
        // Fail closed for ALL callers, including those opted into research.
        // A replacement must authenticate the project/photo scope and enforce
        // server-side permissions before storing any contribution.
        parseJson(Schemas.LearningSignal, req.rawBody);
        throw new ApiError(410, 'LEARNING_SCOPE_REQUIRED',
          'This older sharing method is disabled to protect private albums. Update InFlight to share only from approved projects.');
      },
    },

    // ---- Managed safe copy (opt-in, per level, UK only; never the default)
    {
      method: 'GET', path: '/v1/me/safe-copy', summary: 'Which levels of safe copy are on (all off by default)', auth: 'user',
      handler: async (req) => { const claims = await bearer(req); return { status: 200, body: { levels: await safeCopyCfg().catalog.getSettings(claims.sub) } }; },
    },
    {
      method: 'POST', path: '/v1/me/safe-copy', summary: 'Turn a level of safe copy on or off. Originals is its own switch', auth: 'user', body: Schemas.SafeCopyLevels,
      handler: async (req) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.SafeCopyLevels, req.rawBody);
        const levels = await safeCopyCfg().catalog.setSettings(claims.sub, body.levels);
        await audit(claims.sub, 'safecopy.settings', 'allowed', JSON.stringify(levels));
        return { status: 200, body: { levels } };
      },
    },
    {
      method: 'POST', path: '/v1/safe-copy/upload-url', summary: 'A short-lived signed upload URL for one content-addressed object, if the level is on, the plan allows it and quota remains', auth: 'user', body: Schemas.SafeCopyUpload,
      handler: async (req) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.SafeCopyUpload, req.rawBody);
        if (body.bytes > SAFE_COPY_MAX_BYTES[body.level]) throw new ApiError(413, 'SAFE_COPY_TOO_LARGE', `A ${body.level} file can be at most ${SAFE_COPY_MAX_BYTES[body.level]} bytes.`);
        const sc = await safeCopyUploadGate(claims.sub, body.level);
        const outcome = await sc.catalog.reserve(claims.sub, body.level, body.sha256, body.bytes, sc.bytesQuota);
        if (outcome === 'quota') throw new ApiError(429, 'SAFE_COPY_QUOTA_EXHAUSTED', 'Your safe copy is full. Uploads pause; downloads and local work continue and nothing is deleted.');
        if (outcome === 'stored') return { status: 200, body: { alreadyStored: true } };
        const key = safeCopyKey(claims.sub, body.level, body.sha256);
        return { status: 200, body: { alreadyStored: false, uploadUrl: await sc.storage.signUpload(key, body.bytes, body.sha256) } };
      },
    },
    {
      method: 'POST', path: '/v1/safe-copy/commit', summary: 'Mark an uploaded object as stored (counts once)', auth: 'user', body: Schemas.SafeCopyObject,
      handler: async (req) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.SafeCopyObject, req.rawBody);
        if (!(await safeCopyCfg().catalog.commit(claims.sub, body.level, body.sha256))) throw new ApiError(404, 'NOT_FOUND', 'No such upload.');
        return { status: 200, body: { stored: true } };
      },
    },
    {
      method: 'POST', path: '/v1/safe-copy/download-url', summary: 'A short-lived signed download URL for your own object. Never gated by plan or kill switch', auth: 'user', body: Schemas.SafeCopyObject,
      handler: async (req) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.SafeCopyObject, req.rawBody);
        const sc = safeCopyCfg();
        const item = await sc.catalog.get(claims.sub, body.level, body.sha256);
        if (!item?.committed) throw new ApiError(404, 'NOT_FOUND', 'No such object.'); // someone else's is indistinguishable from missing
        return { status: 200, body: { downloadUrl: await sc.storage.signDownload(safeCopyKey(claims.sub, body.level, body.sha256)) } };
      },
    },
    {
      method: 'POST', path: '/v1/safe-copy/delete', summary: 'Delete one of your own objects now (idempotent)', auth: 'user', body: Schemas.SafeCopyObject,
      handler: async (req) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.SafeCopyObject, req.rawBody);
        const sc = safeCopyCfg();
        await sc.storage.delete(safeCopyKey(claims.sub, body.level, body.sha256));
        await sc.catalog.remove(claims.sub, body.level, body.sha256);
        return { status: 200, body: { deleted: true } };
      },
    },
    {
      method: 'GET', path: '/v1/safe-copy/usage', summary: 'Bytes used and the allowance', auth: 'user',
      handler: async (req) => { const claims = await bearer(req); const sc = safeCopyCfg(); return { status: 200, body: { bytesUsed: await sc.catalog.usage(claims.sub), bytesQuota: sc.bytesQuota } }; },
    },

    // ---- Model & release registry
    {
      method: 'GET', path: '/v1/models/manifest', summary: 'Signed data manifest (models, species libraries) for an app version', auth: 'none', response: Schemas.ManifestResponse,
      handler: async (req) => {
        const app = req.query.get('app') ?? '0.0.0';
        const channel = req.query.get('channel') ?? 'stable';
        if (!Version.safeParse(app).success || (channel !== 'stable' && channel !== 'beta')) throw new ApiError(400, 'VALIDATION_FAILED', 'Give app as x.y.z and channel as stable or beta.');
        return { status: 200, body: signEnvelope(await currentManifest(app, channel), config.signingKey), headers: { 'cache-control': 'public, max-age=3600' } };
      },
    },
    {
      method: 'GET', path: '/v1/flags/public', summary: 'Signed feature flags for people without an account: no named users or organisations', auth: 'none', response: Schemas.ManifestResponse,
      handler: async () => ({ status: 200, body: signEnvelope({ schema: 1, flags: forPublicDocument(await loadFlags()) }, config.signingKey), headers: { 'cache-control': 'public, max-age=3600' } }),
    },
    {
      method: 'GET', path: '/v1/admin/flags', summary: 'Read every feature flag. Named-user rules show a hash of the email, never the address', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'flags.read');
        return adminDone(claims, 'flags.read', '', { flags: await loadFlags() });
      },
    },
    {
      method: 'POST', path: '/v1/admin/flags/set', summary: 'Create or replace one feature flag. A rule for a named user may give the email: it is stored as a hash', auth: 'admin', body: Schemas.AdminFlagSet,
      handler: async (req) => {
        const claims = await admin(req, 'flags.set');
        const body = parseJson(Schemas.AdminFlagSet, req.rawBody);
        const rules = body.flag.rules.map((rule) => {
          const r = rule as { audience?: { kind?: unknown; email?: unknown } };
          if (r?.audience?.kind === 'user' && typeof r.audience.email === 'string' && r.audience.email.includes('@')) {
            return { ...(rule as object), audience: { kind: 'user', email: emailHashOf(r.audience.email) } };
          }
          return rule;
        });
        const parsed = parseFlagSet({ [body.key]: { ...body.flag, rules } })[body.key];
        if (!parsed || parsed.rules.length !== rules.length) throw new ApiError(400, 'VALIDATION_FAILED', 'One of the rules is not valid. Nothing was changed.');
        const flags = { ...(await loadFlags()), [body.key]: parsed };
        if (Object.keys(flags).length > MAX_GRANT_FLAGS) throw new ApiError(400, 'VALIDATION_FAILED', `At most ${MAX_GRANT_FLAGS} flags.`);
        await store.setSetting(FLAGS_SETTING, JSON.stringify(flags));
        return adminDone(claims, 'flags.set', `${body.key} rules=${parsed.rules.length} kill=${parsed.kill === true}`, { key: body.key, flag: parsed });
      },
    },
    {
      method: 'POST', path: '/v1/admin/flags/delete', summary: 'Remove one feature flag (the app falls back to its compiled default)', auth: 'admin', body: Schemas.AdminFlagDelete,
      handler: async (req) => {
        const claims = await admin(req, 'flags.delete');
        const body = parseJson(Schemas.AdminFlagDelete, req.rawBody);
        const flags = { ...(await loadFlags()) };
        const existed = Object.hasOwn(flags, body.key);
        delete flags[body.key];
        await store.setSetting(FLAGS_SETTING, JSON.stringify(flags));
        return adminDone(claims, 'flags.delete', body.key, { key: body.key, existed });
      },
    },
    {
      method: 'GET', path: '/v1/desktop/releases', summary: 'Latest published desktop release, for a notice only (never an auto-update)', auth: 'none', response: Schemas.ReleaseResponse,
      handler: async (req) => {
        const platform = req.query.get('platform'), channel = req.query.get('channel') ?? 'stable';
        if ((platform !== 'windows' && platform !== 'macos') || (channel !== 'stable' && channel !== 'beta')) throw new ApiError(400, 'VALIDATION_FAILED', 'Give platform as windows or macos.');
        const rows = await store.listReleases(platform, channel);
        const latest = rows.reduce<typeof rows[number] | null>((best, row) => (!best || newerRelease(row.version, best.version) ? row : best), null);
        return {
          status: 200, headers: { 'cache-control': 'public, max-age=900' },
          body: { release: latest ? { version: latest.version, url: latest.url, notes: latest.notes, minSupported: latest.minSupported, publishedAt: new Date(latest.publishedAtMs).toISOString() } : null },
        };
      },
    },

    // ---- Billing
    providerRoute('google'),
    providerRoute('apple'),
    providerRoute('firebase'),
    {
      method: 'POST', path: '/v1/billing/sumup', summary: 'Verify a SumUp checkout status notification against SumUp', auth: 'none',
      body: SumupNotification,
      handler: async (req) => {
        if (!options.settleSumupPro) throw new ApiError(503, 'SUMUP_NOT_CONFIGURED', 'SumUp payments are not set up.');
        const event = parseJson(SumupNotification, req.rawBody);
        if (event.event_type === 'CHECKOUT_STATUS_CHANGED') {
          if (!sumupLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Retry this notification shortly.', true);
          try { await options.settleSumupPro(event.id); }
          catch { throw new ApiError(503, 'SUMUP_VERIFICATION_PENDING', 'The payment verification will be retried.', true); }
        }
        return { status: 204, body: null };
      },
    },
    {
      method: 'POST', path: '/v1/billing/webhook', summary: 'Signed, idempotent billing events', auth: 'webhook', body: Schemas.WebhookEvent,
      handler: async (req) => {
        const signature = req.headers['kestrel-signature'];
        if (!verifyWebhook(req.rawBody, typeof signature === 'string' ? signature : undefined, config.webhookSecret, now())) {
          throw new ApiError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Webhook signature missing, wrong or outside the replay window.');
        }
        const event = parseJson(Schemas.WebhookEvent, req.rawBody);
        if ((await store.applyBillingEvent(event, now())) === 'replayed') throw new ApiError(409, 'WEBHOOK_REPLAYED', 'This event was already processed.');
        return { status: 200, body: { received: true } };
      },
    },

    // ---- Admin (every call, allowed or denied, is audited)
    {
      method: 'GET', path: '/v1/admin/tax', summary: 'Read UK VAT settings and rolling turnover', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'tax.read');
        if (!commerce) throw new ApiError(503, 'TAX_STORE_UNAVAILABLE', 'Tax reporting needs the Firestore commerce ledger.');
        const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/London' }).format(now());
        const [settings, turnover] = await Promise.all([commerce.getTaxSettings(), commerce.recordTurnover(today)]);
        return adminDone(claims, 'tax.read', '', {
          settings, turnover, thresholdPence: UK_VAT_THRESHOLD_PENCE, warningPence: UK_VAT_WARNING_PENCE,
        });
      },
    },
    {
      method: 'POST', path: '/v1/admin/tax/settings', summary: 'Save UK VAT and local tax settings', auth: 'admin', body: AdminTaxSettings,
      handler: async (req) => {
        const claims = await admin(req, 'tax.settings');
        if (!commerce) throw new ApiError(503, 'TAX_STORE_UNAVAILABLE', 'Tax settings need the Firestore commerce ledger.');
        const body = parseJson(AdminTaxSettings, req.rawBody);
        await commerce.updateTaxSettings(body, claims.sub);
        return adminDone(claims, 'tax.settings', 'ukVatRegistered=' + body.ukVatRegistered, { saved: true });
      },
    },
    {
      method: 'GET', path: '/v1/admin/pricing/review', summary: 'Read the latest scheduled price proposal', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'pricing.review.read');
        if (!options.pricing) throw new ApiError(503, 'PRICING_REVIEW_UNAVAILABLE', 'Price reviews need the Firestore commerce ledger.');
        return adminDone(claims, 'pricing.review.read', '', { review: await options.pricing.latestPriceReview() });
      },
    },
    {
      method: 'GET', path: '/v1/admin/tax/oss', summary: 'Export a quarterly Non-Union OSS summary in GBP pence', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'tax.oss');
        if (!commerce) throw new ApiError(503, 'TAX_STORE_UNAVAILABLE', 'Tax reporting needs the Firestore commerce ledger.');
        const year = Number(req.query.get('year'));
        const quarter = Number(req.query.get('quarter'));
        if (!Number.isInteger(year) || year < 2020 || year > 9998 || ![1, 2, 3, 4].includes(quarter)) {
          throw new ApiError(400, 'BAD_QUARTER', 'Choose a valid year and quarter.');
        }
        return adminDone(claims, 'tax.oss', year + '-Q' + quarter, { year, quarter, rows: await commerce.ossQuarter(year, quarter) });
      },
    },
    {
      method: 'GET', path: '/v1/admin/config', summary: 'How the admin console signs in (public; no data)', auth: 'none',
      handler: () => ({ status: 200, body: { googleClientId: config.googleClientId ?? null, passwordSignIn: !config.googleClientId } }),
    },
    {
      method: 'POST', path: '/v1/admin/session/google', summary: 'Exchange a Google ID token from an allow-listed account for a 15-minute admin session', auth: 'none',
      body: Schemas.AdminGoogleSession,
      handler: async (req) => {
        if (!authLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
        const body = parseJson(Schemas.AdminGoogleSession, req.rawBody);
        if (!config.googleClientId || adminEmailHashes.size === 0) {
          await audit('anonymous', 'admin.signin', 'denied', 'Google sign-in not configured');
          throw new ApiError(503, 'GOOGLE_SIGNIN_UNAVAILABLE', 'Google sign-in is not set up on this server.');
        }
        const check = await verifyGoogleIdToken(body.credential, config.googleClientId, googleKeys, now());
        if (!check.ok) {
          await audit('anonymous', 'admin.signin', 'denied', `google token ${check.reason}`);
          if (check.reason === 'keys_unavailable') throw new ApiError(503, 'GOOGLE_UNAVAILABLE', 'Google could not be reached to check the sign-in. Try again in a minute.', true);
          throw new ApiError(401, 'AUTH_FAILED', 'That Google sign-in could not be checked. Sign in again.');
        }
        const emailHash = sha256Hex(check.email);
        if (!adminEmailHashes.has(emailHash)) {
          await audit('anonymous', 'admin.signin', 'denied', `not on the allow-list (${emailHash.slice(0, 12)})`);
          throw new ApiError(403, 'FORBIDDEN', 'This Google account is not allowed to use the admin console.');
        }
        let account = await store.findAccountByEmailHash(emailHash);
        if (!account) {
          // No password: this account can only sign in with Google.
          await store.createAccount({ accountId: `acc_${randomId(12)}`, emailHash, passwordHash: 'google-only', role: 'admin', status: 'active', createdAtMs: now(), aiConsent: false });
          account = await store.findAccountByEmailHash(emailHash);
        } else if (account.role !== 'admin') {
          await store.setAccountRole(account.accountId, 'admin');
        }
        if (!account || account.status !== 'active') throw new ApiError(403, 'FORBIDDEN', 'This account is suspended.');
        await audit(account.accountId, 'admin.signin', 'allowed', 'google');
        // Access token only: when it ends, the page asks Google again, so removing an email from the allow-list takes effect within 15 minutes.
        return { status: 200, body: { accessToken: signSession(account.accountId, 'admin', config.sessionSecret, now()), expiresIn: 900 } };
      },
    },
    {
      method: 'POST', path: '/v1/contact', summary: 'A message from the website contact form (stored only with consent)', auth: 'none', body: Schemas.ContactRequest,
      handler: async (req) => {
        // Behind Firebase Hosting every request reaches us from Google's front end, so the forwarded-for chain is the
        // best per-sender key there is. It can be forged, which is why the global cap below is the real limit.
        const forwarded = req.headers['x-forwarded-for'];
        const sender = (typeof forwarded === 'string' ? forwarded : req.ip).slice(0, 200);
        if (!contactLimiter.take(sender, now()) || !contactGlobalLimiter.take('all', now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many messages just now. Please try again later.', true);
        const body = parseJson(Schemas.ContactRequest, req.rawBody);
        // A filled-in hidden field means a robot: answer as if it worked, store nothing.
        if (body.website) return { status: 200, body: { received: true } };
        await store.insertContactMessage({ messageId: `msg_${randomId(12)}`, receivedAtMs: now(), name: body.name, email: body.email, message: body.message, status: 'new' });
        return { status: 200, body: { received: true } };
      },
    },
    {
      method: 'GET', path: '/v1/admin/licensees', summary: 'Licences, their devices and each account\'s AI allowance', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'licensees.read');
        const [licences, activations, quotas] = await Promise.all([store.listLicences(500), store.listActivations(2000), store.listQuotas(500)]);
        const devices = new Map<string, typeof activations>();
        for (const a of activations) devices.set(a.licenceId, [...(devices.get(a.licenceId) ?? []), a]);
        const quotaFor = new Map(quotas.map((q) => [q.accountId, q]));
        return adminDone(claims, 'licensees.read', `${licences.length} licences`, {
          licences: licences.map((l) => ({
            ...l,
            devices: (devices.get(l.licenceId) ?? []).map((d) => ({ activationId: d.activationId, platform: d.platform, appVersion: d.appVersion, lastSeenMs: d.lastSeenMs, deviceHashPrefix: d.deviceHash.slice(0, 12) })),
            aiQuota: l.accountId && quotaFor.get(l.accountId) ? { requestsUsed: quotaFor.get(l.accountId)!.requestsUsed, requestsLimit: quotaFor.get(l.accountId)!.requestsLimit, periodEndsMs: quotaFor.get(l.accountId)!.periodStartMs + QUOTA_PERIOD_MS } : null,
          })),
        });
      },
    },
    {
      method: 'POST', path: '/v1/admin/devices/:id/deactivate', summary: 'Free a device\'s slot on its licence (the device keeps working offline until its grant lapses)', auth: 'admin',
      handler: async (req, params) => {
        const claims = await admin(req, 'device.deactivate');
        if (!(await store.deactivateDevice(params.id))) throw new ApiError(404, 'NOT_FOUND', 'No such device.');
        return adminDone(claims, 'device.deactivate', params.id, { deactivated: true });
      },
    },
    {
      method: 'GET', path: '/v1/admin/usage', summary: 'AI allowance used per account in the current period', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'usage.read');
        const quotas = await store.listQuotas(500);
        return adminDone(claims, 'usage.read', '', {
          aiDisabled: (await store.getSetting('ai_disabled')) === '1',
          aiProvider: provider?.name ?? null,
          accounts: quotas.map((q) => ({ accountId: q.accountId, requestsUsed: q.requestsUsed, requestsLimit: q.requestsLimit, periodEndsMs: q.periodStartMs + QUOTA_PERIOD_MS })),
        });
      },
    },
    {
      method: 'GET', path: '/v1/admin/payments', summary: 'Paid checkouts (SumUp) and signed billing events received', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'payments.read');
        const [transactions, events] = await Promise.all([options.payments ? options.payments.listTransactions(200) : Promise.resolve(null), store.listBillingEvents(200)]);
        return adminDone(claims, 'payments.read', '', {
          connected: transactions !== null,
          transactions: (transactions ?? []).map((t) => ({
            checkoutReference: t.checkoutReference, invoiceNumber: t.invoiceNumber, paidAt: t.paidAt, status: t.status, country: t.country,
            currency: t.currency, totalPence: t.totalPence, netPence: t.netPence, taxPence: t.taxPence, accountId: t.accountId,
          })),
          billingEvents: events,
        });
      },
    },
    {
      method: 'GET', path: '/v1/admin/messages', summary: 'Contact form messages, newest first', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'messages.read');
        const messages = await store.listContactMessages(200);
        return adminDone(claims, 'messages.read', `${messages.length} messages`, { messages });
      },
    },
    {
      method: 'POST', path: '/v1/admin/messages/:id/status', summary: 'Mark a contact message new, read or answered', auth: 'admin', body: Schemas.AdminMessageStatus,
      handler: async (req, params) => {
        const claims = await admin(req, 'message.status');
        const body = parseJson(Schemas.AdminMessageStatus, req.rawBody);
        if (!(await store.setContactMessageStatus(params.id, body.status))) throw new ApiError(404, 'NOT_FOUND', 'No such message.');
        return adminDone(claims, 'message.status', `${params.id} ${body.status}`, { status: body.status });
      },
    },
    {
      method: 'GET', path: '/v1/admin/overview', summary: 'Counts for the admin console', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'overview');
        return adminDone(claims, 'overview', '', {
          ...(await store.counts()),
          aiDisabled: (await store.getSetting('ai_disabled')) === '1',
          aiProvider: provider?.name ?? null,
          store: store.kind,
          licenceIssuing: !!config.licencePrivateKey,
          paymentsConnected: !!options.payments,
        });
      },
    },
    {
      method: 'GET', path: '/v1/admin/switches', summary: 'On/off switches for the managed backend features', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'switches.read');
        const switches = await Promise.all(SWITCHES.map(async (w) => ({ key: w.key, label: w.label, note: w.note, on: await switchOn(w.key), configured: switchConfigured(w.key) })));
        return adminDone(claims, 'switches.read', '', { switches });
      },
    },
    {
      method: 'POST', path: '/v1/admin/switches/set', summary: 'Switch one managed backend feature on or off (audited)', auth: 'admin', body: Schemas.AdminSwitch,
      handler: async (req) => {
        const claims = await admin(req, 'switch.set');
        const body = parseJson(Schemas.AdminSwitch, req.rawBody);
        if (body.on && !switchConfigured(body.key)) throw new ApiError(409, 'SWITCH_NOT_CONFIGURED', 'That feature is not set up on this server yet, so it cannot be switched on.');
        await store.setSetting(body.key === 'managed-ai' ? 'ai_disabled' : `switch_${body.key}`, body.key === 'managed-ai' ? (body.on ? '0' : '1') : (body.on ? '1' : '0'));
        return adminDone(claims, 'switch.set', `${body.key} ${body.on ? 'on' : 'off'}`, { key: body.key, on: body.on });
      },
    },
    {
      method: 'GET', path: '/v1/admin/audit', summary: 'Most recent audit entries', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'audit.read');
        const entries = (await store.listAudit(200)).map((e) => ({ at_ms: e.atMs, actor: e.actor, action: e.action, outcome: e.outcome, detail: e.detail }));
        return adminDone(claims, 'audit.read', '', { entries });
      },
    },
    {
      method: 'POST', path: '/v1/admin/accounts', summary: 'Create an account', auth: 'admin', body: Schemas.AdminAccount,
      handler: async (req) => {
        const claims = await admin(req, 'account.create');
        const body = parseJson(Schemas.AdminAccount, req.rawBody);
        const accountId = await createAccount(body.email, body.password, body.role);
        return adminDone(claims, 'account.create', `${accountId} role=${body.role}`, { accountId });
      },
    },
    {
      method: 'POST', path: '/v1/admin/licences/grant', summary: 'Give someone a plan by email, free. No key is needed: it attaches when they sign in', auth: 'admin', body: Schemas.AdminGrant,
      handler: async (req) => {
        const claims = await admin(req, 'licence.grant');
        const body = parseJson(Schemas.AdminGrant, req.rawBody);
        const existing = await store.findAccountByEmailHash(emailHashOf(body.email));
        const record = giftEntitlement({
          email: body.email, plan: body.plan, majorVersion: body.majorVersion, managedAi: body.managedAi, note: body.note ?? null,
          validUntilMs: body.validDays ? now() + body.validDays * DAY_MS : null, accountId: existing?.accountId ?? null,
        }, now());
        const result = await store.grantLicence(record);
        // The address is never written to the audit log, only a short hash, like the admin sign-in entries.
        return adminDone(claims, 'licence.grant', `${record.licenceId} plan=${body.plan} v${body.majorVersion}${result.created ? '' : ' (already granted)'}`,
          { licenceId: record.licenceId, created: result.created, attachedNow: result.licence.accountId !== null });
      },
    },
    {
      method: 'POST', path: '/v1/admin/licences/issue', summary: 'Issue a signed KESTREL1 licence key', auth: 'admin', body: Schemas.AdminIssue,
      handler: async (req) => {
        const claims = await admin(req, 'licence.issue');
        const body = parseJson(Schemas.AdminIssue, req.rawBody);
        if (!config.licencePrivateKey) throw new ApiError(503, 'LICENCE_SIGNING_UNAVAILABLE', 'This server cannot issue licence keys.');
        if (body.accountId && !(await store.getAccount(body.accountId))) throw new ApiError(404, 'NOT_FOUND', 'No such account.');
        const id = randomId(12);
        const details = Buffer.from(JSON.stringify({ v: 1, plan: 'paid', id, issuedAt: now() }));
        const key = `KESTREL1.${details.toString('base64url')}.${crypto.sign(null, details, config.licencePrivateKey).toString('base64url')}`;
        const validUntilMs = body.validDays ? now() + body.validDays * DAY_MS : null;
        await store.insertLicence(newLicence(id, body.plan, now(), { accountId: body.accountId ?? null, managedAi: body.managedAi, maxDevices: body.maxDevices, validUntilMs, note: body.note || null }));
        return adminDone(claims, 'licence.issue', `${id} plan=${body.plan}${validUntilMs ? ` until=${new Date(validUntilMs).toISOString().slice(0, 10)}` : ''}`, { licenceId: id, licenceKey: key, validUntilMs });
      },
    },
    {
      method: 'POST', path: '/v1/admin/licences/:id/revoke', summary: 'Revoke a licence (stops new activations; never touches local work)', auth: 'admin',
      handler: async (req, params) => {
        const claims = await admin(req, 'licence.revoke');
        if (!(await store.setLicenceStatus(params.id, 'revoked', now()))) throw new ApiError(404, 'NOT_FOUND', 'No such licence.');
        return adminDone(claims, 'licence.revoke', params.id, { revoked: true });
      },
    },
    {
      method: 'POST', path: '/v1/admin/licences/revoke-by-key', summary: 'Revoke a key by pasting it, even one no device has used yet. Keeps only its licence id', auth: 'admin', body: Schemas.AdminRevokeKey,
      handler: async (req) => {
        const claims = await admin(req, 'licence.revoke');
        const body = parseJson(Schemas.AdminRevokeKey, req.rawBody);
        // The signature check keeps typos and made-up keys out of the list. The key itself is never stored or logged.
        const check = await verifyLicence(body.licenceKey, config.licencePublicKey);
        if (!check.ok) throw new ApiError(400, 'LICENCE_INVALID', 'That is not a genuine InFlight licence key, so there is nothing to revoke. Check it was copied in full.');
        const id = check.details.id;
        const existing = await store.getLicence(id);
        if (existing) await store.setLicenceStatus(id, 'revoked', now());
        else await store.insertLicence(newLicence(id, check.details.plan, now(), { status: 'revoked', note: 'Revoked before first use' }));
        return adminDone(claims, 'licence.revoke', `${id} by key${existing ? '' : ' (before first use)'}`, { licenceId: id, revoked: true, wasKnown: !!existing });
      },
    },
    {
      method: 'POST', path: '/v1/admin/licences/:id/extend', summary: 'Extend a trial or validity window', auth: 'admin', body: Schemas.AdminExtend,
      handler: async (req, params) => {
        const claims = await admin(req, 'licence.extend');
        const body = parseJson(Schemas.AdminExtend, req.rawBody);
        const until = await store.extendLicence(params.id, body.days, now());
        if (until === undefined) throw new ApiError(404, 'NOT_FOUND', 'No such licence.');
        return adminDone(claims, 'licence.extend', `${params.id} +${body.days}d`, { validUntilMs: until });
      },
    },
    {
      method: 'POST', path: '/v1/admin/ai/killswitch', summary: 'Switch the managed AI gateway off or on', auth: 'admin', body: Schemas.AdminKillSwitch,
      handler: async (req) => {
        const claims = await admin(req, 'ai.killswitch');
        const body = parseJson(Schemas.AdminKillSwitch, req.rawBody);
        await store.setSetting('ai_disabled', body.aiDisabled ? '1' : '0');
        return adminDone(claims, 'ai.killswitch', `disabled=${body.aiDisabled}`, { aiDisabled: body.aiDisabled });
      },
    },
    {
      method: 'POST', path: '/v1/admin/ai/quota', summary: 'Set an account\'s AI allowance', auth: 'admin', body: Schemas.AdminQuota,
      handler: async (req) => {
        const claims = await admin(req, 'ai.quota');
        const body = parseJson(Schemas.AdminQuota, req.rawBody);
        if (!(await store.getAccount(body.accountId))) throw new ApiError(404, 'NOT_FOUND', 'No such account.');
        await store.setQuotaLimit(body.accountId, body.requestsLimit, now());
        return adminDone(claims, 'ai.quota', `${body.accountId} limit=${body.requestsLimit}`, { requestsLimit: body.requestsLimit });
      },
    },
    {
      method: 'POST', path: '/v1/admin/models', summary: 'Register a model or data file as a candidate', auth: 'admin', body: Schemas.AdminModel,
      handler: async (req) => {
        const claims = await admin(req, 'model.register');
        const body = parseJson(Schemas.AdminModel, req.rawBody);
        // The client's own parser is the gate: anything it would reject (traversal, absolute paths, bad ids) is refused here too.
        if (!parseDataManifest({ schema: 1, revision: 1, assets: [{ id: body.id, kind: body.kind, version: body.version, path: body.path, bytes: body.bytes, sha256: body.sha256 }] })) {
          await audit(claims.sub, 'model.register', 'denied', `invalid asset ${JSON.stringify(body.id).slice(0, 80)}`);
          throw new ApiError(400, 'ASSET_INVALID', 'Asset id, version or path is not allowed (paths must be /data/..., with no ".." or absolute paths).');
        }
        const metaKey = `${body.id}@${body.version}`;
        if (body.kind === 'onnx') {
          if (!body.contract) throw new ApiError(400, 'MODEL_CONTRACT_REQUIRED', 'An ONNX model needs its contract (for example denoise-heavy/v1).');
          if (!body.licence) throw new ApiError(400, 'MODEL_LICENCE_REQUIRED', 'An ONNX model needs a licence record: SPDX id, source URL and confirmation that you have the rights to publish it.');
          if (body.licence.rightsConfirmed !== true) throw new ApiError(400, 'MODEL_LICENCE_REQUIRED', 'Confirm that you have the rights to publish this model.');
        }
        if (body.contract && !parseDataManifest({ schema: 1, revision: 1, assets: [{ id: body.id, kind: body.kind, version: body.version, path: body.path, bytes: body.bytes, sha256: body.sha256, contract: body.contract }] })) {
          throw new ApiError(400, 'ASSET_INVALID', 'The contract is not allowed (use name/v1).');
        }
        const inserted = await store.insertModelAsset({
          assetId: body.id, kind: body.kind, version: body.version, channel: body.channel, path: body.path, sha256: body.sha256,
          bytes: body.bytes, requiredAppMin: body.requiredAppMin, status: 'candidate', createdAtMs: now(),
        });
        if (!inserted) throw new ApiError(409, 'ASSET_EXISTS', 'That version is already registered. Give it a new version.');
        if (body.contract || body.licence) {
          const meta = await loadModelMeta();
          meta[metaKey] = { ...(body.contract ? { contract: body.contract } : {}), ...(body.licence ? { licence: { ...body.licence, rightsConfirmed: true as const, recordedAtMs: now() } } : {}) };
          await store.setSetting(MODEL_META_SETTING, JSON.stringify(meta));
        }
        return adminDone(claims, 'model.register', `${metaKey} ${body.channel}${body.licence ? ` licence=${body.licence.spdx}` : ''}`, { status: 'candidate' });
      },
    },
    {
      method: 'GET', path: '/v1/admin/models/licences', summary: 'The licence record and contract of every registered model version', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'model.licences');
        const meta = await loadModelMeta();
        const licences = Object.fromEntries(Object.entries(meta).filter(([, v]) => v.licence).map(([k, v]) => [k, { ...v.licence, contract: v.contract }]));
        return adminDone(claims, 'model.licences', '', { licences });
      },
    },
    {
      method: 'POST', path: '/v1/admin/models/promote', summary: 'Make one version live (also how rollback works: promote the older one)', auth: 'admin', body: Schemas.AdminPromote,
      handler: async (req) => {
        const claims = await admin(req, 'model.promote');
        const body = parseJson(Schemas.AdminPromote, req.rawBody);
        const meta = await loadModelMeta();
        const target = await store.getModelAsset(body.id, body.version, body.channel);
        if (target?.kind === 'onnx' && !meta[`${body.id}@${body.version}`]?.licence) {
          await audit(claims.sub, 'model.promote', 'denied', `${body.id}@${body.version} no licence record`);
          throw new ApiError(409, 'MODEL_LICENCE_MISSING', 'This ONNX version has no licence record, so it cannot go live. Register a new version with one.');
        }
        if (!(await store.promoteModelAsset(body.id, body.version, body.channel))) throw new ApiError(404, 'NOT_FOUND', 'No such model version.');
        return adminDone(claims, 'model.promote', `${body.id}@${body.version} ${body.channel}`, { live: true });
      },
    },
    {
      method: 'POST', path: '/v1/admin/releases', summary: 'Publish a desktop release notice', auth: 'admin', body: Schemas.AdminRelease,
      handler: async (req) => {
        const claims = await admin(req, 'release.publish');
        const body = parseJson(Schemas.AdminRelease, req.rawBody);
        const url = new URL(body.url);
        if (url.protocol !== 'https:' || !config.releaseHosts.includes(url.hostname) || url.username || url.password) {
          await audit(claims.sub, 'release.publish', 'denied', `host ${url.hostname}`);
          throw new ApiError(400, 'RELEASE_URL_NOT_ALLOWED', `Release links must be https on ${config.releaseHosts.join(', ')}.`);
        }
        const inserted = await store.insertRelease({ platform: body.platform, channel: body.channel, version: body.version, url: url.toString(), notes: body.notes, minSupported: body.minSupported, publishedAtMs: now() });
        if (!inserted) throw new ApiError(409, 'RELEASE_EXISTS', 'That version is already published on this channel.');
        return adminDone(claims, 'release.publish', `${body.platform} ${body.version}`, { published: true });
      },
    },
  ];

  const bodyLimit = (path: string) => path === '/v1/admin/demo/photos' ? 2_300_000 : path.includes('/v1/admin/demo/photos/') ? 850 * 1024 : path.startsWith('/v1/ai/') ? 800 * 1024 : 64 * 1024;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://control-plane.invalid');
    const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const origin = originHeader && config.allowedOrigins.includes(originHeader) ? originHeader : undefined;
    if (req.method === 'OPTIONS') {
      send(res, { status: 204, body: null, headers: origin ? { 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600' } : {} }, origin);
      return;
    }
    try {
      if (url.pathname === '/openapi.json' && req.method === 'GET') { send(res, { status: 200, body: openApi(routes) }, origin); return; }
      const found = matchRoute(routes, req.method ?? 'GET', url.pathname);
      if (found === 'method') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      if (!found) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
      const rawBody = req.method === 'POST' ? await readBody(req, bodyLimit(url.pathname)) : '';
      const reply = await found.route.handler({
        method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, headers: req.headers, rawBody,
        ip: req.socket.remoteAddress ?? 'unknown',
      }, found.params);
      send(res, reply, origin);
    } catch (error) {
      if (error instanceof ApiError) {
        send(res, { status: error.status, body: { error: { code: error.code, message: error.message, retryable: error.retryable } } }, origin);
      } else {
        // Never echo internals, payloads or keys.
        console.error('control-plane: unhandled error', (error as Error)?.name);
        send(res, { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong on the server.', retryable: true } } }, origin);
      }
    }
  }

  return { handle, routes, store, createAccount, issueSession, config };
}

export type App = ReturnType<typeof createApp>;

/** OpenAPI 3.1 built from the same Zod schemas the handlers enforce, so the two cannot drift. */
export function openApi(routes: Route[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const path = route.path.replace(/:(\w+)/g, '{$1}');
    const security = route.auth === 'user' || route.auth === 'admin' ? [{ bearer: [] }] : route.auth === 'webhook' ? [{ webhookSignature: [] }] : [];
    paths[path] ??= {};
    paths[path][route.method.toLowerCase()] = {
      summary: route.summary,
      security,
      ...(route.body ? { requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(route.body, { io: 'input', unrepresentable: 'any' }) } } } } : {}),
      responses: {
        200: { description: 'OK', ...(route.response ? { content: { 'application/json': { schema: z.toJSONSchema(route.response, { unrepresentable: 'any' }) } } } : {}) },
        default: { description: 'Error: { error: { code, message, retryable } }' },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'InFlight control plane', version: '1', description: 'Optional online services. InFlight works fully offline without them.' },
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, webhookSignature: { type: 'apiKey', in: 'header', name: 'kestrel-signature' } } },
    paths,
  };
}

export { uuid };
