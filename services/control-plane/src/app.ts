import type { IncomingMessage, ServerResponse } from 'node:http';
import { freeStorageFor, settleStorageDay, storageAllowsUpload } from './cloudStorageBilling.ts';
import crypto from 'node:crypto';
import { z } from 'zod';
import { OWNED_GRANT_FLAG, type EntitlementGrant } from '../../../src/core/entitlementGrant.ts';
import { forPublicDocument, parseFlagSet, resolveFlagsForGrant, MAX_GRANT_FLAGS, type Audience, type FlagSet } from '../../../src/core/featureFlags.ts';
import { openSignedDataManifest } from '../../../src/core/modelDelivery.ts';
import { verifyLicence } from '../../../src/core/licence.ts';
import { newerRelease } from '../../../src/core/desktopRelease.ts';
import { inspectJpeg } from '../../../src/core/jpegInspect.ts';
import type { Config } from './config.ts';
import { MergeRefusal } from './accountMerge.ts';
import { ErasureRefusal } from './accountErasure.ts';
import { learningSubjectFor } from './learningSignal.ts';
import { hashPassword, randomId, sha256Hex, signEnvelope, signSession, uuid, verifyPassword, verifySession, verifyWebhook, type SessionClaims } from './crypto.ts';
import { SqliteStore } from './sqliteStore.ts';
import { MemoryDemoStudio, publicExamples, adminExamples, type DemoStudioStore, type ExampleFields } from './demoStudio.ts';
import { licenceIsUsable, newLicence, type AuditRecord, type LicenceRecord, type Store } from './store.ts';
import { geminiProvider, identify, suggest, verifyColour, type AiProvider } from './gateway.ts';
import type { CommerceLedger } from './commerce/ledger.ts';
import type { TransactionRecord } from './commerce/records.ts';
import type { paddleProCheckout } from './commerce/proCheckout.ts';
import { PADDLE_TRANSACTION_ID, PaddleEvent, verifyPaddleSignature, type PaddleEnvironment, PADDLE_ADJUSTMENT_ID } from './commerce/paddle.ts';
import { emailHashOf, giftEntitlement } from './entitlement.ts';
import { googleKeysFromNetwork, verifyGoogleIdToken, GOOGLE_CERTS_URL, type GoogleKeys } from './googleIdToken.ts';
import { APPLE_ISSUER, APPLE_KEYS_URL, FIREBASE_KEYS_URL, firebaseIssuer, oidcKeysFromNetwork, verifyOidcIdToken, type OidcKeys } from './oidcIdToken.ts';
import { UK_VAT_THRESHOLD_PENCE, UK_VAT_WARNING_PENCE } from './commerce/turnover.ts';
import { CLOUD_KINDS, DEFAULT_MAX_JOB_MS, type CloudJobRecord, type CloudOptions } from './cloudJobs.ts';
import { LEARNING_ACTIONS, LEARNING_CAPABILITIES, LEARNING_SOURCES, type LearningSink } from './learningSignal.ts';
import { CollabRefusal, MAX_RECIPE_BYTES, type CollabStore } from './collaboration.ts';
import { CloudRefusal, CLOUD_VARIANTS, type CloudPhotoStore } from './cloudPhotos.ts';
import { millicreditsForBytes, type AllowancePolicy, type UsageMeter } from './usageMeter.ts';
import { FEEDBACK_ITEM_ID } from '../../../src/core/clientFeedback.ts';
import type { NoticeStore } from './notices.ts';
import type { PushService } from './push.ts';
import type { NoticeContacts } from './noticeContacts.ts';
import type { NewsBroadcaster } from './news.ts';
import { PUSH_PLATFORMS, isPushToken } from '../../../src/core/pushNotices.ts';
import type { NoticeEvent } from '../../../src/core/collabNotices.ts';
import { GalleryRefusal, GALLERY_MAX_DAYS, GALLERY_MAX_PHOTOS, GALLERY_MAX_PREVIEW_BYTES, galleryIdFor, previewKey, type GalleryStore } from './gallery.ts';
import { SafetyRefusal, BLOCKED_MESSAGE, HELD_MESSAGE, NOTICE_CATEGORIES, caseSummary, caseForUploader, type CheckInput, type SafetyService } from './contentSafety.ts';
import { cloudKey } from './cloudPhotos.ts';
import { presenceUid, PRESENCE_TOKEN_TTL_S, type PresenceSigner } from './presenceToken.ts';
import { SAFE_COPY_LEVELS, SAFE_COPY_MAX_BYTES, safeCopyKey, type SafeCopyOptions } from './safeCopy.ts';
import type { SpendOptions } from './spendGuard.ts';
import { reservationPence, APPROVED_MONTHLY_PENCE, billingMonth, type VertexLearningConfig, type VertexLearningLedger } from './vertexLearning.ts';
import type { Mailer } from './mailer.ts';
import { MAIL_LANGUAGES, htmlLang, mailWords } from './mailText.ts';
import { cloudRunClientIp } from './networkCountry.ts';
import { ApiError, matchRoute, parseJson, readBody, send, type Reply, type Request, type Route } from './http.ts';

export const MAX_IMAGE_BYTES = 512 * 1024;
export const MAX_IMAGE_EDGE = 1024;
const DAY_MS = 86_400_000;
const QUOTA_PERIOD_MS = 30 * DAY_MS;
const REFRESH_TTL_MS = 30 * DAY_MS;
const offlineDeadline = (licence: { offlineGraceDays: number; validUntilMs: number | null }, now: number) =>
  Math.min(now + licence.offlineGraceDays * DAY_MS, licence.validUntilMs ?? Infinity);

export interface AppOptions {
  config: Config;
  /** Injected for tests: reads the models bucket's manifest/stable.json. Defaults to fetch. */
  manifestFetch?: typeof fetch;
  store?: Store;
  commerce?: Pick<CommerceLedger, 'getTaxSettings' | 'updateTaxSettings' | 'recordTurnover' | 'ossQuarter'>;
  pricing?: Pick<CommerceLedger, 'latestPriceReview'>;
  /** Paid checkouts for the admin console's Payments table (the Firestore commerce ledger). */
  payments?: { listTransactions(limit: number): Promise<TransactionRecord[]>; listTransactionsForMonth?(month: string): Promise<TransactionRecord[]> };
  /** Re-fetches a Paddle transaction and matches it to the server-owned order before granting Pro. */
  settlePaddle?: (transactionId: string) => Promise<'paid' | 'pending' | 'unknown'>;
  /** A full refund or chargeback of a Paddle Pro order removes Pro (commerce/paddleRefunds.ts). Absent: adjustments are acknowledged only. */
  revokePaddle?: (eventId: string, adjustmentId: string) => Promise<import('./commerce/paddleRefunds.ts').RefundOutcome>;
  /** The secret key of the Paddle notification destination (Secret Manager), for Paddle-Signature. */
  paddleWebhookSecret?: string;
  /** Paddle.js settings for the site's checkout page. The client-side token is public by design, but kept out of Git. */
  paddleClient?: { environment: PaddleEnvironment; clientToken: string };
  /** The Paddle API key's renewal record (paddle_key_rotation in Firestore), for the admin console. */
  paddleKeyStatus?: () => Promise<{ current: { rotatedAt: string; expiresAt: string; activated: boolean } | null; lastRun: { at: string; ok: boolean; reason?: string } | null }>;
  /** Server-owned Paddle checkout for Pro; off in production until the admin switches 'pro-checkout' on. */
  proCheckout?: ReturnType<typeof paddleProCheckout>;
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
  /** Always-available authenticated withdrawal/deletion sink when new research intake is disabled. */
  learningWithdrawal?: Pick<LearningSink, 'setConsent' | 'deleteBySubject'>;
  /** Vertex learning batches (owner decisions 7 and 9). Absent until the job is deployed: the switch cannot go on. */
  vertexLearning?: { ledger: VertexLearningLedger; config: VertexLearningConfig; startJob?: () => Promise<void> };
  /** Managed safe copy (opt-in backup). Absent in production until a bucket exists and is approved: routes answer 503. */
  safeCopy?: SafeCopyOptions;
  /** Shared projects (#1387): membership, per-photo leases, revisions. Absent until Firestore is set up for it: routes answer 503. */
  collab?: CollabStore;
  /** Signs per-project Realtime Database tokens for live cursors. Absent: the presence route answers 503. */
  presence?: PresenceSigner;
  /** App email from hello@inflight.studio (invitations). Absent until the owner confirms Send mail as: nothing is sent. */
  mailer?: Mailer;
  /** Client galleries: previews in their own UK bucket. Absent: the gallery routes answer 503. */
  gallery?: GalleryStore;
  /** Team notifications (G20, decision 11): in-app inbox, then the backend's FCM sender and hello@ mailer. Absent: inbox answers 503. */
  notices?: NoticeStore;
  /** Push notifications through FCM (G20). Absent: the push routes answer 503 and nothing is pushed. */
  push?: PushService;
  /** Email fallback for notices and product news: the Firebase user behind each account, its app language and the
   * product-news-by-email opt-in. No address is stored. Absent: no notice or news email. */
  contacts?: NoticeContacts;
  /** Product news from /admin (push first, opted-in email as the fallback). Absent: the send route answers 503. */
  news?: NewsBroadcaster;
  /** Shared projects' cloud photo store and the per-account download meter. Absent: the cloud routes answer 503. */
  cloudPhotos?: { store: CloudPhotoStore; meter: UsageMeter; allowance: AllowancePolicy; maxProjectBytes: number };
  /** Prepaid cloud balance (top-ups; pays beyond the free allowances). Absent: allowances are hard limits. */
  cloudBalance?: import('./cloudBalance.ts').CloudBalance;
  /** The person's data download and account deletion (accountErasure.ts). Absent: those routes answer 503. */
  accountErasure?: import('./accountErasure.ts').AccountErasure;
  /** Merging two accounts the person owns (accountMerge.ts). Absent: the merge routes answer 503. */
  accountMerge?: import('./accountMerge.ts').AccountMerges;
  /** Hard monthly ceiling on metered spend (Gemini, cloud jobs). Absent: no guard (development and tests). */
  spend?: SpendOptions;
  /** Acceptable-use checks on shared and cloud photos, and the report-a-gallery queue (contentSafety.ts). */
  safety?: { service: SafetyService; countryOf?: (req: Request) => string | null };
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
/** The app's opaque photo id: never a file name. */
const PhotoId = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/);
/** An ApiError that also tells the app who holds a photo, or which revision is the head now. */
class CollabApiError extends ApiError {
  constructor(status: number, code: string, message: string, readonly detail?: Record<string, unknown>) { super(status, code, message); }
}

/**
 * Admin on/off switches. A `planned` switch is designed but not built (owner decisions of 25 Nov 2026, docs/ROADMAP.md):
 * it is listed so the admin console shows the gate, it is never "configured", and so it can never be switched on.
 */
