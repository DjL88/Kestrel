import type { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { EntitlementGrant } from '../../../src/core/entitlementGrant.ts';
import { parseDataManifest, type DataManifest } from '../../../src/core/dataUpdateManifest.ts';
import { verifyLicence } from '../../../src/core/licence.ts';
import { newerRelease } from '../../../src/core/desktopRelease.ts';
import { inspectJpeg } from '../../../src/core/jpegInspect.ts';
import type { Config } from './config.ts';
import { hashPassword, randomId, sha256Hex, signEnvelope, signSession, uuid, verifyPassword, verifySession, verifyWebhook, type SessionClaims } from './crypto.ts';
import { SqliteStore } from './sqliteStore.ts';
import { newLicence, type AuditRecord, type Store } from './store.ts';
import { geminiProvider, identify, suggest, type AiProvider } from './gateway.ts';
import type { CommerceLedger } from './commerce/ledger.ts';
import { UK_VAT_THRESHOLD_PENCE, UK_VAT_WARNING_PENCE } from './commerce/turnover.ts';
import { ApiError, matchRoute, parseJson, readBody, send, type Reply, type Request, type Route } from './http.ts';

export const MAX_IMAGE_BYTES = 512 * 1024;
export const MAX_IMAGE_EDGE = 1024;
const DAY_MS = 86_400_000;
const QUOTA_PERIOD_MS = 30 * DAY_MS;
const REFRESH_TTL_MS = 30 * DAY_MS;

export interface AppOptions {
  config: Config;
  store?: Store;
  commerce?: Pick<CommerceLedger, 'getTaxSettings' | 'updateTaxSettings' | 'recordTurnover' | 'ossQuarter'>;
  /** Injected for tests. Defaults to Gemini when a server key is configured, otherwise none. */
  provider?: AiProvider | null;
  now?: () => number;
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

export const Schemas = {
  SessionRequest: z.object({ email: z.string().email().max(254), password: z.string().min(8).max(200) }).strict(),
  RefreshRequest: z.object({ refreshToken: z.string().min(20).max(200) }).strict(),
  SessionResponse: z.object({ accessToken: z.string(), refreshToken: z.string(), expiresIn: z.number() }),
  ActivateRequest: z.object({ licenceKey: z.string().min(10).max(2000), deviceHash: Hex64, platform: Platform, appVersion: Version }).strict(),
  ActivateResponse: z.object({ grant: SignedEnvelopeSchema, activationId: z.string() }),
  EntitlementsResponse: z.object({
    plans: z.array(z.object({ licenceId: z.string(), plan: z.string(), status: z.string(), managedAi: z.boolean(), offlineGraceDays: z.number() })),
    aiQuota: z.object({ requestsUsed: z.number(), requestsLimit: z.number(), periodEndsMs: z.number() }).nullable(),
    nextRevalidationMs: z.number(),
  }),
  ImageRequest: ImageBody,
  IdentifyResponse: z.object({ kind: z.string(), species: z.string().nullable(), scientific: z.string().nullable(), confidence: z.enum(['high', 'medium', 'low']), tags: z.array(z.string()), abstained: z.boolean() }),
  SuggestResponse: z.object({ proposal: z.record(z.string(), z.number()), alreadyBalanced: z.boolean() }),
  ManifestResponse: SignedEnvelopeSchema,
  ReleaseResponse: z.object({ release: z.object({ version: z.string(), url: z.string(), notes: z.string(), minSupported: z.string(), publishedAt: z.string() }).nullable() }),
  WebhookEvent: z.object({
    id: z.string().min(1).max(128),
    type: z.enum(['licence.created', 'licence.renewed', 'licence.revoked']),
    data: z.object({ licenceId: z.string().min(1).max(64), plan: z.enum(['paid', 'subscriber']).optional(), validUntilMs: z.number().int().optional(), managedAi: z.boolean().optional() }).strict(),
  }).strict(),
  AdminAccount: z.object({ email: z.string().email(), password: z.string().min(12).max(200), role: z.enum(['user', 'admin']) }).strict(),
  AdminIssue: z.object({ plan: z.enum(['paid', 'subscriber']), managedAi: z.boolean().default(false), accountId: z.string().optional(), maxDevices: z.number().int().min(1).max(20).default(3) }).strict(),
  AdminExtend: z.object({ days: z.number().int().min(1).max(365) }).strict(),
  AdminKillSwitch: z.object({ aiDisabled: z.boolean() }).strict(),
  AdminQuota: z.object({ accountId: z.string(), requestsLimit: z.number().int().min(0).max(1_000_000) }).strict(),
  AdminModel: z.object({
    id: z.string(), kind: z.enum(['onnx', 'species-library', 'equipment']), version: z.string(), path: z.string(),
    sha256: Hex64, bytes: z.number().int().positive(), requiredAppMin: Version.default('0.0.0'), channel: z.enum(['stable', 'beta']).default('stable'),
  }).strict(),
  AdminPromote: z.object({ id: z.string(), version: z.string(), channel: z.enum(['stable', 'beta']).default('stable') }).strict(),
  AdminRelease: z.object({ platform: z.enum(['windows', 'macos']), channel: z.enum(['stable', 'beta']).default('stable'), version: Version, url: z.string().url(), notes: z.string().max(4000).default(''), minSupported: Version.default('0.0.0') }).strict(),
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
  if (facts.hasMetadata) throw new ApiError(400, 'IMAGE_HAS_METADATA', 'The image still carries camera metadata (EXIF or XMP), which can include location. Kestrel only sends redrawn images.');
  return bytes;
}

// ---- The application -----------------------------------------------------------

export function createApp(options: AppOptions) {
  const { config, commerce } = options;
  if (!options.store && config.store !== 'sqlite') throw new Error('Open the Firestore store with openStore() and pass it in.');
  const store: Store = options.store ?? new SqliteStore(config.databasePath);
  const now = options.now ?? Date.now;
  const provider: AiProvider | null = options.provider !== undefined
    ? options.provider
    : config.geminiApiKey ? geminiProvider(config.geminiApiKey, config.geminiModel) : null;
  const authLimiter = new RateLimiter(10, 60_000);
  const activateLimiter = new RateLimiter(20, 60_000);

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

  async function createAccount(email: string, password: string, role: 'user' | 'admin'): Promise<string> {
    const accountId = `acc_${randomId(12)}`;
    const created = await store.createAccount({ accountId, emailHash: sha256Hex(email.trim().toLowerCase()), passwordHash: hashPassword(password), role, status: 'active', createdAtMs: now() });
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

  async function aiCall<T>(req: Request, work: (provider: AiProvider, image: string) => Promise<T>): Promise<T> {
    const claims = await bearer(req);
    const body = parseJson(Schemas.ImageRequest, req.rawBody);
    if (body.userConsent !== true) throw new ApiError(400, 'CONSENT_REQUIRED', 'Kestrel needs your permission before sending a photo.');
    decodeImage(body.image);
    if ((await store.getSetting('ai_disabled')) === '1') throw new ApiError(503, 'AI_DISABLED', 'The online helper is switched off for now.', true);
    if (!provider) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'The online helper is not set up on this server.');
    if (!(await store.hasActiveManagedAi(claims.sub))) throw new ApiError(403, 'AI_NOT_ENTITLED', 'The online helper is not part of this plan.');
    const refund = await reserveQuota(claims.sub);
    try {
      return await work(provider, body.image);
    } catch (error) {
      await refund(); // A failed answer costs nothing.
      throw error;
    }
  }

  async function admin(req: Request, action: string): Promise<SessionClaims> {
    let claims: SessionClaims;
    try { claims = await bearer(req); } catch (error) { await audit('anonymous', action, 'denied', 'no valid session'); throw error; }
    if (claims.role !== 'admin') {
      await audit(claims.sub, action, 'denied', 'not an admin');
      throw new ApiError(403, 'FORBIDDEN', 'This needs an administrator.');
    }
    return claims;
  }

  async function adminDone(claims: SessionClaims, action: string, detail: string, body: unknown): Promise<Reply> {
    await audit(claims.sub, action, 'allowed', detail);
    return { status: 200, body };
  }

  async function currentManifest(appVersion: string, channel: string): Promise<DataManifest> {
    const rows = await store.listLiveModelAssets(channel);
    const assets = rows.filter((row) => versionAtLeast(appVersion, row.requiredAppMin))
      .map((row) => ({ id: row.assetId, kind: row.kind, version: row.version, path: row.path, bytes: row.bytes, sha256: row.sha256 }));
    const manifest = parseDataManifest({ schema: 1, revision: Number((await store.getSetting(`manifest_revision_${channel}`)) ?? 1), assets });
    if (!manifest) throw new ApiError(500, 'MANIFEST_INVALID', 'The model registry is in an invalid state.');
    return manifest;
  }

  const routes: Route[] = [
    { method: 'GET', path: '/healthz', summary: 'Liveness', auth: 'none', handler: () => ({ status: 200, body: { ok: true } }) },

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
          deviceHash: body.deviceHash, issuedAtMs: t, offlineUntilMs: t + licence.offlineGraceDays * DAY_MS,
        };
        return { status: 200, body: { grant: signEnvelope(grant, config.signingKey), activationId } };
      },
    },
    {
      method: 'GET', path: '/v1/me/entitlements', summary: 'Plans, AI allowance and when to check again', auth: 'user', response: Schemas.EntitlementsResponse,
      handler: async (req) => {
        const claims = await bearer(req);
        const plans = await store.listLicencesForAccount(claims.sub);
        const quota = await store.getQuota(claims.sub);
        return {
          status: 200, body: {
            plans: plans.map((p) => ({ licenceId: p.licenceId, plan: p.plan, status: p.status, managedAi: p.managedAi, offlineGraceDays: p.offlineGraceDays })),
            aiQuota: quota ? { requestsUsed: quota.requestsUsed, requestsLimit: quota.requestsLimit, periodEndsMs: quota.periodStartMs + QUOTA_PERIOD_MS } : null,
            nextRevalidationMs: now() + 7 * DAY_MS,
          },
        };
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
      method: 'GET', path: '/v1/admin/overview', summary: 'Counts for the admin console', auth: 'admin',
      handler: async (req) => {
        const claims = await admin(req, 'overview');
        return adminDone(claims, 'overview', '', {
          ...(await store.counts()),
          aiDisabled: (await store.getSetting('ai_disabled')) === '1',
          aiProvider: provider?.name ?? null,
          store: store.kind,
        });
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
      method: 'POST', path: '/v1/admin/licences/issue', summary: 'Issue a signed KESTREL1 licence key', auth: 'admin', body: Schemas.AdminIssue,
      handler: async (req) => {
        const claims = await admin(req, 'licence.issue');
        const body = parseJson(Schemas.AdminIssue, req.rawBody);
        if (!config.licencePrivateKey) throw new ApiError(503, 'LICENCE_SIGNING_UNAVAILABLE', 'This server cannot issue licence keys.');
        if (body.accountId && !(await store.getAccount(body.accountId))) throw new ApiError(404, 'NOT_FOUND', 'No such account.');
        const id = randomId(12);
        const details = Buffer.from(JSON.stringify({ v: 1, plan: 'paid', id, issuedAt: now() }));
        const key = `KESTREL1.${details.toString('base64url')}.${crypto.sign(null, details, config.licencePrivateKey).toString('base64url')}`;
        await store.insertLicence(newLicence(id, body.plan, now(), { accountId: body.accountId ?? null, managedAi: body.managedAi, maxDevices: body.maxDevices }));
        return adminDone(claims, 'licence.issue', `${id} plan=${body.plan}`, { licenceId: id, licenceKey: key });
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
        const inserted = await store.insertModelAsset({
          assetId: body.id, kind: body.kind, version: body.version, channel: body.channel, path: body.path, sha256: body.sha256,
          bytes: body.bytes, requiredAppMin: body.requiredAppMin, status: 'candidate', createdAtMs: now(),
        });
        if (!inserted) throw new ApiError(409, 'ASSET_EXISTS', 'That version is already registered. Give it a new version.');
        return adminDone(claims, 'model.register', `${body.id}@${body.version} ${body.channel}`, { status: 'candidate' });
      },
    },
    {
      method: 'POST', path: '/v1/admin/models/promote', summary: 'Make one version live (also how rollback works: promote the older one)', auth: 'admin', body: Schemas.AdminPromote,
      handler: async (req) => {
        const claims = await admin(req, 'model.promote');
        const body = parseJson(Schemas.AdminPromote, req.rawBody);
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

  const bodyLimit = (path: string) => (path.startsWith('/v1/ai/') ? 800 * 1024 : 64 * 1024);

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
    info: { title: 'Kestrel control plane', version: '1', description: 'Optional online services. Kestrel works fully offline without them.' },
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, webhookSignature: { type: 'apiKey', in: 'header', name: 'kestrel-signature' } } },
    paths,
  };
}

export { uuid };
