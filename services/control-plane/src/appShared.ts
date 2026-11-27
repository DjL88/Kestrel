/** Module-level constants, request schemas and helpers shared by the control-plane app and its route groups. */
import { PRO_PLANS } from './commerce/proCheckout.ts';
import { z } from 'zod';
import { inspectJpeg } from '../../../src/core/jpegInspect.ts';
import type { Config } from './config.ts';
import { type Store } from './store.ts';
import { type AiProvider } from './gateway.ts';
import type { CommerceLedger } from './commerce/ledger.ts';
import type { TransactionRecord } from './commerce/records.ts';
import type { paddleProCheckout } from './commerce/proCheckout.ts';
import { type PaddleEnvironment } from './commerce/paddle.ts';
import { type GoogleKeys } from './googleIdToken.ts';
import { type OidcKeys } from './oidcIdToken.ts';
import { CLOUD_KINDS, RECIPE_INPUT_KINDS, type CloudOptions } from './cloudJobs.ts';
import { LEARNING_ACTIONS, LEARNING_CAPABILITIES, LEARNING_SOURCES, type LearningSink } from './learningSignal.ts';
import { type CollabStore } from './collaboration.ts';
import { CLOUD_VARIANTS, type CloudPhotoStore } from './cloudPhotos.ts';
import { type AllowancePolicy, type UsageMeter } from './usageMeter.ts';
import { FEEDBACK_ITEM_ID } from '../../../src/core/clientFeedback.ts';
import type { NoticeStore } from './notices.ts';
import type { PushService } from './push.ts';
import type { NoticeContacts } from './noticeContacts.ts';
import type { NewsBroadcaster } from './news.ts';
import { PUSH_PLATFORMS, isPushToken } from '../../../src/core/pushNotices.ts';
import { GALLERY_MAX_DAYS, GALLERY_MAX_PHOTOS, GALLERY_MAX_PREVIEW_BYTES, type GalleryStore } from './gallery.ts';
import { COMPLIANCE_MAX_BYTES, COMPLIANCE_TYPES, type ComplianceDocuments } from './complianceDocs.ts';
import { NOTICE_CATEGORIES, type SafetyService } from './contentSafety.ts';
import { type PresenceSigner } from './presenceToken.ts';
import { SAFE_COPY_LEVELS, type SafeCopyOptions } from './safeCopy.ts';
import type { SpendOptions } from './spendGuard.ts';
import { type VertexLearningConfig, type VertexLearningLedger } from './vertexLearning.ts';
import type { Mailer } from './mailer.ts';
import { MAIL_LANGUAGES } from './mailText.ts';
import { ApiError, send, type Request } from './http.ts';

export const MAX_IMAGE_BYTES = 512 * 1024;
export const MAX_IMAGE_EDGE = 1024;
export const DAY_MS = 86_400_000;
export const QUOTA_PERIOD_MS = 30 * DAY_MS;
export const REFRESH_TTL_MS = 30 * DAY_MS;
/**
 * Freeing a device by hand: at most this many per licence in any rolling year (owner, 26 Nov 2026), so one licence is
 * not passed round several people. Automatic swaps of a long-unused device (SWAP_IDLE_DAYS) do not count. Support can
 * reset it (POST /v1/admin/licences/:id/releases/reset).
 */
export const DEVICE_RELEASES_PER_YEAR = 3;
export const YEAR_MS = 365 * 86_400_000;
/** A device unused this long is freed automatically when a new one needs its slot (a phone swap). */
export const SWAP_IDLE_DAYS = 30;
export const offlineDeadline = (licence: { offlineGraceDays: number; validUntilMs: number | null }, now: number) =>
  Math.min(now + licence.offlineGraceDays * DAY_MS, licence.validUntilMs ?? Infinity);