const SWITCHES = [
  { key: 'managed-ai', label: 'Managed Gemini helper', note: 'Sends one consented, metadata-free thumbnail at a time to Gemini. Counts against the monthly spend ceiling.' },
  { key: 'cloud-processing', label: 'Cloud processing', note: 'Heavier jobs (denoise, upscale, masks) for Pro. Needs the bucket and the runner job set up.' },
  { key: 'safe-copy', label: 'Safe copy (managed backup)', note: 'Opt-in backup to InFlight UK storage. Switching off stops uploads only; people can always read and delete their copy.' },
  { key: 'learning-signal', label: 'Learning signal', note: 'Opt-in anonymous corrections. Switching off stops sharing; opting out and deletion keep working.' },
  { key: 'pro-checkout', label: 'Pro checkout (Paddle)', note: 'People can buy Pro through Paddle\'s checkout. Paddle is the merchant of record and handles sales tax and VAT in every country. Switching off stops new checkouts only; payments already made are still verified and granted.' },
  { key: 'email', label: 'App email', note: 'Sends share invitations, and notices or product news only when push cannot reach someone, through Gmail SMTP (a personal Gmail account for now, or Google Workspace). Plain text and HTML, an unsubscribe link in every message, a daily cap under Google\'s limit (450 on Gmail, 500 by default on Workspace; 30 per sender, 3 per recipient). Only verified sign-in addresses are used and none is stored.' },
  { key: 'push', label: 'Push notifications (FCM)', note: 'Sends shared-project notices (comments, client feedback) to the phones and browsers where people turned alerts on. Names and counts only, never comment text or photos. Switching off stops sending and new device sign-ups; the in-app inbox keeps working.' },
  { key: 'product-news', label: 'Product news (updates, new features)', note: 'Lets an administrator send InFlight news from Notifications below: pushed to devices where people turned alerts on and kept "InFlight news" on; emailed only to people who turned on "Email me InFlight news" and could not be reached by push. Off by default.' },
  { key: 'collaboration', label: 'Shared projects', note: 'Cloud subscribers can share a project, invite people by email and check photos out to edit. Switching off stops new shared projects and checkouts; members can still read revisions.' },
  { key: 'vertex-learning', label: 'Learning in Vertex AI (batches)', note: "Trains shared models in Vertex AI from consented shadow files only (measurements, masks, decisions, recipes; never photos). Batches only: 1,000 newly edited photos, weekly when something is new, or Learn now. Each run reserves its worst-case cost first and is refused past the owner's £20 a month. No always-on endpoints." },
  { key: 'pro-cloud-storage', planned: true, label: 'Pro Cloud storage (designed, not built)', note: "Store a project's originals in InFlight's UK cloud to open on any device and share. Opt-in per project; originals on the device are never moved or changed. Cannot be switched on until it is built and the owner approves the cost." },
] as const;
const SWITCH_KEYS = SWITCHES.map((w) => w.key) as [SwitchKey, ...SwitchKey[]];
type SwitchKey = typeof SWITCHES[number]['key'];
const isPlanned = (key: SwitchKey) => SWITCHES.some((w) => w.key === key && 'planned' in w && w.planned);

