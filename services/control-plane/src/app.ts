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
import { Store } from './db.ts';
import { geminiProvider, identify, suggest, type AiProvider } from './gateway.ts';
import { ApiError, matchRoute, parseJson, readBody, send, type Reply, type Request, type Route } from './http.ts';

export const MAX_IMAGE_BYTES = 512 * 1024;
export const MAX_IMAGE_EDGE = 1024;
const DAY_MS = 86_400_000;
const QUOTA_PERIOD_MS = 30 * DAY_MS;
const REFRESH_TTL_MS = 30 * DAY_MS;

export interface AppOptions {
  config: Config;
  store?: Store;
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
  const { config } = options;
  const store = options.store ?? new Store(config.databasePath);
  const now = options.now ?? Date.now;
  const provider: AiProvider | null = options.provider !== undefined
    ? options.provider
    : config.geminiApiKey ? geminiProvider(config.geminiApiKey, config.geminiModel) : null;
  const authLimiter = new RateLimiter(10, 60_000);
  const activateLimiter = new RateLimiter(20, 60_000);

  function bearer(req: Request): SessionClaims {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new ApiError(401, 'AUTH_REQUIRED', 'Sign in to use this.');
    const check = verifySession(header.slice(7), config.sessionSecret, now());
    if (!check.ok) throw new ApiError(401, check.code, check.code === 'AUTH_TOKEN_EXPIRED' ? 'Your session has ended. Sign in again.' : 'Sign in to use this.');
    const account = store.get<{ status: string; role: string }>('SELECT status, role FROM accounts WHERE account_id = ?', check.claims.sub);
    if (!account || account.status !== 'active') throw new ApiError(401, 'AUTH_TOKEN_INVALID', 'Sign in to use this.');
    return { ...check.claims, role: account.role === 'admin' ? 'admin' : 'user' };
  }

  function issueSession(accountId: string, role: SessionClaims['role']) {
    const refreshToken = randomId(32);
    store.run('INSERT INTO refresh_tokens (token_hash, account_id, expires_at_ms) VALUES (?, ?, ?)', sha256Hex(refreshToken), accountId, now() + REFRESH_TTL_MS);
    return { accessToken: signSession(accountId, role, config.sessionSecret, now()), refreshToken, expiresIn: 900 };
  }

  function createAccount(email: string, password: string, role: 'user' | 'admin'): string {
    const accountId = `acc_${randomId(12)}`;
    try {
      store.run('INSERT INTO accounts (account_id, email_hash, password_hash, role, created_at_ms) VALUES (?, ?, ?, ?, ?)',
        accountId, sha256Hex(email.trim().toLowerCase()), hashPassword(password), role, now());
    } catch { throw new ApiError(409, 'ACCOUNT_EXISTS', 'That account already exists.'); }
    return accountId;
  }

  /** Take one unit of AI allowance, synchronously, or refuse. */
  function reserveQuota(accountId: string): () => void {
    store.transaction(() => {
      const t = now();
      const row = store.get<{ period_start_ms: number; requests_used: number; requests_limit: number }>('SELECT period_start_ms, requests_used, requests_limit FROM ai_usage_quotas WHERE account_id = ?', accountId);
      if (!row) store.run('INSERT INTO ai_usage_quotas (account_id, period_start_ms) VALUES (?, ?)', accountId, t);
      else if (t - row.period_start_ms >= QUOTA_PERIOD_MS) store.run('UPDATE ai_usage_quotas SET period_start_ms = ?, requests_used = 0 WHERE account_id = ?', t, accountId);
      const changed = store.run('UPDATE ai_usage_quotas SET requests_used = requests_used + 1 WHERE account_id = ? AND requests_used < requests_limit', accountId);
      if (changed !== 1) throw new ApiError(429, 'AI_QUOTA_EXHAUSTED', 'This account has used its AI allowance for this period.');
    });
    let refunded = false;
    return () => {
      if (refunded) return;
      refunded = true;
      store.run('UPDATE ai_usage_quotas SET requests_used = MAX(requests_used - 1, 0) WHERE account_id = ?', accountId);
    };
  }