export interface AppOptions {
  config: Config;
  /** Injected for tests: reads the models bucket's manifest/stable.json. Defaults to fetch. */
  manifestFetch?: typeof fetch;
  store?: Store;
  commerce?: Pick<CommerceLedger, 'getTaxSettings' | 'updateTaxSettings' | 'recordTurnover' | 'ossQuarter'>;
  pricing?: Pick<CommerceLedger, 'latestPriceReview'>;
  /** Where the pricing matrix is kept (the commerce ledger). Absent: kept in memory, for development and tests. */
  priceMatrix?: { get(): Promise<unknown>; save(matrix: import('../../../src/core/pricingMatrix.ts').PricingMatrix): Promise<void> };
  /** The Pro subscription prices in Paddle, to check them against the matrix and set them from it. */
  paddlePrices?: {
    priceIds: Partial<Record<'monthly' | 'annual', string>>;
    get(priceId: string): Promise<import('../../../src/core/pricingMatrix.ts').PaddlePriceView>;
    update(priceId: string, body: ReturnType<typeof import('../../../src/core/pricingMatrix.ts').paddlePriceUpdate>): Promise<unknown>;
  };
  /** Today's ECB reference rates per £1 (commerce/priceReview.ts). */
  ecbRates?: () => Promise<{ date: string; perGbp: Record<string, number> }>;
  /** Paid checkouts for the admin console's Payments table (the Firestore commerce ledger). */
  payments?: { listTransactions(limit: number): Promise<TransactionRecord[]>; listTransactionsForMonth?(month: string): Promise<TransactionRecord[]> };
  /** Re-fetches a Paddle transaction and matches it to the server-owned order before granting Pro. */
  settlePaddle?: (transactionId: string, hint?: { subscriptionId?: string }) => Promise<'paid' | 'pending' | 'unknown'>;
  /** Re-fetches a Pro subscription from Paddle and moves its licence's end date to match (commerce/proSettlement.ts). */
  syncPaddleSubscription?: (subscriptionId: string) => Promise<'synced' | 'unknown'>;
  /** Manage or cancel Pro: the account's subscription and Paddle's own pages to cancel it or change the card. */
  managePaddleSubscription?: (accountId: string) => Promise<import('./commerce/proSettlement.ts').SubscriptionManagement | null>;
  /** A full refund or chargeback of a Paddle Pro order removes Pro (commerce/paddleRefunds.ts). Absent: adjustments are acknowledged only. */
  revokePaddle?: (eventId: string, adjustmentId: string) => Promise<import('./commerce/paddleRefunds.ts').RefundOutcome>;
  /** The secret key of the Paddle notification destination (Secret Manager), for Paddle-Signature. */
  paddleWebhookSecret?: string;
  /** Paddle.js settings for the site's checkout page. The client-side token is public by design, but kept out of Git. */
  paddleClient?: { environment: PaddleEnvironment; clientToken: string };
  /** The Paddle API key's renewal record (paddle_key_rotation in Firestore), for the admin console. */
  paddleKeyStatus?: () => Promise<{ current: { rotatedAt: string; expiresAt: string; activated: boolean } | null; lastRun: { at: string; ok: boolean; reason?: string } | null }>;
  /** Server-owned Paddle checkout for Pro; off in production until the admin switches 'pro-checkout' on. */
  proCheckout?: Pick<ReturnType<typeof paddleProCheckout>, 'start' | 'status'> & Partial<Pick<ReturnType<typeof paddleProCheckout>, 'offer'>>;
  /** Server-owned Paddle checkout for cloud top-ups (commerce/topUpCheckout.ts); off until 'cloud-top-ups' is switched on. */
  topUpCheckout?: Pick<ReturnType<typeof import('./commerce/topUpCheckout.ts').paddleTopUps>, 'start' | 'status' | 'amounts'>;
  /** Google's ID-token signing keys. Injected for tests; fetched from Google otherwise. */
  googleKeys?: GoogleKeys;
  firebaseKeys?: OidcKeys;
  /** Apple's signing keys. Tests supply their own; production reads them from Apple. */
  appleKeys?: OidcKeys;
  /** Injected for tests. Defaults to Gemini when a server key is configured, otherwise none. */
  provider?: AiProvider | null;
  now?: () => number;
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
  /** The report-a-gallery queue (contentSafety.ts). InFlight does not scan photos. */
  safety?: { service: SafetyService };
  /** Signed compliance documents (risk assessments) in their own private bucket. Absent: the /admin routes answer 503. */
  compliance?: ComplianceDocuments;
  /** Production sets this: the cloud, safe copy and learning features stay OFF until an admin switches them on. Tests and development leave them on. */
  requireAdminSwitch?: boolean;
}