export const Schemas = {
  AdminSwitch: z.object({ key: z.enum(SWITCH_KEYS), on: z.boolean() }).strict(),
  // Paddle asks the buyer for their country itself. Older apps still send one; it is accepted and ignored.
  ProCheckoutRequest: z.object({ country: z.string().regex(/^[A-Z]{2}$/).optional() }).strict(),
  CollabCreate: z.object({ name: z.string().trim().min(1).max(120), displayName: z.string().trim().min(1).max(80) }).strict(),
  CollabMembers: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('inviteEmail'), email: z.string().trim().email().max(254), role: z.enum(['editor', 'commenter', 'viewer', 'client']), displayName: z.string().trim().max(80).default(''), photoIds: z.array(PhotoId).max(5000).optional(), language: z.enum(MAIL_LANGUAGES).optional() }).strict(),
    z.object({ kind: z.literal('setRole'), accountId: z.string().min(1).max(64), role: z.enum(['owner', 'editor', 'commenter', 'viewer', 'client']) }).strict(),
    z.object({ kind: z.literal('setPhotos'), accountId: z.string().min(1).max(64), photoIds: z.array(PhotoId).max(5000).optional() }).strict(),
    z.object({ kind: z.literal('remove'), accountId: z.string().min(1).max(64) }).strict(),
    z.object({ kind: z.literal('options'), options: z.object({ editorsMayInvite: z.boolean(), clientsMayComment: z.boolean(), clientsMayExport: z.boolean() }).partial().strict(),
      leaseSettings: z.object({ heartbeatMs: z.number(), networkExpiryMs: z.number(), inactivityWarningMs: z.number(), inactivityReleaseMs: z.number() }).partial().strict().optional() }).strict(),
  ]),
  GalleryCreate: z.object({
    name: z.string().trim().min(1).max(120), photoIds: z.array(PhotoId).min(1).max(GALLERY_MAX_PHOTOS), days: z.number().int().min(1).max(GALLERY_MAX_DAYS).default(30),
    password: z.string().min(6).max(200).optional(), allowComments: z.boolean().default(false), allowFavourites: z.boolean().default(false),
    allowApproval: z.boolean().default(false), allowDownloads: z.boolean().default(false), watermark: z.boolean().default(false),
  }).strict(),
  GalleryPreview: z.object({ sha256: Sha, bytes: z.number().int().positive().max(GALLERY_MAX_PREVIEW_BYTES), variant: z.enum(['preview', 'thumb']).default('preview') }).strict(),
  GalleryReview: z.object({ itemId: z.string().regex(FEEDBACK_ITEM_ID), state: z.enum(['done', 'dismissed', 'new']) }).strict(),
  GalleryOpen: z.object({ token: z.string().min(20).max(128), password: z.string().max(200).optional() }).strict(),
  GalleryFeedback: z.object({
    token: z.string().min(20).max(128), password: z.string().max(200).optional(), visitor: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    photoId: PhotoId.nullable(), kind: z.enum(['favourite', 'unfavourite', 'comment', 'approve', 'request-changes', 'approve-all']), text: z.string().trim().max(2000).nullable().default(null),
  }).strict(),
  CollabAccept: z.object({ displayName: z.string().trim().min(1).max(80) }).strict(),
  CollabAcquire: z.object({ deviceId: z.string().min(8).max(128) }).strict(),
  CollabHeartbeat: z.object({ token: z.string().min(16).max(128), editing: z.boolean() }).strict(),
  CollabRelease: z.object({ token: z.string().min(16).max(128), action: z.enum(['checked-in', 'released']) }).strict(),
  CollabComment: z.object({ text: z.string().trim().min(1).max(2000), point: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict().nullable().default(null), replyTo: z.string().min(1).max(64).nullable().optional() }).strict(),
  CloudUpload: z.object({ variant: z.enum(CLOUD_VARIANTS), sha256: Sha, bytes: z.number().int().positive(), name: z.string().trim().min(1).max(200) }).strict(),
  CloudVariantBody: z.object({ variant: z.enum(CLOUD_VARIANTS) }).strict(),
  GalleryReport: z.object({
    token: z.string().min(20).max(128).describe('The gallery link token from the page fragment'),
    photoId: PhotoId.nullable().default(null),
    category: z.enum(NOTICE_CATEGORIES),
    explanation: z.string().trim().min(10).max(4000).describe('Why the content is illegal or breaks the acceptable use policy'),
    name: z.string().trim().max(120).optional(),
    email: z.string().email().max(254).optional(),
    goodFaith: z.literal(true).describe('The notifier confirms the report is accurate and made in good faith (EU DSA Art. 16)'),
  }).strict(),
  GalleryReportStatus: z.object({ noticeId: z.string().regex(/^ntc_[A-Za-z0-9_-]{6,40}$/), receipt: z.string().min(16).max(64) }).strict(),
  SafetyDecide: z.object({ outcome: z.enum(['released', 'upheld']), reason: z.string().trim().min(3).max(1000) }).strict(),
  SafetyManualReport: z.object({ ncmecReportId: z.string().trim().min(1).max(40).optional(), ncaDone: z.boolean().optional() }).strict(),
  SafetyNoticeDecide: z.object({ outcome: z.enum(['no-action', 'photo-removed', 'gallery-revoked']), reason: z.string().trim().min(3).max(1000) }).strict(),
  SafetyAppeal: z.object({ text: z.string().trim().min(3).max(2000) }).strict(),
  CloudRemove: z.object({ variants: z.array(z.enum(CLOUD_VARIANTS)).min(1).max(3).optional() }).strict(),
  CollabResolve: z.object({ resolved: z.boolean() }).strict(),
  PushDevice: z.object({ token: z.string().refine(isPushToken, 'not a push token'), platform: z.enum(PUSH_PLATFORMS) }).strict(),
  PushDeviceRemove: z.object({ token: z.string().refine(isPushToken, 'not a push token') }).strict(),
  PushPreferences: z.object({ comments: z.boolean(), clientFeedback: z.boolean(), news: z.boolean() }).partial().strict(),
  EmailPreferences: z.object({ productNews: z.boolean(), language: z.enum(MAIL_LANGUAGES) }).partial().strict(),
  NewsSend: z.object({
    broadcastId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
    title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500), dryRun: z.boolean(),
  }).strict(),
  NoticesRead: z.object({ ids: z.union([z.literal('all'), z.array(z.string().min(1).max(64)).max(200)]) }).strict(),
  CollabOverride: z.object({ reason: z.string().trim().min(1).max(500) }).strict(),
  CollabPublish: z.object({ token: z.string().min(16).max(128), baseRevisionId: z.string().max(64).nullable(), recipe: z.record(z.string(), z.unknown()), virtualCopyOf: z.string().max(64).optional() }).strict(),
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
  AttachLicenceRequest: z.object({ licenceKey: z.string().min(10).max(2000) }).strict(),
  MergeTicketRequest: z.object({ ticket: z.string().min(20).max(400) }).strict(),
  DeletionRequest: z.object({ confirm: z.string().min(1).max(40) }).strict(),
  MergeUndoRequest: z.object({ mergeId: z.string().regex(/^mrg_[0-9a-f]{24}$/) }).strict(),
  AccountDevicesRequest: z.object({ deviceHash: Hex64 }).strict(),
  AccountDeviceReleaseRequest: z.object({ deviceHash: Hex64, activationId: z.string().min(1).max(64) }).strict(),
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
  AdminCloudCredit: z.object({ accountId: z.string(), credits: z.number().int().min(1).max(100_000), reference: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/).describe('Applied once per reference, so a retried request never doubles it') }).strict(),
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

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const MAIL_PAGE_HEADERS = { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" };
/** The small unsubscribe pages, in the recipient's language. */
const mailPage = (lang: string, title: string, inner: string) => `<!doctype html><html lang="${esc(lang)}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5"><h1>${esc(title)}</h1>${inner}</body></html>`;

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
  const paddleLimiter = new RateLimiter(90, 60_000);
  const checkoutLimiter = new RateLimiter(10, 60_000);
  const galleryLimiter = new RateLimiter(120, 60_000);
  const reportLimiter = new RateLimiter(10, 10 * 60_000);

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
  async function signInWithProvider(provider: 'google' | 'apple' | 'firebase', email: string, privateRelay: boolean, subject = '') {
    const emailHash = sha256Hex(email);
    let account = await store.findAccountByEmailHash(emailHash);
    if (!account) {
      await store.createAccount({ accountId: `acc_${randomId(12)}`, emailHash, passwordHash: `${provider}-only`, role: 'user', status: 'active', createdAtMs: now(), aiConsent: false });
      account = await store.findAccountByEmailHash(emailHash);
    }
    if (account?.status === 'merged') throw new ApiError(403, 'ACCOUNT_MERGED', 'This account was merged into another InFlight account. Sign in with that account: everything from this one is there. The merge can be undone from that account for 30 days.');
    if (!account || account.status !== 'active') throw new ApiError(403, 'FORBIDDEN', 'This account is suspended.');
    const attached = await store.claimLicencesForEmail(emailHash, account.accountId);
    await audit(account.accountId, 'user.signin', 'allowed', `${provider}${attached ? ` attached=${attached}` : ''}`);
    // The Firebase user behind this account, so a notice can be emailed to its verified address when push cannot reach
    // the person. Only the id and the email hash are kept, never the address.
    if (provider === 'firebase' && subject && options.contacts) await options.contacts.rememberSignIn(account.accountId, subject, emailHash).catch(() => undefined);
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
        return { status: 200, body: await signInWithProvider(provider, check.email, check.privateRelay, check.subject) };
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
  const switchConfigured = (key: SwitchKey) => isPlanned(key) ? false : key === 'managed-ai' ? provider !== null : key === 'cloud-processing' ? !!options.cloud : key === 'safe-copy' ? !!options.safeCopy : key === 'collaboration' ? !!options.collab : key === 'email' ? !!options.mailer : key === 'push' ? !!options.push : key === 'product-news' ? !!options.news && !!options.push : key === 'pro-checkout' ? !!options.proCheckout : key === 'vertex-learning' ? !!options.vertexLearning : !!options.learning;
  async function switchOn(key: SwitchKey): Promise<boolean> {
    if (isPlanned(key)) return false;
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
    const limit = (await accountIsPro(accountId)) ? cloud.jobsPerPeriod : (cloud.basicJobsPerPeriod ?? 0);
    if (limit <= 0) {
      await audit(accountId, 'cloud.job.create', 'denied', 'not Pro');
      throw new ApiError(403, 'CLOUD_NOT_ENTITLED', 'Cloud processing is part of Pro.');
    }
    return { ...cloud, limit };
  }
  /** Pro: any usable paid licence (bought, rent-to-own in progress, or admin-granted) on the account. */
  async function accountIsPro(accountId: string) {
    const licences = await store.listLicencesForAccount(accountId);
    return licences.some((l) => (l.plan === 'paid' || l.plan === 'subscriber') && licenceIsUsable(l, now()));
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
    const jobId = uuid();
    // The month's allowance first; beyond it, one photo's price from the prepaid balance (counted in the ledger too,
    // so the failure paths' refund of the count stays right).
    let paidMillicredits: number | undefined;
    if (!(await cloud.ledger.reserve(claims.sub, reservedAtMs, cloud.limit, QUOTA_PERIOD_MS))) {
      const price = cloud.extraPhotoMillicredits ?? 300;
      if (cloud.balance && await cloud.balance.debit(claims.sub, price, `job:${jobId}`)) {
        paidMillicredits = price;
        await cloud.ledger.reserve(claims.sub, reservedAtMs, Number.MAX_SAFE_INTEGER, QUOTA_PERIOD_MS);
      } else {
        await refundSpend();
        await audit(claims.sub, 'cloud.job.create', 'denied', 'quota');
        throw new ApiError(429, 'CLOUD_QUOTA_EXHAUSTED', cloud.balance
          ? 'This month\'s cloud photos are used up and the cloud balance cannot cover more. Top up, or this runs on your device.'
          : 'This account has used its cloud processing allowance for this period.');
      }
    }
    try {
      const upload = await cloud.runner.createUpload(jobId, body.inputBytes);
      await cloud.ledger.put({
        jobId, accountId: claims.sub, kind: body.kind, inputBytes: body.inputBytes,
        status: 'awaiting-upload', createdAtMs: reservedAtMs, consentAtMs: reservedAtMs,
        ...(options.spend ? { spendPence } : {}),
        ...(paidMillicredits ? { paidMillicredits } : {}),
      });
      await audit(claims.sub, 'cloud.job.create', 'allowed', `${body.kind} ${jobId}`);
      return { status: 200, body: { jobId, uploadUrl: upload.uploadUrl, expiresAtMs: upload.expiresAtMs } };
    } catch (error) {
      await cloud.ledger.refund(claims.sub, reservedAtMs); // A job that never started costs nothing.
      await refundSpend();
      if (paidMillicredits) await cloud.balance?.credit(claims.sub, paidMillicredits, `refund:${jobId}`);
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
    const settled = cloud.settleFailed
      ? await cloud.settleFailed(record.jobId, legacySpendPence)
      : await (async () => {
        if (!(await cloud.ledger.transition(record.jobId, 'running', 'failed'))) return false;
        await cloud.ledger.refund(record.accountId, record.createdAtMs);
        await options.spend?.guard.refund(record.createdAtMs, record.spendPence ?? legacySpendPence);
        return true;
      })();
    // A failed photo paid from the balance is paid back. Keyed by job, so it happens once whichever path settles it.
    if (settled && record.paidMillicredits) await cloud.balance?.credit(record.accountId, record.paidMillicredits, `refund:${record.jobId}`);
    return settled;
  }

  /** A stable pseudonym, so withdrawal can delete a person's signals without the store holding their account id. */
  const learningSubject = learningSubjectFor;

  // ---- Managed safe copy. Uploads are gated; reading and deleting your own copy never is.
  function collabCfg(): CollabStore {
    if (!options.collab) throw new ApiError(503, 'COLLAB_NOT_CONFIGURED', 'Shared projects are not set up on this server yet.');
    return options.collab;
  }
  /** New shared projects and checkouts need the switch on; reading what exists never does. */
  async function collabWritable() {
    const collab = collabCfg();
    if (!(await switchOn('collaboration'))) throw new ApiError(503, 'COLLAB_DISABLED', 'Shared projects are switched off for now. Your own projects are unaffected.', true);
    return collab;
  }
  async function collab<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch (error) {
      if (error instanceof CollabRefusal) throw new CollabApiError(error.status, error.code, error.message, error.detail);
      throw error;
    }
  }

  /** Bytes in the cloud store across the projects this account pays for (projects it owns first). */
  async function accountStoredBytes(accountId: string): Promise<number> {
    if (!options.cloudPhotos || !options.collab) return 0;
    const collabStore = options.collab, photos = options.cloudPhotos.store;
    let total = 0;
    for (const p of await collabStore.myProjects(accountId)) {
      if (p.role !== 'owner') continue;
      if ((await collabStore.payerOf(p.projectId).catch(() => null)) !== accountId) continue;
      total += await photos.storedBytes(p.projectId);
    }
    return total;
  }
  /** Today's storage charge for one account (idempotent per day). */
  async function settleStorage(accountId: string) {
    if (!options.cloudBalance) return 'free' as const;
    return settleStorageDay(options.cloudBalance, accountId, await accountStoredBytes(accountId), freeStorageFor(await accountIsPro(accountId)), now());
  }
  function cloudCfg() {
    if (!options.cloudPhotos) throw new ApiError(503, 'CLOUD_NOT_CONFIGURED', 'The cloud photo store is not set up on this server yet. Everything on your devices keeps working.');
    return options.cloudPhotos;
  }
  async function cloud<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch (error) {
      if (error instanceof CloudRefusal) throw new ApiError(error.status, error.code, error.message);
      throw error;
    }
  }

  /** Tells people about a change. Never fails the action itself: a missed notice is logged, not an error for the person acting. */
  async function notify(event: () => Promise<NoticeEvent | null>) {
    if (!options.notices) return;
    try { const e = await event(); if (e && e.recipients.length) await options.notices.deliver(e, now()); } catch { /* the action already succeeded */ }
  }

  function pushCfg(): PushService {
    if (!options.push) throw new ApiError(503, 'PUSH_NOT_CONFIGURED', 'Alerts are not set up on this server yet. The in-app notifications still work.');
    return options.push;
  }
  options.push?.setGate(() => switchOn('push'));
  const news = options.news;
  news?.setEmailGate(() => switchOn('email'));
  function contactsCfg(): NoticeContacts {
    if (!options.contacts) throw new ApiError(503, 'EMAIL_PREFS_NOT_CONFIGURED', 'Email from InFlight is not set up on this server yet.');
    return options.contacts;
  }

  function erasureCfg() {
    if (!options.accountErasure) throw new ApiError(503, 'ERASURE_NOT_CONFIGURED', 'Downloading your data and deleting your account are not set up on this server yet.');
    return options.accountErasure;
  }
  async function erasing<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch (error) {
      if (error instanceof ErasureRefusal) throw new ApiError(error.status, error.code, error.message);
      throw error;
    }
  }
  const deletionBody = (r: { status: string; requestedAtMs: number; deleteAfterMs: number } | null) => ({ deletion: r && (r.status === 'scheduled' || r.status === 'deleting') ? { status: r.status, requestedAtMs: r.requestedAtMs, deleteAfterMs: r.deleteAfterMs } : null });

  function mergeCfg() {
    if (!options.accountMerge) throw new ApiError(503, 'MERGE_NOT_CONFIGURED', 'Merging accounts is not set up on this server yet.');
    return options.accountMerge;
  }
  async function merging<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch (error) {
      if (error instanceof MergeRefusal) throw new ApiError(error.status, error.code, error.message);
      throw error;
    }
  }

  function galleryCfg(): GalleryStore {
    if (!options.gallery) throw new ApiError(503, 'GALLERY_NOT_CONFIGURED', 'Client galleries are not set up on this server yet.');
    return options.gallery;
  }
  async function gallery<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch (error) {
      if (error instanceof GalleryRefusal) throw new ApiError(error.status, error.code, error.message);
      throw error;
    }
  }
  /** A member who may export this project manages its galleries. */
  async function galleryOwner(req: Request, galleryId: string) {
    const claims = await bearer(req);
    const g = await gallery(() => galleryCfg().get(galleryId));
    const member = await collab(() => collabCfg().requireMember(g.projectId, claims.sub, 'export'));
    return { claims, g, member };
  }

  function safetyCfg(): SafetyService {
    if (!options.safety) throw new ApiError(503, 'SAFETY_NOT_CONFIGURED', 'Reporting is not set up on this server yet. Email the address on the acceptable use page.');
    return options.safety.service;
  }
  async function safety<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch (error) {
      if (error instanceof SafetyRefusal) throw new ApiError(error.status, error.code, error.message, error.retryable);
      throw error;
    }
  }
  /**
   * The acceptable-use check on one stored picture, before it is shared (site/acceptable-use.html). Production never
   * publishes unchecked: without a hash checker it refuses. Development and tests without checks publish as before.
   */
  async function safetyCheck(req: Request, storage: import('./safeCopy.ts').SafeCopyStorage, input: Omit<CheckInput, 'country'>): Promise<void> {
    const service = options.safety?.service;
    if (!service?.configured || !storage.read || !storage.copy) {
      if (options.requireAdminSwitch) throw new ApiError(503, 'SAFETY_NOT_CONFIGURED', 'Sharing is not open yet: the safety checks are not set up on this server. Everything on your devices keeps working.');
      return;
    }
    const scannable = { read: storage.read.bind(storage), copy: storage.copy.bind(storage), delete: storage.delete.bind(storage) };
    const result = await safety(() => service.check(scannable, { ...input, country: options.safety?.countryOf?.(req) ?? null }, async (c) => {
      await store.setAccountStatus(c.accountId, 'suspended');
      if (c.galleryId && options.gallery) await options.gallery.setHold(c.galleryId, true).catch(() => undefined);
      await audit('system', 'safety.hash-match', 'denied', `${c.caseId} account suspended`);
    }));
    if (result.outcome === 'blocked') throw new ApiError(403, 'CONTENT_BLOCKED', BLOCKED_MESSAGE);
    if (result.outcome === 'held') {
      await audit(input.accountId, 'safety.ai-flag', 'denied', result.caseId);
      throw new ApiError(409, 'CONTENT_HELD', HELD_MESSAGE);
    }
  }

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

  /**
   * Bought outright (a verified one-off payment that never expires): mark the grant so the app keeps Pro on that
   * device for good, even if this service is down or gone (src/core/entitlementGrant.ts grantIsOwned). Always decided
   * here, never by an admin flag of the same name, so a gift or a flag rule cannot claim it.
   */
  function ownedFlags(licence: LicenceRecord, base: Pick<EntitlementGrant, 'flags'>): Pick<EntitlementGrant, 'flags'> {
    const owned = licence.paid && licence.plan === 'paid' && licence.validUntilMs === null && licence.status === 'active';
    const { [OWNED_GRANT_FLAG]: _ignored, ...rest } = base.flags ?? {};
    if (owned) return { flags: { ...rest, [OWNED_GRANT_FLAG]: { on: true } } };
    return base.flags ? { flags: rest } : {};
  }

  // The one model manifest: the bucket's signed manifest/stable.json, served unchanged after its signature is checked
  // against the pinned manifest key. The control plane never builds or re-signs a model list (kcp keys sign grants only).
  let cachedManifest: { atMs: number; body: unknown } | null = null;
  const MANIFEST_CACHE_MS = 5 * 60_000;
  async function verifiedModelManifest(): Promise<unknown> {
    const source = config.modelManifest;
    if (!source) throw new ApiError(503, 'MANIFEST_NOT_CONFIGURED', 'The model manifest is not set up on this server. The app keeps its bundled models.', true);
    if (cachedManifest && now() - cachedManifest.atMs < MANIFEST_CACHE_MS) return cachedManifest.body;
    const fetcher = options.manifestFetch ?? fetch;
    let envelope: unknown;
    try {
      const response = await fetcher(source.url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(String(response.status));
      envelope = await response.json();
    } catch {
      if (cachedManifest) return cachedManifest.body; // a short bucket outage serves the last verified copy
      throw new ApiError(503, 'MANIFEST_UNAVAILABLE', 'The model manifest could not be read just now. The app keeps the models it has.', true);
    }
    const checked = await openSignedDataManifest(envelope, source.keys);
    if (!checked.ok) {
      console.error('control-plane: model manifest refused', checked.reason);
      if (cachedManifest) return cachedManifest.body;
      throw new ApiError(503, 'MANIFEST_UNTRUSTED', 'The model manifest did not verify, so it is not served. The app keeps the models it has.', true);
    }
    cachedManifest = { atMs: now(), body: envelope };
    return envelope;
  }

  // Device management and activation must select exactly the same account-owned Pro licence.
  async function effectiveAccountLicence(accountId: string, at: number) {
    const usable = (await store.listLicencesForAccount(accountId)).filter(l => licenceIsUsable(l, at) && l.plan !== 'free');
    return usable.sort((a, b) => Number(b.paid) - Number(a.paid) || b.majorVersion - a.majorVersion)[0];
  }

  const routes: Route[] = [
    // Cloud Run's front end reserves some paths ending in 'z' (including /healthz) and answers them with its own 404
    // before the request reaches the container, so public clients probe /health. /healthz stays for the container probe.
    {
      method: 'GET', path: '/v1/mail/unsubscribe', summary: 'Confirm page for stopping invitation emails (a link only shows a button, so mail scanners cannot unsubscribe anyone)', auth: 'none',
      handler: (req) => {
        const r = req.query.get('r') ?? ''; const t = req.query.get('t') ?? ''; const l = htmlLang(req.query.get('l') ?? undefined);
        const w = mailWords(l).unsubscribe;
        const ok = !!options.mailer && options.mailer.checkUnsubscribe(r, t);
        const safe = (v: string) => v.replace(/[^A-Za-z0-9_-]/g, '');
        return { status: ok ? 200 : 400, body: mailPage(l, ok ? w.title : w.invalid, ok
          ? `<p>${esc(w.confirm)}</p><form method="post" action="/v1/mail/unsubscribe?r=${safe(r)}&amp;t=${safe(t)}&amp;l=${encodeURIComponent(l)}"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">${esc(w.button)}</button></form>`
          : `<p>${esc(w.invalidHint)}</p>`), headers: MAIL_PAGE_HEADERS };
      },
    },
    {
      method: 'POST', path: '/v1/mail/unsubscribe', summary: 'One-click unsubscribe (RFC 8058) from invitation emails', auth: 'none',
      handler: async (req) => {
        const r = req.query.get('r') ?? ''; const t = req.query.get('t') ?? ''; const l = htmlLang(req.query.get('l') ?? undefined);
        if (!options.mailer || !options.mailer.checkUnsubscribe(r, t)) throw new ApiError(400, 'UNSUBSCRIBE_INVALID', 'This unsubscribe link is not valid.');
        await options.mailer.unsubscribe(r);
        await audit('anonymous', 'mail.unsubscribe', 'allowed', '');
        const w = mailWords(l).unsubscribe;
        return { status: 200, body: mailPage(l, w.title, `<p>${esc(w.done)}</p>`), headers: MAIL_PAGE_HEADERS };
      },
    },
    {
      method: 'POST', path: '/v1/admin/news/send', summary: 'Send InFlight product news: push first, email only to people who asked for it and could not be pushed (a dry run sends nothing)', auth: 'admin', body: Schemas.NewsSend,
      handler: async (req) => {
        const claims = await admin(req, 'news.send');
        const body = parseJson(Schemas.NewsSend, req.rawBody);
        if (!news) throw new ApiError(503, 'NEWS_NOT_CONFIGURED', 'Product news needs push notifications set up on this server.');
        if (!body.dryRun && !(await switchOn('product-news'))) throw new ApiError(409, 'NEWS_SWITCHED_OFF', 'Switch on Product news first.');
        const report = await news.send(body, now());
        return adminDone(claims, 'news.send', `${body.dryRun ? 'dry run ' : ''}${report.broadcastId} pushed=${report.pushed} emailed=${report.emailed} waiting=${report.emailWaiting} notTried=${report.notTried}`, report);
      },
    },
    {
      method: 'GET', path: '/v1/admin/mail', summary: 'App email sent today against the daily cap and the sending account\'s Google limit', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'mail.read');
        if (!options.mailer) throw new ApiError(503, 'MAIL_NOT_CONFIGURED', 'App email is not set up on this server.');
        return adminDone(claims, 'mail.read', '', { on: await switchOn('email'), ...(await options.mailer.today()) });
      },
    },
    { method: 'GET', path: '/health', summary: 'Liveness (public)', auth: 'none', handler: () => ({ status: 200, body: { ok: true } }) },
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
    // ---- The person's own data: download it, or delete the account (30 days to change their mind). Local projects and
    // originals are never on this service, so nothing here can reach them.
    {
      method: 'GET', path: '/v1/me/data-export', summary: 'Signed in: everything this service holds about the account (account, licences, devices, shared projects, cloud photo list, comments, purchases, preferences) as JSON', auth: 'user',
      handler: async (req) => {
        const claims = await bearer(req);
        const body = await erasing(() => erasureCfg().exportData(claims.sub));
        await audit(claims.sub, 'account.data_export', 'allowed', '');
        return { status: 200, body };
      },
    },
    {
      method: 'GET', path: '/v1/me/deletion', summary: 'Signed in: whether the account is waiting to be deleted, and what deleting it would remove', auth: 'user',
      handler: async (req) => {
        const claims = await bearer(req);
        const cfg = erasureCfg();
        const [record, preview] = await Promise.all([cfg.status(claims.sub), cfg.preview(claims.sub)]);
        return { status: 200, body: { ...deletionBody(record), preview } };
      },
    },
    {
      method: 'POST', path: '/v1/me/deletion', summary: 'Signed in: delete the account in 30 days (type DELETE to confirm). Undo any time before then by signing in', auth: 'user', body: Schemas.DeletionRequest,
      handler: async (req) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.DeletionRequest, req.rawBody);
        return { status: 200, body: deletionBody(await erasing(() => erasureCfg().schedule(claims.sub, body.confirm))) };
      },
    },
    {
      method: 'POST', path: '/v1/me/deletion/cancel', summary: 'Signed in: keep the account (undo a deletion that is still waiting)', auth: 'user',
      handler: async (req) => {
        const claims = await bearer(req);
        await erasing(() => erasureCfg().cancel(claims.sub));
        return { status: 200, body: { deletion: null } };
      },
    },
    // ---- Merging two accounts the person owns: proved from both sign-ins, previewed, confirmed, undoable for 30 days.
    {
      method: 'POST', path: '/v1/me/merge/ticket', summary: 'Signed in to the account that will close: a 15-minute ticket saying it agrees to be merged into the account the app is signed in to next', auth: 'user',
      handler: async (req) => { const claims = await bearer(req); return { status: 200, body: mergeCfg().ticketFor(claims.sub) }; },
    },
    {
      method: 'POST', path: '/v1/me/merge/preview', summary: 'Signed in to the account that stays: what would move from the other account (licences, balance, shared projects, devices) and whether anything blocks it', auth: 'user', body: Schemas.MergeTicketRequest,
      handler: async (req) => { const claims = await bearer(req); const body = parseJson(Schemas.MergeTicketRequest, req.rawBody); return { status: 200, body: await merging(() => mergeCfg().preview(body.ticket, claims.sub)) }; },
    },
    {
      method: 'POST', path: '/v1/me/merge', summary: 'Signed in to the account that stays: merge the other account into it (idempotent per ticket; undoable for 30 days)', auth: 'user', body: Schemas.MergeTicketRequest,
      handler: async (req) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.MergeTicketRequest, req.rawBody);
        const record = await merging(() => mergeCfg().merge(body.ticket, claims.sub));
        return { status: 200, body: { mergeId: record.mergeId, undoUntilMs: record.undoUntilMs, licences: record.licences.length, balanceMillicredits: record.balanceMillicredits, projects: record.projects.length, devices: record.pushTokens } };
      },
    },
    {
      method: 'GET', path: '/v1/me/merges', summary: 'Accounts merged into this one, with the undo deadline', auth: 'user',
      handler: async (req) => {
        const claims = await bearer(req);
        const merges = await mergeCfg().list(claims.sub);
        return { status: 200, body: { merges: merges.map((m) => ({ mergeId: m.mergeId, status: m.status, createdAtMs: m.createdAtMs, undoUntilMs: m.undoUntilMs, licences: m.licences.length, balanceMillicredits: m.balanceMillicredits, projects: m.projects.length })) } };
      },
    },
    {
      method: 'POST', path: '/v1/me/merge/undo', summary: 'Undo a merge within 30 days: the other account comes back with what it brought', auth: 'user', body: Schemas.MergeUndoRequest,
      handler: async (req) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.MergeUndoRequest, req.rawBody);
        const record = await merging(() => mergeCfg().undo(body.mergeId, claims.sub));
        return { status: 200, body: { mergeId: record.mergeId, status: record.status } };
      },
    },
    {
      method: 'POST', path: '/v1/me/licence/attach', summary: 'Signed in: put a KESTREL1 licence key used before signing up on this account (its devices come with it). Never moves a key from another account', auth: 'user',
      body: Schemas.AttachLicenceRequest,
      handler: async (req) => {
        const claims = await bearer(req);
        if (!activateLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
        const body = parseJson(Schemas.AttachLicenceRequest, req.rawBody);
        const check = await verifyLicence(body.licenceKey, config.licencePublicKey);
        if (!check.ok) throw new ApiError(400, 'LICENCE_INVALID', 'That licence key was not recognised.');
        const account = await store.getAccount(claims.sub);
        const outcome = await store.attachLicenceToAccount(check.details.id, claims.sub,
          newLicence(check.details.id, check.details.plan, now(), { accountId: claims.sub, emailHash: account?.emailHash ?? null }));
        await audit(claims.sub, 'licence.attach', outcome === 'other' ? 'denied' : 'allowed', `${check.details.id} ${outcome}`);
        if (outcome === 'other') throw new ApiError(409, 'LICENCE_ON_OTHER_ACCOUNT', 'This licence key is already on another InFlight account. To bring the two together, merge the accounts in Settings → Account.');
        return { status: 200, body: { attached: outcome === 'attached', already: outcome === 'already', licenceId: check.details.id } };
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
        const licence = await effectiveAccountLicence(claims.sub, t);
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
          ...ownedFlags(outcome.licence, await grantFlagsFor({ plan: outcome.licence.plan === 'free' ? 'basic' : 'pro', user: (await store.getAccount(claims.sub))?.emailHash }, body.deviceHash, body.appVersion, t)),
        };
        await audit(claims.sub, 'device.activate.account', 'allowed', outcome.activationId);
        return { status: 200, body: { grant: signEnvelope(grant, config.signingKey), activationId: outcome.activationId } };
      },
    },
    {
      method: 'POST', path: '/v1/me/checkout/pro', summary: 'Signed in: start a server-priced Paddle checkout for Pro, bound to this account. Returns the checkout page to open; Paddle collects the country and tax.', auth: 'user',
      body: Schemas.ProCheckoutRequest,
      handler: async (req) => {
        const claims = await bearer(req);
        const checkout = options.proCheckout;
        if (!checkout || !(await switchOn('pro-checkout'))) throw new ApiError(503, 'CHECKOUT_DISABLED', 'Buying Pro is not open yet. Everything else keeps working.', true);
        if (!checkoutLimiter.take(claims.sub, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
        parseJson(Schemas.ProCheckoutRequest, req.rawBody);
        const t = now();
        const current = await effectiveAccountLicence(claims.sub, t);
        if (current?.paid) throw new ApiError(409, 'ALREADY_PRO', 'This account already has Pro.');
        const account = await store.getAccount(claims.sub);
        if (!account?.emailHash) throw new ApiError(403, 'ACCOUNT_UNVERIFIED', 'Sign in again to buy Pro.');
        try {
          const started = await checkout.start({ accountId: claims.sub, emailHash: account.emailHash });
          await audit(claims.sub, 'checkout.pro.start', 'allowed', started.checkoutId);
          return { status: 201, body: started };
        } catch {
          throw new ApiError(502, 'CHECKOUT_UNAVAILABLE', 'The payment page could not be opened. Nothing was charged; try again shortly.', true);
        }
      },
    },
    {
      method: 'GET', path: '/v1/me/checkout/pro/:id', summary: 'Signed in: has this checkout been paid and verified with Paddle? Paid means /v1/me/activate now returns Pro.', auth: 'user',
      handler: async (req, params) => {
        const claims = await bearer(req);
        if (!options.proCheckout || !PADDLE_TRANSACTION_ID.test(params.id ?? '')) throw new ApiError(404, 'NOT_FOUND', 'No such checkout.');
        if (!checkoutLimiter.take(claims.sub, now())) throw new ApiError(429, 'RATE_LIMITED', 'Checking too often. Wait a minute and try again.', true);
        let status: 'paid' | 'pending' | null;
        try { status = await options.proCheckout.status({ accountId: claims.sub, checkoutId: params.id! }); }
        catch { throw new ApiError(503, 'PAYMENT_VERIFICATION_PENDING', 'The payment is still being checked. Try again shortly.', true); }
        if (!status) throw new ApiError(404, 'NOT_FOUND', 'No such checkout.');
        return { status: 200, body: { status } };
      },
    },
    {
      method: 'POST', path: '/v1/me/devices', summary: 'List devices for the signed-in account’s current Pro licence without activating this device', auth: 'user',
      body: Schemas.AccountDevicesRequest, response: Schemas.LicenceStatusResponse,
      handler: async (req) => {
        const claims = await bearer(req);
        if (!activateLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
        const body = parseJson(Schemas.AccountDevicesRequest, req.rawBody);
        const licence = await effectiveAccountLicence(claims.sub, now());
        if (!licence) return { status: 200, body: { status: 'unknown', validUntilMs: null, maxDevices: 0, devices: [] } };
        const devices = await store.listActivationsForLicence(licence.licenceId);
        return { status: 200, body: {
          status: 'active', validUntilMs: licence.validUntilMs, maxDevices: licence.maxDevices,
          devices: devices.map(d => ({ activationId: d.activationId, platform: d.platform, appVersion: d.appVersion,
            lastSeenMs: d.lastSeenMs, thisDevice: d.deviceHash === body.deviceHash })),
        } };
      },
    },
    {
      method: 'POST', path: '/v1/me/devices/deactivate', summary: 'Free another device on the signed-in account’s current Pro licence', auth: 'user',
      body: Schemas.AccountDeviceReleaseRequest, response: z.object({ deactivated: z.boolean() }),
      handler: async (req) => {
        const claims = await bearer(req);
        if (!activateLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
        const body = parseJson(Schemas.AccountDeviceReleaseRequest, req.rawBody);
        const licence = await effectiveAccountLicence(claims.sub, now());
        const device = licence && (await store.listActivationsForLicence(licence.licenceId)).find(d => d.activationId === body.activationId);
        // Never accept a licence/account id from the client or disclose other accounts' devices.
        if (!device) throw new ApiError(404, 'NOT_FOUND', 'That device is not using this account’s current Pro licence.');
        if (device.deviceHash === body.deviceHash) throw new ApiError(400, 'CURRENT_DEVICE', 'Choose another device to free its slot.');
        if (!(await store.deactivateDevice(device.activationId))) throw new ApiError(404, 'NOT_FOUND', 'That device is no longer using this licence.');
        await audit(claims.sub, 'device.deactivate.account', 'allowed', device.activationId);
        return { status: 200, body: { deactivated: true } };
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
        // Collection is optional, but signed-in users must still be able to
        // withdraw and erase research records when collection is switched OFF.
        const sink = body.consent ? options.learning : (options.learningWithdrawal ?? options.learning);
        if (!sink) throw new ApiError(503, 'LEARNING_NOT_CONFIGURED', 'Research consent storage is not available on this server.');
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

    // ---- Shared projects (#1387 C01-C03). Membership, per-photo checkout and never-last-write-wins revisions.
    {
      method: 'POST', path: '/v1/collab/projects', summary: 'Share a new project (Cloud plan). You become its owner', auth: 'user', body: Schemas.CollabCreate,
      handler: async (req) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.CollabCreate, req.rawBody);
        const store_ = await collabWritable();
        const plans = await store.listLicencesForAccount(claims.sub);
        if (!plans.some((l) => l.plan === 'subscriber' && licenceIsUsable(l, now()))) throw new ApiError(403, 'COLLAB_NOT_ENTITLED', 'Shared projects are part of the Cloud plan.');
        const project = await store_.createProject({ accountId: claims.sub, displayName: body.displayName }, body.name, now());
        await audit(claims.sub, 'collab.create', 'allowed', project.projectId);
        return { status: 200, body: { projectId: project.projectId } };
      },
    },
    {
      method: 'GET', path: '/v1/collab/projects', summary: 'The shared projects you belong to', auth: 'user',
      handler: async (req) => { const claims = await bearer(req); return { status: 200, body: { projects: await collabCfg().myProjects(claims.sub) } }; },
    },
    {
      method: 'GET', path: '/v1/collab/invites', summary: 'Invitations waiting for your email address', auth: 'user',
      handler: async (req) => { const claims = await bearer(req); const account = await store.getAccount(claims.sub); return { status: 200, body: { invites: await collabCfg().invitesFor(account!.emailHash) } }; },
    },
    {
      method: 'GET', path: '/v1/collab/projects/:id', summary: 'A shared project as your role may see it', auth: 'user',
      handler: async (req, params) => { const claims = await bearer(req); return { status: 200, body: await collab(() => collabCfg().project(params.id, claims.sub)) }; },
    },
    {
      method: 'POST', path: '/v1/collab/projects/:id/members', summary: 'Invite by email, change a role or photo selection, remove someone, or change project settings', auth: 'user', body: Schemas.CollabMembers,
      handler: async (req, params) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.CollabMembers, req.rawBody);
        const c = await collabWritable();
        const change = body.kind === 'inviteEmail'
          ? { kind: 'inviteEmail' as const, invite: { emailHash: emailHashOf(body.email), role: body.role, displayName: body.displayName, ...(body.photoIds ? { photoIds: body.photoIds } : {}) } }
          : body.kind === 'setPhotos' ? { ...body, photoIds: body.photoIds } : body;
        await collab(() => c.change(params.id, claims.sub, change, now()));
        await audit(claims.sub, `collab.${body.kind}`, 'allowed', params.id);
        const project = await collab(() => c.project(params.id, claims.sub));
        let emailed: boolean | undefined;
        if (body.kind === 'inviteEmail' && options.mailer && (await switchOn('email'))) {
          // The invitation stands either way: it is also shown in the app under Shared with me.
          try {
            const r = await options.mailer.sendInvitation({ to: body.email, recipientHash: emailHashOf(body.email), senderAccountId: claims.sub, inviterName: project.me.displayName, projectName: project.name, role: body.role, language: body.language });
            emailed = r.sent;
            await audit(claims.sub, 'mail.invite', r.sent ? 'allowed' : 'denied', r.sent ? params.id : `${params.id} ${r.reason}`);
          } catch {
            emailed = false;
            await audit(claims.sub, 'mail.invite', 'denied', `${params.id} send failed`); // never the address or the server's words
          }
        }
        return { status: 200, body: emailed === undefined ? project : { ...project, emailed } };
      },
    },
    {
      method: 'POST', path: '/v1/collab/projects/:id/accept', summary: 'Accept an invitation sent to your email address', auth: 'user', body: Schemas.CollabAccept,
      handler: async (req, params) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.CollabAccept, req.rawBody);
        const account = await store.getAccount(claims.sub);
        const member = await collab(() => collabCfg().accept(params.id, { accountId: claims.sub, emailHash: account!.emailHash, displayName: body.displayName }, now()));
        return { status: 200, body: { member } };
      },
    },
    {
      method: 'GET', path: '/v1/collab/projects/:id/leases', summary: 'Which photos are checked out now, and by whom', auth: 'user',
      handler: async (req, params) => { const claims = await bearer(req); return { status: 200, body: { leases: await collab(() => collabCfg().leases(params.id, claims.sub, now())) } }; },
    },
    {
      method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/lease', summary: 'Check a photo out on the first edit (renews on the same device)', auth: 'user', body: Schemas.CollabAcquire,
      handler: async (req, params) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.CollabAcquire, req.rawBody);
        if (!PhotoId.safeParse(params.photoId).success) throw new ApiError(400, 'BAD_REQUEST', 'That is not a photo id.');
        const c = await collabWritable();
        return { status: 200, body: await collab(() => c.acquire(params.id, params.photoId, claims.sub, body.deviceId, now())) };
      },
    },
    {
      method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/heartbeat', summary: 'Keep a checkout alive; editing is true while you or background work for this photo is changing it', auth: 'user', body: Schemas.CollabHeartbeat,
      handler: async (req, params) => {
        await bearer(req);
        const body = parseJson(Schemas.CollabHeartbeat, req.rawBody);
        return { status: 200, body: await collab(() => collabCfg().heartbeat(params.id, params.photoId, body.token, body.editing, now())) };
      },
    },
    {
      method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/release', summary: 'Check a photo in after saving, or release it', auth: 'user', body: Schemas.CollabRelease,
      handler: async (req, params) => {
        await bearer(req);
        const body = parseJson(Schemas.CollabRelease, req.rawBody);
        return { status: 200, body: await collab(() => collabCfg().release(params.id, params.photoId, body.token, body.action, now())) };
      },
    },
    {
      method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/override', summary: "Owner only: release someone else's checkout, with a reason that is recorded", auth: 'user', body: Schemas.CollabOverride,
      handler: async (req, params) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.CollabOverride, req.rawBody);
        const result = await collab(() => collabCfg().override(params.id, params.photoId, claims.sub, body.reason, now()));
        await audit(claims.sub, 'collab.override', 'allowed', `${params.id}/${params.photoId}`);
        return { status: 200, body: result };
      },
    },
    {
      method: 'GET', path: '/v1/collab/projects/:id/photos/:photoId/revisions', summary: 'Revision history of one photo (no recipes)', auth: 'user',
      handler: async (req, params) => { const claims = await bearer(req); return { status: 200, body: await collab(() => collabCfg().history(params.id, params.photoId, claims.sub)) }; },
    },
    {
      method: 'GET', path: '/v1/collab/projects/:id/photos/:photoId/revisions/:revisionId', summary: 'One revision with its recipe', auth: 'user',
      handler: async (req, params) => { const claims = await bearer(req); return { status: 200, body: await collab(() => collabCfg().revision(params.id, params.photoId, params.revisionId, claims.sub)) }; },
    },
    {
      method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/revisions', summary: 'Save a shared revision: needs your live checkout and the current head (409 with the head otherwise)', auth: 'user', body: Schemas.CollabPublish,
      handler: async (req, params) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.CollabPublish, req.rawBody);
        if (Buffer.byteLength(JSON.stringify(body.recipe)) > MAX_RECIPE_BYTES) throw new ApiError(413, 'COLLAB_RECIPE_TOO_LARGE', 'That edit is too large to share.');
        const revision = await collab(() => collabCfg().publish(params.id, params.photoId, claims.sub, body, now()));
        return { status: 200, body: { revision } };
      },
    },
    {
      method: 'GET', path: '/v1/collab/projects/:id/photos/:photoId/comments', summary: 'Comments on one photo, oldest first', auth: 'user',
      handler: async (req, params) => { const claims = await bearer(req); return { status: 200, body: { comments: await collab(() => collabCfg().comments(params.id, params.photoId, claims.sub)) } }; },
    },
    {
      method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/comments', summary: 'Comment on a photo, optionally pinned to a spot on it', auth: 'user', body: Schemas.CollabComment,
      handler: async (req, params) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.CollabComment, req.rawBody);
        if (!PhotoId.safeParse(params.photoId).success) throw new ApiError(400, 'BAD_REQUEST', 'That is not a photo id.');
        const c = await collabWritable();
        const comment = await collab(() => c.addComment(params.id, params.photoId, claims.sub, { text: body.text, point: body.point ?? null, replyTo: body.replyTo ?? null }, now()));
        await notify(async () => {
          const who = await c.commentAudience(params.id, params.photoId, claims.sub);
          // A reply also reaches whoever started the thread, a client included (it is their own thread).
          const starter = comment.replyTo ? (await c.comments(params.id, params.photoId, claims.sub)).find((x) => x.id === comment.replyTo)?.authorAccountId : undefined;
          const recipients = [...new Set([...who.accountIds, ...(starter && starter !== claims.sub ? [starter] : [])])];
          return { kind: comment.replyTo ? 'reply' : 'comment', projectId: params.id, projectName: who.projectName, photoId: params.photoId, actorName: who.actorName, recipients };
        });
        return { status: 200, body: { comment } };
      },
    },
    {
      method: 'POST', path: '/v1/collab/projects/:id/comments/:commentId/resolve', summary: 'Mark a comment done, or reopen it', auth: 'user', body: Schemas.CollabResolve,
      handler: async (req, params) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.CollabResolve, req.rawBody);
        const comment = await collab(() => collabCfg().resolveComment(params.id, params.commentId, claims.sub, body.resolved, now()));
        // The author hears that their comment was marked done or reopened by someone else.
        if (comment.authorAccountId !== claims.sub) await notify(async () => {
          const who = await collabCfg().commentAudience(params.id, comment.photoId, claims.sub);
          return { kind: body.resolved ? 'resolve' : 'reopen', projectId: params.id, projectName: who.projectName, photoId: comment.photoId, actorName: who.actorName, recipients: [comment.authorAccountId] };
        });
        return { status: 200, body: { comment } };
      },
    },
    // ---- Cloud photo store for shared projects. Previews first; originals only on demand; downloads metered to the owner.
    {
      method: 'GET', path: '/v1/collab/projects/:id/cloud', summary: 'Photos this project keeps in the cloud (previews always, originals when stored)', auth: 'user',
      handler: async (req, params) => {
        const claims = await bearer(req);
        const member = await collab(() => collabCfg().requireMember(params.id, claims.sub, 'view'));
        if (member.role === 'client') throw new ApiError(403, 'COLLAB_NOT_PERMITTED', 'Clients see the photos shared with them in a gallery.');
        return { status: 200, body: { photos: await cloudCfg().store.list(params.id) } };
      },
    },
    {
      method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/cloud/upload-url', summary: 'A signed URL to put one preview, filmstrip picture or original in the cloud', auth: 'user', body: Schemas.CloudUpload,
      handler: async (req, params) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.CloudUpload, req.rawBody);
        if (!PhotoId.safeParse(params.photoId).success) throw new ApiError(400, 'BAD_REQUEST', 'That is not a photo id.');
        const c = await collabWritable();
        await collab(() => c.requireMember(params.id, claims.sub, 'edit', params.photoId));
        const cfg = cloudCfg();
        // Storage beyond the payer's included amount (Pro 2.5 GB, Basic none) needs a month of it in their cloud balance. Nothing stored is ever removed.
        const payer = await collab(() => c.payerOf(params.id));
        await settleStorage(payer);
        if (!(await storageAllowsUpload(options.cloudBalance, payer, await accountStoredBytes(payer), body.bytes, freeStorageFor(await accountIsPro(payer))))) {
          throw new ApiError(402, 'STORAGE_NEEDS_CREDIT', "This project's owner needs cloud balance for more storage (Basic includes none, Pro includes 2.5 GB). A top-up lets more go up. Everything already stored stays.");
        }
        return { status: 200, body: await cloud(() => cfg.store.signUpload(params.id, params.photoId, claims.sub, body, now(), cfg.maxProjectBytes)) };
      },
    },
    {
      method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/cloud/commit', summary: 'Mark an uploaded cloud object as stored', auth: 'user', body: Schemas.CloudVariantBody,
      handler: async (req, params) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.CloudVariantBody, req.rawBody);
        await collab(() => collabCfg().requireMember(params.id, claims.sub, 'edit', params.photoId));
        const cfg = cloudCfg();
        if (body.variant === 'original') {
          // An original is never checked itself (RAW files cannot be): it is stored only behind a preview that passed.
          if (options.safety?.service.configured) await cloud(() => cfg.store.objectFor(params.id, params.photoId, 'preview')).catch(() => { throw new ApiError(409, 'PREVIEW_FIRST', 'Store the preview first; the original follows it.'); });
        } else {
          await safetyCheck(req, cfg.store.storage, { scope: 'cloud', accountId: claims.sub, projectId: params.id, galleryId: null, photoId: params.photoId, variant: body.variant, key: cloudKey(params.id, params.photoId, body.variant), sha256: '', bytes: 0 });
        }
        await cloud(() => cfg.store.commit(params.id, params.photoId, body.variant));
        return { status: 200, body: { stored: true } };
      },
    },
    {
      method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/cloud/download-url', summary: "A signed URL to download one cloud object. Counted against the project owner's monthly allowance first", auth: 'user', body: Schemas.CloudVariantBody,
      handler: async (req, params) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.CloudVariantBody, req.rawBody);
        // An original is the full file: only those who may export it get it.
        await collab(() => collabCfg().requireMember(params.id, claims.sub, body.variant === 'original' ? 'export' : 'view', params.photoId));
        const cfg = cloudCfg();
        const object = await cloud(() => cfg.store.objectFor(params.id, params.photoId, body.variant));
        const payer = await collab(() => collabCfg().payerOf(params.id));
        const allowance = await cfg.allowance.monthlyMillicredits(payer, now());
        if (!(await cfg.meter.reserve(payer, now(), object.bytes, allowance))) {
          throw new ApiError(402, 'CREDITS_EXHAUSTED', "This project's download allowance for the month is used up. Photos already on your devices keep working.");
        }
        return { status: 200, body: { downloadUrl: await cfg.store.signDownload(params.id, params.photoId, body.variant), bytes: object.bytes, sha256: object.sha256, millicredits: millicreditsForBytes(object.bytes) } };
      },
    },
    {
      method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/cloud/remove', summary: 'Take a photo (or just its original) out of the cloud', auth: 'user', body: Schemas.CloudRemove,
      handler: async (req, params) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.CloudRemove, req.rawBody);
        await collab(() => collabCfg().requireMember(params.id, claims.sub, 'edit', params.photoId));
        await cloudCfg().store.remove(params.id, params.photoId, body.variants ?? CLOUD_VARIANTS);
        return { status: 200, body: { removed: true } };
      },
    },
    {
      method: 'GET', path: '/v1/me/usage', summary: 'This month: cloud downloads you pay for, in credits (1 credit = 1p), and your allowance', auth: 'user',
      handler: async (req) => {
        const claims = await bearer(req);
        const cfg = cloudCfg();
        const used = await cfg.meter.usage(claims.sub, now());
        const allowance = await cfg.allowance.monthlyMillicredits(claims.sub, now());
        // The Account screen's meters: plan, cloud photos this period and the prepaid balance, when those are set up.
        const cloud = options.cloud;
        const pro = await accountIsPro(claims.sub);
        const photos = cloud ? { photosUsed: (await cloud.ledger.periodUsed?.(claims.sub, now(), QUOTA_PERIOD_MS)) ?? 0, photosIncluded: pro ? cloud.jobsPerPeriod : (cloud.basicJobsPerPeriod ?? 0) } : {};
        await settleStorage(claims.sub);
        const balance = options.cloudBalance ? { balanceCredits: (await options.cloudBalance.millicredits(claims.sub)) / 1000 } : {};
        const storedBytes = options.collab ? { storedBytes: await accountStoredBytes(claims.sub) } : {};
        return { status: 200, body: { month: used.month, usedCredits: used.millicredits / 1000, allowanceCredits: allowance / 1000, bytes: used.bytes, downloads: used.downloads, plan: pro ? 'pro' : 'basic', ...photos, ...balance, ...storedBytes } };
      },
    },
    // ---- Team notifications (G20, owner decision 11): the in-app inbox comes first.
    {
      method: 'GET', path: '/v1/collab/notices', summary: 'Your newest notifications from shared projects (reading also marks the app as open, so nothing is emailed meanwhile)', auth: 'user',
      handler: async (req) => {
        const claims = await bearer(req);
        if (!options.notices) throw new ApiError(503, 'COLLAB_NOT_CONFIGURED', 'Notifications are not set up on this server yet.');
        return { status: 200, body: await options.notices.inbox(claims.sub, now()) };
      },
    },
    {
      method: 'POST', path: '/v1/collab/notices/read', summary: 'Mark notifications read (some, or all)', auth: 'user', body: Schemas.NoticesRead,
      handler: async (req) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.NoticesRead, req.rawBody);
        if (!options.notices) throw new ApiError(503, 'COLLAB_NOT_CONFIGURED', 'Notifications are not set up on this server yet.');
        return { status: 200, body: { read: await options.notices.markRead(claims.sub, body.ids, now()) } };
      },
    },
    // ---- Push notifications (G20): only to devices where the person turned alerts on; the inbox above stays the record.
    {
      method: 'GET', path: '/v1/notify/push', summary: 'Whether push is available, which kinds you get, and how many of your devices get them', auth: 'user',
      handler: async (req) => {
        const claims = await bearer(req);
        const push = pushCfg();
        return { status: 200, body: { available: await switchOn('push'), preferences: await push.preferences(claims.sub), devices: (await push.devices(claims.sub)).length } };
      },
    },
    {
      method: 'POST', path: '/v1/notify/push/preferences', summary: 'Choose which kinds of notice are pushed (a kind switched off is not emailed either)', auth: 'user', body: Schemas.PushPreferences,
      handler: async (req) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.PushPreferences, req.rawBody);
        return { status: 200, body: { preferences: await pushCfg().setPreferences(claims.sub, body) } };
      },
    },
    {
      method: 'POST', path: '/v1/notify/push/devices', summary: 'Register this device for alerts (after the person turned them on)', auth: 'user', body: Schemas.PushDevice,
      handler: async (req) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.PushDevice, req.rawBody);
        const push = pushCfg();
        if (!(await switchOn('push'))) throw new ApiError(503, 'PUSH_OFF', 'Alerts are switched off on this server for now. The in-app notifications still work.');
        return { status: 200, body: { devices: await push.register(claims.sub, body.token, body.platform, now()) } };
      },
    },
    {
      method: 'POST', path: '/v1/notify/push/devices/remove', summary: 'Stop alerts on this device (turning them off, or signing out)', auth: 'user', body: Schemas.PushDeviceRemove,
      handler: async (req) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.PushDeviceRemove, req.rawBody);
        return { status: 200, body: { removed: await pushCfg().remove(claims.sub, body.token) } };
      },
    },
    // ---- Email only as the fallback (owner, 25 Nov 2026): the app language for email words, and product news by email,
    // which is off unless the person turns it on.
    {
      method: 'GET', path: '/v1/notify/email', summary: 'Whether InFlight can email you, and whether you asked for product news by email (off unless you turned it on)', auth: 'user',
      handler: async (req) => {
        const claims = await bearer(req);
        const prefs = await contactsCfg().preferences(claims.sub);
        const available = !!options.mailer && (await switchOn('email')) && (await switchOn('product-news'));
        return { status: 200, body: { available, productNews: prefs.productNews } };
      },
    },
    {
      method: 'POST', path: '/v1/notify/email', summary: 'Turn product news by email on or off, and tell the server which language the app is in', auth: 'user', body: Schemas.EmailPreferences,
      handler: async (req) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.EmailPreferences, req.rawBody);
        const contacts = contactsCfg();
        if (body.language) await contacts.setLanguage(claims.sub, body.language);
        if (body.productNews !== undefined) {
          await contacts.setProductNews(claims.sub, body.productNews, now());
          await audit(claims.sub, 'notify.news-email', 'allowed', body.productNews ? 'on' : 'off');
        }
        return { status: 200, body: { productNews: (await contacts.preferences(claims.sub)).productNews } };
      },
    },
    {
      method: 'POST', path: '/v1/collab/projects/:id/presence-token', summary: 'A one-hour token for live cursors in this project only (Realtime Database)', auth: 'user',
      handler: async (req, params) => {
        const claims = await bearer(req);
        const c = await collabWritable();
        if (!options.presence) throw new ApiError(503, 'PRESENCE_NOT_CONFIGURED', 'Live cursors are not set up on this server yet. Everything else works.');
        const view = await collab(() => c.project(params.id, claims.sub));
        const issuedAtS = Math.floor(now() / 1000);
        const uid = presenceUid(claims.sub);
        const token = await options.presence.sign(uid, { p: params.id, r: view.me.role }, issuedAtS);
        return { status: 200, body: { customToken: token, databaseUrl: options.presence.databaseUrl, uid, expiresAtMs: (issuedAtS + PRESENCE_TOKEN_TTL_S) * 1000 } };
      },
    },
    {
      method: 'GET', path: '/v1/collab/projects/:id/audit', summary: 'Owner only: checkout takeovers and overrides', auth: 'user',
      handler: async (req, params) => { const claims = await bearer(req); return { status: 200, body: { entries: await collab(() => collabCfg().auditFor(params.id, claims.sub)) } }; },
    },

    // ---- Client galleries (#1387 C06/C07). Members publish previews; clients open a link with no account.
    {
      method: 'POST', path: '/v1/collab/projects/:id/galleries', summary: 'Publish selected photos to a client gallery link (previews are uploaded next)', auth: 'user', body: Schemas.GalleryCreate,
      handler: async (req, params) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.GalleryCreate, req.rawBody);
        const c = await collabWritable();
        const g = galleryCfg();
        for (const photoId of body.photoIds) await collab(() => c.requireMember(params.id, claims.sub, 'export', photoId));
        const created = await g.create({ ...body, projectId: params.id, createdBy: claims.sub }, now());
        await audit(claims.sub, 'gallery.create', 'allowed', `${params.id}/${created.galleryId.slice(0, 12)}`);
        return { status: 200, body: created };
      },
    },
    {
      method: 'GET', path: '/v1/collab/projects/:id/galleries', summary: 'Client galleries of this project', auth: 'user',
      handler: async (req, params) => {
        const claims = await bearer(req);
        await collab(() => collabCfg().requireMember(params.id, claims.sub, 'export'));
        return { status: 200, body: { galleries: await galleryCfg().list(params.id) } };
      },
    },
    {
      method: 'POST', path: '/v1/collab/galleries/:gid/photos/:photoId/upload-url', summary: 'A short-lived signed URL to upload one sized JPEG preview', auth: 'user', body: Schemas.GalleryPreview,
      handler: async (req, params) => {
        const body = parseJson(Schemas.GalleryPreview, req.rawBody);
        await galleryOwner(req, params.gid);
        return { status: 200, body: { uploadUrl: await gallery(() => galleryCfg().signPreviewUpload(params.gid, params.photoId, body.sha256, body.bytes, body.variant)) } };
      },
    },
    {
      method: 'POST', path: '/v1/collab/galleries/:gid/photos/:photoId/commit', summary: 'Mark an uploaded preview as published', auth: 'user',
      handler: async (req, params) => {
        const { claims, g } = await galleryOwner(req, params.gid);
        const preview = g.previews?.[params.photoId];
        if (!preview) throw new ApiError(404, 'NOT_FOUND', 'Upload the preview first.');
        // Both pictures a client can see are checked before the photo is published.
        for (const variant of preview.thumb ? (['thumb', 'preview'] as const) : (['preview'] as const)) {
          await safetyCheck(req, galleryCfg().storage, { scope: 'gallery', accountId: claims.sub, projectId: g.projectId, galleryId: params.gid, photoId: params.photoId, variant, key: previewKey(params.gid, params.photoId, variant), sha256: '', bytes: 0 });
        }
        await gallery(() => galleryCfg().commitPreview(params.gid, params.photoId));
        return { status: 200, body: { published: true } };
      },
    },
    {
      method: 'GET', path: '/v1/collab/galleries/:gid/feedback', summary: 'Client favourites, comments and approvals', auth: 'user',
      handler: async (req, params) => { await galleryOwner(req, params.gid); return { status: 200, body: await galleryCfg().feedbackFor(params.gid) }; },
    },
    {
      method: 'POST', path: '/v1/collab/galleries/:gid/feedback/review', summary: "Mark one photo's client feedback done or dismissed, or back to new. Never changes a decision", auth: 'user', body: Schemas.GalleryReview,
      handler: async (req, params) => {
        const { member } = await galleryOwner(req, params.gid);
        const body = parseJson(Schemas.GalleryReview, req.rawBody);
        const g = await gallery(() => galleryCfg().get(params.gid));
        if (!g.photoIds.includes(body.itemId.slice('photo:'.length))) throw new ApiError(404, 'NOT_FOUND', 'That photo is not in this gallery.');
        await galleryCfg().review(params.gid, body.itemId, body.state, member.displayName, now());
        return { status: 200, body: { reviewed: true } };
      },
    },
    {
      method: 'POST', path: '/v1/collab/galleries/:gid/revoke', summary: 'Close the link now and delete its previews', auth: 'user',
      handler: async (req, params) => {
        const { claims } = await galleryOwner(req, params.gid);
        await galleryCfg().revoke(params.gid);
        await audit(claims.sub, 'gallery.revoke', 'allowed', params.gid.slice(0, 12));
        return { status: 200, body: { revoked: true } };
      },
    },
    {
      method: 'POST', path: '/v1/gallery/open', summary: 'Open a client gallery from its link (no account). The token is in the page fragment, never the URL path', auth: 'none', body: Schemas.GalleryOpen,
      handler: async (req) => {
        if (!galleryLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
        const body = parseJson(Schemas.GalleryOpen, req.rawBody);
        const { view } = await gallery(() => galleryCfg().open(body.token, body.password, now()));
        return { status: 200, body: view };
      },
    },
    {
      method: 'POST', path: '/v1/gallery/feedback', summary: 'A favourite, comment or approval from a client, when the photographer allows it', auth: 'none', body: Schemas.GalleryFeedback,
      handler: async (req) => {
        if (!galleryLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
        const body = parseJson(Schemas.GalleryFeedback, req.rawBody);
        const g = await gallery(() => galleryCfg().feedback(body.token, body.password, { visitor: body.visitor, photoId: body.photoId, kind: body.kind, text: body.text }, now()));
        // The people who manage this project's galleries hear about it, once per gallery while unread. Never the client.
        if (options.collab && body.kind !== 'unfavourite') await notify(async () => {
          const audience = await options.collab!.audience(g.projectId, 'export');
          return { kind: 'client-feedback', projectId: g.projectId, projectName: audience.projectName, galleryId: g.galleryId, galleryName: g.name, actorName: null, recipients: audience.accountIds };
        });
        return { status: 200, body: { received: true } };
      },
    },
    // ---- Report a gallery (EU DSA Art. 16 notice and action; UK Online Safety Act user reporting). No account needed.
    {
      method: 'POST', path: '/v1/gallery/report', summary: 'Report a client gallery or one photo in it as illegal or against the acceptable use policy. No account needed', auth: 'none', body: Schemas.GalleryReport,
      handler: async (req) => {
        if (!reportLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many reports from here. Wait a few minutes, or email the address on the acceptable use page.', true);
        const body = parseJson(Schemas.GalleryReport, req.rawBody);
        const service = safetyCfg();
        const g = await gallery(() => galleryCfg().get(galleryIdFor(body.token))).catch(() => { throw new ApiError(404, 'GALLERY_NOT_FOUND', 'This gallery link is not valid. Email the address on the acceptable use page instead.'); });
        if (body.photoId !== null && !g.photoIds.includes(body.photoId)) throw new ApiError(404, 'NOT_FOUND', 'That photo is not in this gallery.');
        const { notice, receipt } = await service.addNotice({
          galleryId: g.galleryId, ownerAccountId: g.createdBy, photoId: body.photoId, category: body.category, explanation: body.explanation,
          notifierName: body.name ?? null, notifierEmail: body.email ?? null, goodFaith: true,
        });
        // A report of child sexual abuse takes the gallery down at once while a person reviews it.
        if (body.category === 'child-sexual-abuse') await galleryCfg().setHold(g.galleryId, true);
        await audit('anonymous', 'safety.notice', 'allowed', `${notice.noticeId} ${body.category}${notice.urgent ? ' urgent' : ''}`);
        return { status: 200, body: { noticeId: notice.noticeId, receipt, receivedAtMs: notice.atMs, urgent: notice.urgent } };
      },
    },
    {
      method: 'POST', path: '/v1/gallery/report/status', summary: 'What happened to a report, with the receipt given when it was made', auth: 'none', body: Schemas.GalleryReportStatus,
      handler: async (req) => {
        if (!galleryLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
        const body = parseJson(Schemas.GalleryReportStatus, req.rawBody);
        return { status: 200, body: await safety(() => safetyCfg().noticeStatus(body.noticeId, body.receipt)) };
      },
    },
    // ---- The uploader's side: what was held or acted on, why, and asking for another look (EU DSA Art. 17 and 20).
    {
      method: 'GET', path: '/v1/me/safety', summary: 'Pictures held back from sharing, and actions on my galleries, with the reasons', auth: 'user',
      handler: async (req) => {
        const claims = await bearer(req);
        const service = safetyCfg();
        const actions = (await service.notices()).filter((n) => n.ownerAccountId === claims.sub && n.decision && n.decision.outcome !== 'no-action')
          .map((n) => ({ noticeId: n.noticeId, galleryId: n.galleryId, photoId: n.photoId, category: n.category, outcome: n.decision!.outcome, reason: n.decision!.reason, atMs: n.decision!.atMs }));
        return { status: 200, body: { cases: (await service.cases({ accountId: claims.sub })).map(caseForUploader), actions } };
      },
    },
    {
      method: 'POST', path: '/v1/me/safety/:id/appeal', summary: 'Ask for another look at a picture held by an automatic check', auth: 'user', body: Schemas.SafetyAppeal,
      handler: async (req, params) => {
        const claims = await bearer(req);
        const body = parseJson(Schemas.SafetyAppeal, req.rawBody);
        const c = await safety(() => safetyCfg().appeal(params.id, claims.sub, body.text));
        await audit(claims.sub, 'safety.appeal', 'allowed', c.caseId);
        return { status: 200, body: { case: caseForUploader(c) } };
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
      method: 'GET', path: '/v1/models/manifest', summary: 'The one signed model manifest (the models bucket manifest/stable.json, key kestrel-2026-11), checked here and served unchanged', auth: 'none', response: Schemas.ManifestResponse,
      handler: async (req) => {
        // app and channel are accepted for older clients; there is one manifest, and each app skips what it cannot use.
        const app = req.query.get('app') ?? '0.0.0';
        const channel = req.query.get('channel') ?? 'stable';
        if (!Version.safeParse(app).success || (channel !== 'stable' && channel !== 'beta')) throw new ApiError(400, 'VALIDATION_FAILED', 'Give app as x.y.z and channel as stable or beta.');
        return { status: 200, body: await verifiedModelManifest(), headers: { 'cache-control': 'public, max-age=3600' } };
      },
    },
    {
      method: 'GET', path: '/v1/flags/public', summary: 'Signed feature flags for people without an account: no named users or organisations', auth: 'none', response: Schemas.ManifestResponse,
      handler: async () => ({ status: 200, body: signEnvelope({ schema: 1, flags: forPublicDocument(await loadFlags()) }, config.signingKey), headers: { 'cache-control': 'public, max-age=3600' } }),
    },
    // ---- Safety review. Admins see details only: no route ever returns a held or blocked picture.
    {
      method: 'GET', path: '/v1/admin/safety', summary: 'Safety cases and gallery reports, as metadata only (never the pictures)', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'safety.read');
        const service = options.safety?.service;
        const checks = service ? { hashMatchers: service.checks.hashMatchers.map((m) => m.name), classifier: service.checks.classifier?.name ?? null, reporter: service.checks.reporter !== null } : null;
        return adminDone(claims, 'safety.read', '', {
          checks, publishingRefused: !!options.requireAdminSwitch && !service?.configured,
          cases: service ? (await service.cases()).map(caseSummary) : [],
          notices: service ? (await service.notices()).map(({ receiptHash: _r, ...n }) => n) : [],
        });
      },
    },
    {
      method: 'POST', path: '/v1/admin/safety/cases/:id/decide', summary: 'Release or uphold a picture held by the AI check, from its details only', auth: 'admin', body: Schemas.SafetyDecide,
      handler: async (req, params) => {
        const claims = await admin(req, 'safety.decide');
        const body = parseJson(Schemas.SafetyDecide, req.rawBody);
        const c = await safety(() => safetyCfg().decide(params.id, claims.sub, body.outcome, body.reason));
        return adminDone(claims, 'safety.decide', `${c.caseId} ${c.status}`, { case: caseSummary(c) });
      },
    },
    {
      method: 'POST', path: '/v1/admin/safety/cases/:id/report', summary: 'Send (or retry) the CyberTipline report for a hash match', auth: 'admin',
      handler: async (req, params) => {
        const claims = await admin(req, 'safety.report');
        const storage = options.gallery?.storage;
        if (!storage?.read || !storage.copy) throw new ApiError(503, 'SAFETY_NOT_CONFIGURED', 'The evidence store is not set up on this server.');
        const scannable = { read: storage.read.bind(storage), copy: storage.copy.bind(storage), delete: storage.delete.bind(storage) };
        const c = await safety(() => safetyCfg().report(params.id, scannable));
        return adminDone(claims, 'safety.report', `${c.caseId} ${c.ncmec?.reportId ?? ''}`, { case: caseSummary(c) });
      },
    },
    {
      method: 'POST', path: '/v1/admin/safety/cases/:id/manual-report', summary: 'Record a report made by hand to NCMEC or the NCA', auth: 'admin', body: Schemas.SafetyManualReport,
      handler: async (req, params) => {
        const claims = await admin(req, 'safety.manual-report');
        const body = parseJson(Schemas.SafetyManualReport, req.rawBody);
        const c = await safety(() => safetyCfg().recordManualReport(params.id, claims.sub, body));
        return adminDone(claims, 'safety.manual-report', `${c.caseId} ncmec=${c.ncmec?.reportId ?? ''} nca=${c.nca}`, { case: caseSummary(c) });
      },
    },
    {
      method: 'POST', path: '/v1/admin/safety/notices/:id/decide', summary: 'Act on a gallery report: no action, remove the photo, or revoke the gallery. The reason is shown to the notifier and the gallery owner', auth: 'admin', body: Schemas.SafetyNoticeDecide,
      handler: async (req, params) => {
        const claims = await admin(req, 'safety.notice');
        const body = parseJson(Schemas.SafetyNoticeDecide, req.rawBody);
        const service = safetyCfg();
        const n = await safety(() => service.getNotice(params.id));
        const g = options.gallery;
        if (g) {
          if (body.outcome === 'gallery-revoked') await g.revoke(n.galleryId).catch(() => undefined);
          else {
            if (body.outcome === 'photo-removed') {
              if (!n.photoId) throw new ApiError(400, 'BAD_REQUEST', 'This report is about the whole gallery. Revoke the gallery, or take no action.');
              await g.removePhoto(n.galleryId, n.photoId);
            }
            await g.setHold(n.galleryId, false).catch(() => undefined);
          }
        }
        const decided = await service.decideNotice(n.noticeId, claims.sub, body.outcome, body.reason);
        const { receiptHash: _r, ...view } = decided;
        return adminDone(claims, 'safety.notice', `${n.noticeId} ${body.outcome}`, { notice: view });
      },
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
        // One grant slot is kept for the owned-licence flag (ownedFlags), so a full flag set never makes a buyer's grant too big.
        if (Object.keys(flags).length > MAX_GRANT_FLAGS - 1) throw new ApiError(400, 'VALIDATION_FAILED', `At most ${MAX_GRANT_FLAGS - 1} flags.`);
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
      method: 'GET', path: '/v1/billing/paddle/config', summary: 'Paddle.js settings for the checkout page: environment and client-side token (public by design)', auth: 'none',
      handler: async () => {
        if (!options.paddleClient || !options.proCheckout) throw new ApiError(503, 'CHECKOUT_DISABLED', 'Buying Pro is not open yet.');
        return { status: 200, headers: { 'cache-control': 'no-store' }, body: options.paddleClient };
      },
    },
    {
      method: 'POST', path: '/v1/billing/paddle', summary: 'Paddle notifications (Paddle-Signature). Each transaction or adjustment is fetched back from Paddle before Pro is granted, or removed after a full refund or chargeback.', auth: 'none',
      handler: async (req) => {
        if (!options.settlePaddle || !options.paddleWebhookSecret) throw new ApiError(503, 'PADDLE_NOT_CONFIGURED', 'Paddle payments are not set up.');
        const signature = req.headers['paddle-signature'];
        if (!verifyPaddleSignature(req.rawBody, typeof signature === 'string' ? signature : undefined, options.paddleWebhookSecret, now())) {
          throw new ApiError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Paddle signature missing, wrong or outside the replay window.');
        }
        const event = parseJson(PaddleEvent, req.rawBody);
        // One-off Pro is fulfilled from transactions. Subscriptions (Cloud, Teams) will get their own handler on
        // subscription.* events; until then they are acknowledged and ignored, so Paddle does not retry them.
        if (event.event_type.startsWith('transaction.') && PADDLE_TRANSACTION_ID.test(event.data.id ?? '')) {
          if (!paddleLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Retry this notification shortly.', true);
          try { await options.settlePaddle(event.data.id!); }
          catch { throw new ApiError(503, 'PAYMENT_VERIFICATION_PENDING', 'The payment verification will be retried.', true); }
        }
        // Refunds and chargebacks: a full one removes Pro, a partial one keeps it. Each event is acted on once.
        if ((event.event_type === 'adjustment.created' || event.event_type === 'adjustment.updated') && options.revokePaddle && PADDLE_ADJUSTMENT_ID.test(event.data.id ?? '')) {
          if (!paddleLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Retry this notification shortly.', true);
          let outcome: string;
          try { outcome = await options.revokePaddle(event.event_id, event.data.id!); }
          catch { throw new ApiError(503, 'REFUND_VERIFICATION_PENDING', 'The refund will be checked again when Paddle retries.', true); }
          return { status: 200, body: { received: true, outcome } };
        }
        return { status: 200, body: { received: true } };
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
      method: 'GET', path: '/v1/admin/paddle/key', summary: 'When the Paddle API key was last renewed, when it expires, and how the last weekly check went', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'paddle.key.read');
        if (!options.paddleKeyStatus) throw new ApiError(503, 'PADDLE_NOT_CONFIGURED', 'Paddle key renewal is not set up.');
        const status = await options.paddleKeyStatus();
        return adminDone(claims, 'paddle.key.read', '', {
          rotatedAt: status.current?.rotatedAt ?? null, expiresAt: status.current?.expiresAt ?? null, activated: status.current?.activated ?? null,
          lastRunAt: status.lastRun?.at ?? null, lastRunOk: status.lastRun?.ok ?? null, lastRunReason: status.lastRun?.ok === false ? status.lastRun.reason ?? null : null,
        });
      },
    },
    {
      method: 'GET', path: '/v1/admin/payments', summary: 'Paid checkouts (Paddle) and signed billing events received', auth: 'admin',
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
      method: 'GET', path: '/v1/admin/accounts', summary: 'Read-only month accounts: Paddle payout figures and the cost model\'s estimate of metered spend', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'accounts.read');
        const month = req.query.get('month') ?? new Date(now()).toISOString().slice(0, 7);
        const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
        if (!match || Number(match[1]) < 2020 || Number(match[1]) > 9998) throw new ApiError(400, 'BAD_MONTH', 'Choose a month as YYYY-MM.');
        const monthStartMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, 1);
        const p = options.payments;
        const transactions = !p ? null : p.listTransactionsForMonth
          ? await p.listTransactionsForMonth(month)
          : (await p.listTransactions(1000)).filter((t) => t.supplyDate.startsWith(month));
        const sp = options.spend;
        return adminDone(claims, 'accounts.read', month, {
          month,
          paymentsConnected: transactions !== null,
          transactions: (transactions ?? []).map((t) => ({
            invoiceNumber: t.invoiceNumber, paidAt: t.paidAt, status: t.status, store: t.store ?? null, currency: t.currency,
            netPence: t.netPence, taxPence: t.taxPence, totalPence: t.totalPence, storeFeeMinor: t.storeFeeMinor ?? null,
            buyer: t.buyer ? { currency: t.buyer.currency, totalMinor: t.buyer.totalMinor, taxMinor: t.buyer.taxMinor } : null,
          })),
          costModel: sp ? { reservedPence: await sp.guard.spent(monthStartMs), ceilingPence: sp.ceilingPence } : null,
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
      method: 'GET', path: '/v1/admin/learning', summary: 'Vertex learning batches: what is counted, the month\'s reserved spend against the ceiling, recent runs', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'learning.read');
        const vl = options.vertexLearning;
        if (!vl) throw new ApiError(503, 'LEARNING_NOT_CONFIGURED', 'Vertex learning is not set up on this server.');
        const state = await vl.ledger.state();
        const month = billingMonth(now());
        return adminDone(claims, 'learning.read', '', {
          on: await switchOn('vertex-learning'), newPhotos: state.newPhotos, photoThreshold: vl.config.photoThreshold,
          lastRunAtMs: state.lastRunAtMs, manualRequested: state.manualRequestedAtMs !== null, running: state.runningRunId !== null,
          month, reservedPence: await vl.ledger.monthReservedPence(month), ceilingPence: Math.min(vl.config.ceilingPence, APPROVED_MONTHLY_PENCE),
          runReservePence: reservationPence(vl.config), runs: await vl.ledger.recentRuns(10),
        });
      },
    },
    {
      method: 'POST', path: '/v1/admin/learning/run', summary: 'Learn now: ask for a Vertex learning batch (the spend ceiling and every other check still apply)', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'learning.run');
        const vl = options.vertexLearning;
        if (!vl) throw new ApiError(503, 'LEARNING_NOT_CONFIGURED', 'Vertex learning is not set up on this server.');
        if (!(await switchOn('vertex-learning'))) throw new ApiError(409, 'LEARNING_SWITCHED_OFF', 'Switch on Learning in Vertex AI first.');
        await vl.ledger.requestManualRun(now());
        let started = false;
        if (vl.startJob) { try { await vl.startJob(); started = true; } catch { /* the hourly tick picks the request up */ } }
        return adminDone(claims, 'learning.run', started ? 'started' : 'queued', { requested: true, startedNow: started });
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
      method: 'POST', path: '/v1/admin/cloud-balance', summary: "Add credits to an account's cloud balance (a goodwill grant or a test top-up; 1 credit = 1p)", auth: 'admin',
      body: Schemas.AdminCloudCredit,
      handler: async (req) => {
        const claims = await admin(req, 'cloud.balance');
        const body = parseJson(Schemas.AdminCloudCredit, req.rawBody);
        if (!options.cloudBalance) throw new ApiError(503, 'CLOUD_BALANCE_NOT_CONFIGURED', 'The cloud balance is not set up on this server.');
        if (!(await store.getAccount(body.accountId))) throw new ApiError(404, 'NOT_FOUND', 'No such account.');
        await options.cloudBalance.credit(body.accountId, body.credits * 1000, `admin:${body.reference}`);
        const balanceCredits = (await options.cloudBalance.millicredits(body.accountId)) / 1000;
        return adminDone(claims, 'cloud.balance', `${body.accountId} +${body.credits} ref=${body.reference}`, { balanceCredits });
      },
    },
    {
      method: 'POST', path: '/v1/admin/account-deletions/run', summary: 'Delete every account whose 30 days have passed (daily scheduler; safe to repeat)', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'account.deletion.run');
        const result = await erasureCfg().runDue();
        return adminDone(claims, 'account.deletion.run', `deleted=${result.deleted} failed=${result.failed}`, result);
      },
    },
    {
      method: 'POST', path: '/v1/admin/cloud-storage/settle', summary: "Charge today's cloud storage beyond the free 2.5 GB for every paying account (daily scheduler; safe to repeat)", auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'cloud.storage.settle');
        const cfg = cloudCfg();
        const payers = new Set<string>();
        for (const projectId of await cfg.store.projectIds()) {
          const payer = await options.collab?.payerOf(projectId).catch(() => null);
          if (payer) payers.add(payer);
        }
        const counts = { free: 0, charged: 0, unpaid: 0 };
        for (const accountId of payers) counts[await settleStorage(accountId)]++;
        return adminDone(claims, 'cloud.storage.settle', `accounts=${payers.size} charged=${counts.charged} unpaid=${counts.unpaid}`, counts);
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

  const bodyLimit = (path: string) => /^\/v1\/collab\/projects\/[^/]+\/photos\/[^/]+\/revisions$/.test(path) ? MAX_RECIPE_BYTES + 4096 : path === '/v1/admin/demo/photos' ? 2_300_000 : path.includes('/v1/admin/demo/photos/') ? 850 * 1024 : path.startsWith('/v1/ai/') ? 800 * 1024 : 64 * 1024;

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
        // Per-person rate limits: behind Cloud Run every socket is Google's front end, so use the address it appended.
        ip: (config.trustCloudRunForwardedFor ? cloudRunClientIp(req.headers) : null) ?? req.socket.remoteAddress ?? 'unknown',
      }, found.params);
      send(res, reply, origin);
    } catch (error) {
      if (error instanceof ApiError) {
        send(res, { status: error.status, body: { error: { code: error.code, message: error.message, retryable: error.retryable, ...(error instanceof CollabApiError && error.detail ? { detail: error.detail } : {}) } } }, origin);
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