  async function aiCall<T>(req: Request, work: (provider: AiProvider, image: string) => Promise<T>): Promise<T> {
    const claims = bearer(req);
    const body = parseJson(Schemas.ImageRequest, req.rawBody);
    if (body.userConsent !== true) throw new ApiError(400, 'CONSENT_REQUIRED', 'Kestrel needs your permission before sending a photo.');
    decodeImage(body.image);
    if (store.setting('ai_disabled') === '1') throw new ApiError(503, 'AI_DISABLED', 'The online helper is switched off for now.', true);
    if (!provider) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'The online helper is not set up on this server.');
    const entitled = store.get('SELECT 1 FROM licences WHERE account_id = ? AND managed_ai = 1 AND status = \'active\'', claims.sub);
    if (!entitled) throw new ApiError(403, 'AI_NOT_ENTITLED', 'The online helper is not part of this plan.');
    const refund = reserveQuota(claims.sub);
    try {
      return await work(provider, body.image);
    } catch (error) {
      refund(); // A failed answer costs nothing.
      throw error;
    }
  }

  function admin(req: Request, action: string): SessionClaims {
    let claims: SessionClaims;
    try { claims = bearer(req); } catch (error) { store.audit('anonymous', action, 'denied', 'no valid session', now()); throw error; }
    if (claims.role !== 'admin') {
      store.audit(claims.sub, action, 'denied', 'not an admin', now());
      throw new ApiError(403, 'FORBIDDEN', 'This needs an administrator.');
    }
    return claims;
  }

  function adminDone(claims: SessionClaims, action: string, detail: string, body: unknown): Reply {
    store.audit(claims.sub, action, 'allowed', detail, now());
    return { status: 200, body };
  }

  function currentManifest(appVersion: string, channel: string): DataManifest {
    const rows = store.all<{ asset_id: string; kind: string; version: string; path: string; bytes: number; sha256: string; required_app_min: string }>(
      'SELECT asset_id, kind, version, path, bytes, sha256, required_app_min FROM model_assets WHERE status = \'live\' AND channel = ? ORDER BY asset_id', channel);
    const assets = rows.filter((row) => versionAtLeast(appVersion, row.required_app_min))
      .map((row) => ({ id: row.asset_id, kind: row.kind, version: row.version, path: row.path, bytes: row.bytes, sha256: row.sha256 }));
    const manifest = parseDataManifest({ schema: 1, revision: Number(store.setting(`manifest_revision_${channel}`) ?? 1), assets });
    if (!manifest) throw new ApiError(500, 'MANIFEST_INVALID', 'The model registry is in an invalid state.');
    return manifest;
  }

  const routes: Route[] = [
    { method: 'GET', path: '/healthz', summary: 'Liveness', auth: 'none', handler: () => ({ status: 200, body: { ok: true } }) },

    // ---- Identity & licensing
    {
      method: 'POST', path: '/v1/auth/session', summary: 'Sign in; returns a 15-minute access token and a refresh token', auth: 'none',
      body: Schemas.SessionRequest, response: Schemas.SessionResponse,
      handler: (req) => {
        if (!authLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
        const body = parseJson(Schemas.SessionRequest, req.rawBody);
        const account = store.get<{ account_id: string; password_hash: string; role: string; status: string }>(
          'SELECT account_id, password_hash, role, status FROM accounts WHERE email_hash = ?', sha256Hex(body.email.trim().toLowerCase()));
        if (!account || account.status !== 'active' || !verifyPassword(body.password, account.password_hash)) {
          throw new ApiError(401, 'AUTH_FAILED', 'That email and password did not match.');
        }
        return { status: 200, body: issueSession(account.account_id, account.role === 'admin' ? 'admin' : 'user') };
      },
    },
    {
      method: 'POST', path: '/v1/auth/refresh', summary: 'Exchange a refresh token (single use) for a new session', auth: 'none',
      body: Schemas.RefreshRequest, response: Schemas.SessionResponse,
      handler: (req) => {
        const body = parseJson(Schemas.RefreshRequest, req.rawBody);
        const hash = sha256Hex(body.refreshToken);
        const row = store.transaction(() => {
          const found = store.get<{ account_id: string; expires_at_ms: number; revoked: number }>('SELECT account_id, expires_at_ms, revoked FROM refresh_tokens WHERE token_hash = ?', hash);
          if (!found || found.revoked || found.expires_at_ms <= now()) throw new ApiError(401, 'AUTH_TOKEN_EXPIRED', 'Your session has ended. Sign in again.');
          store.run('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?', hash);
          return found;
        });
        const account = store.get<{ role: string; status: string }>('SELECT role, status FROM accounts WHERE account_id = ?', row.account_id);
        if (!account || account.status !== 'active') throw new ApiError(401, 'AUTH_TOKEN_INVALID', 'Sign in to use this.');
        return { status: 200, body: issueSession(row.account_id, account.role === 'admin' ? 'admin' : 'user') };
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
        const { activationId, licence } = store.transaction(() => {
          store.run('INSERT INTO licences (licence_id, plan, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT (licence_id) DO NOTHING', check.details.id, check.details.plan, t);
          const licence = store.get<{ plan: 'paid' | 'subscriber'; status: string; max_devices: number; offline_grace_days: number; managed_ai: number; valid_until_ms: number | null }>(
            'SELECT plan, status, max_devices, offline_grace_days, managed_ai, valid_until_ms FROM licences WHERE licence_id = ?', check.details.id)!;
          if (licence.status === 'revoked' || licence.status === 'expired' || (licence.valid_until_ms !== null && licence.valid_until_ms <= t)) {
            throw new ApiError(403, 'LICENCE_NOT_ACTIVE', 'This licence is no longer active. Your local work is unaffected.');
          }
          const existing = store.get<{ activation_id: string }>('SELECT activation_id FROM device_activations WHERE licence_id = ? AND device_hash = ?', check.details.id, body.deviceHash);
          if (existing) {
            store.run('UPDATE device_activations SET last_seen_ms = ?, app_version = ? WHERE activation_id = ?', t, body.appVersion, existing.activation_id);
            return { activationId: existing.activation_id, licence };
          }
          const used = store.get<{ n: number }>('SELECT COUNT(*) AS n FROM device_activations WHERE licence_id = ?', check.details.id)!.n;
          if (used >= licence.max_devices) throw new ApiError(409, 'DEVICE_LIMIT', `This licence is already active on ${licence.max_devices} devices. Deactivate one first.`);
          const activationId = `act_${randomId(12)}`;
          store.run('INSERT INTO device_activations (activation_id, licence_id, device_hash, platform, app_version, last_seen_ms) VALUES (?, ?, ?, ?, ?, ?)',
            activationId, check.details.id, body.deviceHash, body.platform, body.appVersion, t);
          return { activationId, licence };
        });
        const grant: EntitlementGrant = {
          schema: 1, grantId: `grt_${randomId(12)}`, plan: licence.plan, managedAi: licence.managed_ai === 1,
          deviceHash: body.deviceHash, issuedAtMs: t, offlineUntilMs: t + licence.offline_grace_days * DAY_MS,
        };
        return { status: 200, body: { grant: signEnvelope(grant, config.signingKey), activationId } };
      },
    },
    {
      method: 'GET', path: '/v1/me/entitlements', summary: 'Plans, AI allowance and when to check again', auth: 'user', response: Schemas.EntitlementsResponse,
      handler: (req) => {
        const claims = bearer(req);
        const plans = store.all<{ licence_id: string; plan: string; status: string; managed_ai: number; offline_grace_days: number }>(
          'SELECT licence_id, plan, status, managed_ai, offline_grace_days FROM licences WHERE account_id = ?', claims.sub);
        const quota = store.get<{ requests_used: number; requests_limit: number; period_start_ms: number }>('SELECT requests_used, requests_limit, period_start_ms FROM ai_usage_quotas WHERE account_id = ?', claims.sub);
        return {
          status: 200, body: {
            plans: plans.map((p) => ({ licenceId: p.licence_id, plan: p.plan, status: p.status, managedAi: p.managed_ai === 1, offlineGraceDays: p.offline_grace_days })),
            aiQuota: quota ? { requestsUsed: quota.requests_used, requestsLimit: quota.requests_limit, periodEndsMs: quota.period_start_ms + QUOTA_PERIOD_MS } : null,
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
      handler: (req) => {
        const app = req.query.get('app') ?? '0.0.0';
        const channel = req.query.get('channel') ?? 'stable';
        if (!Version.safeParse(app).success || (channel !== 'stable' && channel !== 'beta')) throw new ApiError(400, 'VALIDATION_FAILED', 'Give app as x.y.z and channel as stable or beta.');
        return { status: 200, body: signEnvelope(currentManifest(app, channel), config.signingKey), headers: { 'cache-control': 'public, max-age=3600' } };
      },
    },
    {
      method: 'GET', path: '/v1/desktop/releases', summary: 'Latest published desktop release, for a notice only (never an auto-update)', auth: 'none', response: Schemas.ReleaseResponse,
      handler: (req) => {
        const platform = req.query.get('platform'), channel = req.query.get('channel') ?? 'stable';
        if ((platform !== 'windows' && platform !== 'macos') || (channel !== 'stable' && channel !== 'beta')) throw new ApiError(400, 'VALIDATION_FAILED', 'Give platform as windows or macos.');
        const rows = store.all<{ version: string; url: string; notes: string; min_supported: string; published_at_ms: number }>(
          'SELECT version, url, notes, min_supported, published_at_ms FROM desktop_releases WHERE platform = ? AND channel = ?', platform, channel);
        const latest = rows.reduce<typeof rows[number] | null>((best, row) => (!best || newerRelease(row.version, best.version) ? row : best), null);
        return {
          status: 200, headers: { 'cache-control': 'public, max-age=900' },
          body: { release: latest ? { version: latest.version, url: latest.url, notes: latest.notes, minSupported: latest.min_supported, publishedAt: new Date(latest.published_at_ms).toISOString() } : null },
        };
      },
    },

    // ---- Billing
    {
      method: 'POST', path: '/v1/billing/webhook', summary: 'Signed, idempotent billing events', auth: 'webhook', body: Schemas.WebhookEvent,
      handler: (req) => {
        const signature = req.headers['kestrel-signature'];
        if (!verifyWebhook(req.rawBody, typeof signature === 'string' ? signature : undefined, config.webhookSecret, now())) {
          throw new ApiError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Webhook signature missing, wrong or outside the replay window.');
        }
        const event = parseJson(Schemas.WebhookEvent, req.rawBody);
        store.transaction(() => {
          const t = now();
          const inserted = store.run('INSERT INTO billing_events (event_id, event_type, received_at_ms) VALUES (?, ?, ?) ON CONFLICT (event_id) DO NOTHING', event.id, event.type, t);
          if (inserted !== 1) throw new ApiError(409, 'WEBHOOK_REPLAYED', 'This event was already processed.');
          const { licenceId, plan, validUntilMs, managedAi } = event.data;
          if (event.type === 'licence.created') {
            store.run('INSERT INTO licences (licence_id, plan, managed_ai, valid_until_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT (licence_id) DO NOTHING',
              licenceId, plan ?? 'paid', managedAi ? 1 : 0, validUntilMs ?? null, t);
          } else if (event.type === 'licence.renewed') {
            store.run('UPDATE licences SET status = \'active\', valid_until_ms = ?, updated_at_ms = ? WHERE licence_id = ?', validUntilMs ?? null, t, licenceId);
          } else {
            store.run('UPDATE licences SET status = \'revoked\', updated_at_ms = ? WHERE licence_id = ?', t, licenceId);
          }
        });
        return { status: 200, body: { received: true } };
      },
    },

    // ---- Admin (every call, allowed or denied, is audited)
    {
      method: 'GET', path: '/v1/admin/overview', summary: 'Counts for the admin console', auth: 'admin',
      handler: (req) => {
        const claims = admin(req, 'overview');
        const count = (sql: string) => store.get<{ n: number }>(sql)!.n;
        return adminDone(claims, 'overview', '', {
          accounts: count('SELECT COUNT(*) AS n FROM accounts'),
          licences: count('SELECT COUNT(*) AS n FROM licences'),
          activations: count('SELECT COUNT(*) AS n FROM device_activations'),
          aiDisabled: store.setting('ai_disabled') === '1',
          aiProvider: provider?.name ?? null,
        });
      },
    },
    {
      method: 'GET', path: '/v1/admin/audit', summary: 'Most recent audit entries', auth: 'admin',
      handler: (req) => {
        const claims = admin(req, 'audit.read');
        return adminDone(claims, 'audit.read', '', { entries: store.all('SELECT at_ms, actor, action, outcome, detail FROM audit_log ORDER BY at_ms DESC LIMIT 200') });
      },
    },
    {
      method: 'POST', path: '/v1/admin/accounts', summary: 'Create an account', auth: 'admin', body: Schemas.AdminAccount,
      handler: (req) => {
        const claims = admin(req, 'account.create');
        const body = parseJson(Schemas.AdminAccount, req.rawBody);
        const accountId = createAccount(body.email, body.password, body.role);
        return adminDone(claims, 'account.create', `${accountId} role=${body.role}`, { accountId });
      },
    },
    {
      method: 'POST', path: '/v1/admin/licences/issue', summary: 'Issue a signed KESTREL1 licence key', auth: 'admin', body: Schemas.AdminIssue,
      handler: (req) => {
        const claims = admin(req, 'licence.issue');
        const body = parseJson(Schemas.AdminIssue, req.rawBody);
        if (!config.licencePrivateKey) throw new ApiError(503, 'LICENCE_SIGNING_UNAVAILABLE', 'This server cannot issue licence keys.');
        const id = randomId(12);
        const details = Buffer.from(JSON.stringify({ v: 1, plan: 'paid', id, issuedAt: now() }));
        const key = `KESTREL1.${details.toString('base64url')}.${crypto.sign(null, details, config.licencePrivateKey).toString('base64url')}`;
        store.run('INSERT INTO licences (licence_id, account_id, plan, managed_ai, max_devices, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)',
          id, body.accountId ?? null, body.plan, body.managedAi ? 1 : 0, body.maxDevices, now());
        return adminDone(claims, 'licence.issue', `${id} plan=${body.plan}`, { licenceId: id, licenceKey: key });
      },
    },
    {
      method: 'POST', path: '/v1/admin/licences/:id/revoke', summary: 'Revoke a licence (stops new activations; never touches local work)', auth: 'admin',
      handler: (req, params) => {
        const claims = admin(req, 'licence.revoke');
        const changed = store.run('UPDATE licences SET status = \'revoked\', updated_at_ms = ? WHERE licence_id = ?', now(), params.id);
        if (!changed) throw new ApiError(404, 'NOT_FOUND', 'No such licence.');
        return adminDone(claims, 'licence.revoke', params.id, { revoked: true });
      },
    },
    {
      method: 'POST', path: '/v1/admin/licences/:id/extend', summary: 'Extend a trial or validity window', auth: 'admin', body: Schemas.AdminExtend,
      handler: (req, params) => {
        const claims = admin(req, 'licence.extend');
        const body = parseJson(Schemas.AdminExtend, req.rawBody);
        const row = store.get<{ valid_until_ms: number | null }>('SELECT valid_until_ms FROM licences WHERE licence_id = ?', params.id);
        if (!row) throw new ApiError(404, 'NOT_FOUND', 'No such licence.');
        const until = Math.max(row.valid_until_ms ?? now(), now()) + body.days * DAY_MS;
        store.run('UPDATE licences SET valid_until_ms = ?, status = \'active\', updated_at_ms = ? WHERE licence_id = ?', until, now(), params.id);
        return adminDone(claims, 'licence.extend', `${params.id} +${body.days}d`, { validUntilMs: until });
      },
    },
    {
      method: 'POST', path: '/v1/admin/ai/killswitch', summary: 'Switch the managed AI gateway off or on', auth: 'admin', body: Schemas.AdminKillSwitch,
      handler: (req) => {
        const claims = admin(req, 'ai.killswitch');
        const body = parseJson(Schemas.AdminKillSwitch, req.rawBody);
        store.setSetting('ai_disabled', body.aiDisabled ? '1' : '0');
        return adminDone(claims, 'ai.killswitch', `disabled=${body.aiDisabled}`, { aiDisabled: body.aiDisabled });
      },
    },
    {
      method: 'POST', path: '/v1/admin/ai/quota', summary: 'Set an account\'s AI allowance', auth: 'admin', body: Schemas.AdminQuota,
      handler: (req) => {
        const claims = admin(req, 'ai.quota');
        const body = parseJson(Schemas.AdminQuota, req.rawBody);
        store.run('INSERT INTO ai_usage_quotas (account_id, period_start_ms, requests_limit) VALUES (?, ?, ?) ON CONFLICT (account_id) DO UPDATE SET requests_limit = excluded.requests_limit',
          body.accountId, now(), body.requestsLimit);
        return adminDone(claims, 'ai.quota', `${body.accountId} limit=${body.requestsLimit}`, { requestsLimit: body.requestsLimit });
      },
    },
    {
      method: 'POST', path: '/v1/admin/models', summary: 'Register a model or data file as a candidate', auth: 'admin', body: Schemas.AdminModel,
      handler: (req) => {
        const claims = admin(req, 'model.register');
        const body = parseJson(Schemas.AdminModel, req.rawBody);
        // The client's own parser is the gate: anything it would reject (traversal, absolute paths, bad ids) is refused here too.
        if (!parseDataManifest({ schema: 1, revision: 1, assets: [{ id: body.id, kind: body.kind, version: body.version, path: body.path, bytes: body.bytes, sha256: body.sha256 }] })) {
          store.audit(claims.sub, 'model.register', 'denied', `invalid asset ${JSON.stringify(body.id).slice(0, 80)}`, now());
          throw new ApiError(400, 'ASSET_INVALID', 'Asset id, version or path is not allowed (paths must be /data/..., with no ".." or absolute paths).');
        }
        store.run('INSERT INTO model_assets (asset_id, kind, version, channel, path, sha256, bytes, required_app_min, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          body.id, body.kind, body.version, body.channel, body.path, body.sha256, body.bytes, body.requiredAppMin, now());
        return adminDone(claims, 'model.register', `${body.id}@${body.version} ${body.channel}`, { status: 'candidate' });
      },
    },
    {
      method: 'POST', path: '/v1/admin/models/promote', summary: 'Make one version live (also how rollback works: promote the older one)', auth: 'admin', body: Schemas.AdminPromote,
      handler: (req) => {
        const claims = admin(req, 'model.promote');
        const body = parseJson(Schemas.AdminPromote, req.rawBody);
        store.transaction(() => {
          const exists = store.get('SELECT 1 FROM model_assets WHERE asset_id = ? AND version = ? AND channel = ?', body.id, body.version, body.channel);
          if (!exists) throw new ApiError(404, 'NOT_FOUND', 'No such model version.');
          store.run('UPDATE model_assets SET status = \'retired\' WHERE asset_id = ? AND channel = ? AND status = \'live\'', body.id, body.channel);
          store.run('UPDATE model_assets SET status = \'live\' WHERE asset_id = ? AND version = ? AND channel = ?', body.id, body.version, body.channel);
          store.setSetting(`manifest_revision_${body.channel}`, String(Number(store.setting(`manifest_revision_${body.channel}`) ?? 1) + 1));
        });
        return adminDone(claims, 'model.promote', `${body.id}@${body.version} ${body.channel}`, { live: true });
      },
    },
    {
      method: 'POST', path: '/v1/admin/releases', summary: 'Publish a desktop release notice', auth: 'admin', body: Schemas.AdminRelease,
      handler: (req) => {
        const claims = admin(req, 'release.publish');
        const body = parseJson(Schemas.AdminRelease, req.rawBody);
        const url = new URL(body.url);
        if (url.protocol !== 'https:' || !config.releaseHosts.includes(url.hostname) || url.username || url.password) {
          store.audit(claims.sub, 'release.publish', 'denied', `host ${url.hostname}`, now());
          throw new ApiError(400, 'RELEASE_URL_NOT_ALLOWED', `Release links must be https on ${config.releaseHosts.join(', ')}.`);
        }
        store.run('INSERT INTO desktop_releases (platform, channel, version, url, notes, min_supported, published_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
          body.platform, body.channel, body.version, url.toString(), body.notes, body.minSupported, now());
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