// ---- Schemas: the contract, also published as OpenAPI ------------------------

export const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
export const Version = z.string().regex(/^\d+\.\d+\.\d+$/);
export const Platform = z.enum(['windows', 'macos', 'web', 'ios', 'android']);
export const ImageBody = z.object({
  image: z.string().min(4).max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8).describe('Base64 JPEG, redrawn so it carries no camera metadata'),
  userConsent: z.boolean().describe('Must be true: the person agreed to send this photo'),
}).strict();
export const AdminTaxSettings = z.object({
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
export const SignedEnvelopeSchema = z.object({ payload: z.unknown(), signature: z.string(), keyId: z.string() });

/** Slider name to value: short identifiers and bounded numbers only, so a free-text field cannot hide in here. */
export const SliderMap = z.record(z.string().regex(/^[a-z][a-zA-Z0-9]{0,23}$/), z.number().finite().min(-100).max(100)).refine((m) => Object.keys(m).length <= 16, 'at most 16 sliders');
export const Sha = z.string().regex(/^[0-9a-f]{64}$/);
/** The app's opaque photo id: never a file name. */
export const PhotoId = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/);
/** An ApiError that also tells the app who holds a photo, or which revision is the head now. */
export class CollabApiError extends ApiError {
  constructor(status: number, code: string, message: string, readonly detail?: Record<string, unknown>) { super(status, code, message); }
}

/**
 * Admin on/off switches. A `planned` switch is designed but not built (owner decisions of 25 Nov 2026, docs/ROADMAP.md):
 * it is listed so the admin console shows the gate, it is never "configured", and so it can never be switched on.
 */
export const SWITCHES = [
  { key: 'managed-ai', label: 'Managed Gemini helper', note: 'Sends one consented, metadata-free thumbnail at a time to Gemini. Counts against the monthly spend ceiling.' },
  { key: 'cloud-processing', label: 'Cloud processing', note: 'Heavier jobs (denoise, upscale, masks) for Pro. Needs the bucket and the runner job set up.' },
  { key: 'safe-copy', label: 'Safe copy (managed backup)', note: 'Opt-in backup to InFlight UK storage. Switching off stops uploads only; people can always read and delete their copy.' },
  { key: 'learning-signal', label: 'Learning signal', note: 'Opt-in anonymous corrections. Switching off stops sharing; opting out and deletion keep working.' },
  { key: 'pro-checkout', label: 'Pro checkout (Paddle)', note: 'People can subscribe to Pro (monthly or annual) through Paddle\'s checkout. Paddle is the merchant of record and handles sales tax and VAT in every country. Switching off stops new checkouts only; payments already made are still verified and granted.' },
  { key: 'cloud-top-ups', label: 'Cloud top-ups (Paddle)', note: 'People can add £5, £10 or £20 to their prepaid cloud balance through Paddle\'s checkout. Switching off stops new top-ups only; payments already made are still verified and credited.' },
  { key: 'email', label: 'App email', note: 'Sends share invitations, and notices or product news only when push cannot reach someone, through Gmail SMTP (a personal Gmail account for now, or Google Workspace). Plain text and HTML, an unsubscribe link in every message, a daily cap under Google\'s limit (450 on Gmail, 500 by default on Workspace; 30 per sender, 3 per recipient). Only verified sign-in addresses are used and none is stored.' },
  { key: 'push', label: 'Push notifications (FCM)', note: 'Sends shared-project notices (comments, client feedback) to the phones and browsers where people turned alerts on. Names and counts only, never comment text or photos. Switching off stops sending and new device sign-ups; the in-app inbox keeps working.' },
  { key: 'product-news', label: 'Product news (updates, new features)', note: 'Lets an administrator send InFlight news from Notifications below: pushed to devices where people turned alerts on and kept "InFlight news" on; emailed only to people who turned on "Email me InFlight news" and could not be reached by push. Off by default.' },
  { key: 'collaboration', label: 'Shared projects', note: 'Cloud subscribers can share a project, invite people by email and check photos out to edit. Switching off stops new shared projects and checkouts; members can still read revisions.' },
  { key: 'vertex-learning', label: 'Learning in Vertex AI (batches)', note: "Trains shared models in Vertex AI from consented shadow files only (measurements, masks, decisions, recipes; never photos). Batches only: 1,000 newly edited photos, weekly when something is new, or Learn now. Each run reserves its worst-case cost first and is refused past the owner's £20 a month. No always-on endpoints." },
  { key: 'pro-cloud-storage', planned: true, label: 'Pro Cloud storage (designed, not built)', note: "Store a project's originals in InFlight's UK cloud to open on any device and share. Opt-in per project; originals on the device are never moved or changed. Cannot be switched on until it is built and the owner approves the cost." },
] as const;
export const SWITCH_KEYS = SWITCHES.map((w) => w.key) as [SwitchKey, ...SwitchKey[]];
export type SwitchKey = typeof SWITCHES[number]['key'];
export const isPlanned = (key: SwitchKey) => SWITCHES.some((w) => w.key === key && 'planned' in w && w.planned);

export const Schemas = {
  AdminSwitch: z.object({ key: z.enum(SWITCH_KEYS), on: z.boolean() }).strict(),
  // Paddle asks the buyer for their country itself. Older apps still send one; it is accepted and ignored.
  // Pro is a subscription, monthly or annual; older apps send no plan and get monthly, the smallest commitment.
  // Paddle asks the buyer for their country itself. Older apps still send one; it is accepted and ignored.
  TopUpCheckoutRequest: z.object({ pence: z.union([z.literal(500), z.literal(1000), z.literal(2000)]) }).strict(),
  ProCheckoutRequest: z.object({ plan: z.enum(PRO_PLANS).default('monthly'), country: z.string().regex(/^[A-Z]{2}$/).optional() }).strict(),
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
  ComplianceUpload: z.object({
    title: z.string().trim().min(1).max(120), fileName: z.string().trim().min(1).max(120),
    contentType: z.enum(Object.keys(COMPLIANCE_TYPES) as [keyof typeof COMPLIANCE_TYPES, ...(keyof typeof COMPLIANCE_TYPES)[]]),
    base64: z.string().min(4).max(Math.ceil(COMPLIANCE_MAX_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  }).strict(),
  SafetyNoticeDecide: z.object({ outcome: z.enum(['no-action', 'photo-removed', 'gallery-revoked']), reason: z.string().trim().min(3).max(1000) }).strict(),
  CloudRemove: z.object({ variants: z.array(z.enum(CLOUD_VARIANTS)).min(1).max(3).optional() }).strict(),
  CollabResolve: z.object({ resolved: z.boolean() }).strict(),
  PushDevice: z.object({ token: z.string().refine(isPushToken, 'not a push token'), platform: z.enum(PUSH_PLATFORMS) }).strict(),
  PushDeviceRemove: z.object({ token: z.string().refine(isPushToken, 'not a push token') }).strict(),
  PushPreferences: z.object({ comments: z.boolean(), clientFeedback: z.boolean(), news: z.boolean() }).partial().strict(),
  EmailPreferences: z.object({ productNews: z.boolean(), productEmail: z.boolean(), language: z.enum(MAIL_LANGUAGES) }).partial().strict(),
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
  BalanceRefunded: z.object({ paddleReference: z.string().trim().min(1).max(80) }).strict(),
  MergeUndoRequest: z.object({ mergeId: z.string().regex(/^mrg_[0-9a-f]{24}$/) }).strict(),
  AccountDevicesRequest: z.object({ deviceHash: Hex64 }).strict(),
  AccountDeviceReleaseRequest: z.object({ deviceHash: Hex64, activationId: z.string().min(1).max(64) }).strict(),
  ActivateResponse: z.object({ grant: SignedEnvelopeSchema, activationId: z.string(), licenceKey: z.string().optional().describe('Signed in, bought outright: the buyer\'s KESTREL1 key, kept on the device') }),
  EntitlementsResponse: z.object({
    plans: z.array(z.object({ licenceId: z.string(), plan: z.string(), status: z.string(), managedAi: z.boolean(), offlineGraceDays: z.number(), majorVersion: z.number(), paid: z.boolean(), source: z.string() })),
    aiQuota: z.object({ requestsUsed: z.number(), requestsLimit: z.number(), periodEndsMs: z.number() }).nullable(),
    /**
     * The account's own standing "use Gemini" choice, set once and kept across devices. Separate from
     * `managedAi` above (whether the plan includes the online helper at all) and from the per-request
     * `userConsent` flag every /v1/ai/* call still carries: this is what lets the app stop asking every time.
     */
    aiConsent: z.boolean(),
    /** True while the account holds a usable contributor grant: the app then offers "Feedback on this". */
    contributor: z.boolean(),
    nextRevalidationMs: z.number(),
  }),
  ContributorFeedback: z.object({
    comment: z.string().trim().min(1).max(2000),
    /** What was right-clicked, described by the app: its role and name, never page HTML. */
    target: z.string().trim().max(300).default(''),
    /** The words shown on that part of the app, so a translation fix can find the string. */
    text: z.string().trim().max(500).default(''),
    screen: z.string().trim().max(120).default(''),
    language: z.string().trim().max(16).regex(/^[A-Za-z-]*$/).default(''),
    appVersion: z.string().trim().max(40).default(''),
  }).strict(),
  CloudJobRequest: z.object({ kind: z.enum(CLOUD_KINDS), inputBytes: z.number().int().positive(), userConsent: z.boolean(), inputKind: z.enum(RECIPE_INPUT_KINDS).optional() }).strict(),
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
    contributor: z.boolean().default(false).describe('A translation contributor: free Pro plus "Feedback on this" in the app.'),
    note: z.string().trim().max(200).optional().describe('Why this was given, e.g. "Camera club prize". Admin-only.'),
    validDays: z.number().int().min(1).max(3650).optional(),
  }).strict(),
  AdminIssue: z.object({
    plan: z.literal('paid'), managedAi: z.boolean().default(false), accountId: z.string().optional(), maxDevices: z.number().int().min(1).max(20).default(5),
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
  /** Quick setup's answers; the route keeps only the fields it knows (src/core/quickSetup.ts). */
  PreferencesRequest: z.object({ setup: z.record(z.string(), z.unknown()) }).strict(),
};

// ---- Small helpers -----------------------------------------------------------

/** Fixed-window limiter, per key. In-process; a multi-instance deployment needs a shared store. */
export class RateLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}
  take(key: string, now: number): boolean {
    const hit = this.hits.get(key);
    if (!hit || now - hit.windowStart >= this.windowMs) { this.hits.set(key, { windowStart: now, count: 1 }); return true; }
    hit.count += 1;
    return hit.count <= this.limit;
  }
}


export function decodeImage(base64: string): Buffer {
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

export const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const MAIL_PAGE_HEADERS = { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" };
/** The small unsubscribe pages, in the recipient's language. */
export const mailPage = (lang: string, title: string, inner: string) => `<!doctype html><html lang="${esc(lang)}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5"><h1>${esc(title)}</h1>${inner}</body></html>`;
