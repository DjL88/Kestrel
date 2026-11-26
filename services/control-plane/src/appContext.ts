/** Everything the control-plane routes share: the store, limiters, sign-in, quotas and service gates. Built once per app. */
import type { AppOptions } from './appShared.ts';
import { freeStorageFor, settleStorageDay } from './cloudStorageBilling.ts';
import { OWNED_GRANT_FLAG, type EntitlementGrant } from '../../../src/core/entitlementGrant.ts';
import { parseFlagSet, resolveFlagsForGrant, type Audience, type FlagSet } from '../../../src/core/featureFlags.ts';
import { openSignedDataManifest } from '../../../src/core/modelDelivery.ts';
import { MergeRefusal } from './accountMerge.ts';
import { ErasureRefusal } from './accountErasure.ts';
import { learningSubjectFor } from './learningSignal.ts';
import { hashPassword, randomId, sha256Hex, signSession, uuid, verifySession, type SessionClaims } from './crypto.ts';
import { SqliteStore } from './sqliteStore.ts';
import { MemoryDemoStudio, type DemoStudioStore } from './demoStudio.ts';
import { ownsLicence } from './licenceKeys.ts';
import { licenceIsUsable, type AuditRecord, type LicenceRecord, type Store } from './store.ts';
import { geminiProvider, type AiProvider } from './gateway.ts';
import { googleKeysFromNetwork, GOOGLE_CERTS_URL } from './googleIdToken.ts';
import { APPLE_ISSUER, APPLE_KEYS_URL, FIREBASE_KEYS_URL, firebaseIssuer, oidcKeysFromNetwork, verifyOidcIdToken, type OidcKeys } from './oidcIdToken.ts';
import { type CloudJobRecord, type CloudOptions } from './cloudJobs.ts';
import { CollabRefusal, type CollabStore } from './collaboration.ts';
import { CloudRefusal } from './cloudPhotos.ts';
import type { PushService } from './push.ts';
import type { NoticeContacts } from './noticeContacts.ts';
import type { NoticeEvent } from '../../../src/core/collabNotices.ts';
import { GalleryRefusal, type GalleryStore } from './gallery.ts';
import { SafetyRefusal, BLOCKED_MESSAGE, HELD_MESSAGE, type CheckInput, type SafetyService } from './contentSafety.ts';
import { SAFE_COPY_LEVELS } from './safeCopy.ts';
import { ApiError, parseJson, type Reply, type Request, type Route } from './http.ts';
import { DAY_MS, QUOTA_PERIOD_MS, REFRESH_TTL_MS, DEVICE_RELEASES_PER_YEAR, YEAR_MS, SWAP_IDLE_DAYS, CollabApiError, SwitchKey, isPlanned, Schemas, RateLimiter, decodeImage } from './appShared.ts';

export function createContext(options: AppOptions) {
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
    // Recipe jobs (x-std-cloud-recipe): their own switch, off by default, and they must say which picture they carry.
    if (body.kind === 'recipe') {
      if (!cloud.recipe?.enabled) {
        await audit(claims.sub, 'cloud.job.create', 'denied', 'recipe off');
        throw new ApiError(503, 'CLOUD_RECIPE_DISABLED', 'Cloud edit settings are switched off for now. Nothing was uploaded.');
      }
      if (!body.inputKind) throw new ApiError(400, 'CLOUD_RECIPE_INPUT_KIND', 'Say whether this is the smart preview or the original.');
      if (body.inputKind === 'smart-preview' && body.inputBytes > cloud.recipe.maxPreviewBytes) {
        throw new ApiError(413, 'CLOUD_INPUT_TOO_LARGE', 'This is larger than a smart preview can be.');
      }
    } else if (body.inputKind) throw new ApiError(400, 'CLOUD_RECIPE_INPUT_KIND', 'Only cloud edit-settings jobs carry an input kind.');
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
        ...(body.kind === 'recipe' && body.inputKind ? { inputKind: body.inputKind } : {}),
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

  /** Hand-made device frees for this licence within the last year, oldest first (setting `device-releases:<id>`). */
  async function recentReleases(licenceId: string, at: number): Promise<number[]> {
    let list: unknown = [];
    try { list = JSON.parse((await store.getSetting(`device-releases:${licenceId}`)) ?? '[]'); } catch { /* damaged: treat as none */ }
    return (Array.isArray(list) ? list : []).filter((t): t is number => Number.isSafeInteger(t) && t > at - YEAR_MS && t <= at).sort((a, b) => a - b);
  }

  /** Free a device by hand, within the yearly allowance. Kind words when it is used up; support can reset it. */
  async function releaseWithinAllowance(licenceId: string, activationId: string, at: number): Promise<boolean> {
    const recent = await recentReleases(licenceId, at);
    if (recent.length >= DEVICE_RELEASES_PER_YEAR) {
      const next = new Date(recent[0]! + YEAR_MS).toISOString().slice(0, 10);
      throw new ApiError(429, 'RELEASE_LIMIT', `You have already moved Pro between devices ${DEVICE_RELEASES_PER_YEAR} times this year, which is the most one licence allows. Another move opens on ${next}. A device you have not used for 30 days is still freed for you when you add a new one, and if you need help sooner, contact support and we will sort it out.`);
    }
    if (!(await store.deactivateDevice(activationId))) return false;
    await store.setSetting(`device-releases:${licenceId}`, JSON.stringify([...recent, at]));
    return true;
  }

  /**
   * Activate a device, with grace for a swap (a new phone replacing an old one): when every slot is taken, the device
   * that has gone longest unseen is freed, but only if it has not been used for SWAP_IDLE_DAYS. Anything else is the
   * device limit, and the person frees a device in Settings.
   */
  async function activateWithSwapGrace(request: Parameters<Store['activateDevice']>[0], accountId: string | null) {
    const first = await store.activateDevice(request);
    if (first.ok || first.reason !== 'device_limit') return first;
    const idle = (await store.listActivationsForLicence(request.licenceId))
      .filter((d) => d.deviceHash !== request.deviceHash && request.nowMs - d.lastSeenMs >= SWAP_IDLE_DAYS * DAY_MS)
      .sort((a, b) => a.lastSeenMs - b.lastSeenMs)[0];
    if (!idle || !(await store.deactivateDevice(idle.activationId))) return first;
    await audit(accountId, 'device.release.idle', 'allowed', `${idle.activationId} unseen ${Math.floor((request.nowMs - idle.lastSeenMs) / DAY_MS)}d`);
    return store.activateDevice(request);
  }

  /**
   * Bought outright (a verified one-off payment that never expires): mark the grant so the app keeps Pro on that
   * device for good, even if this service is down or gone (src/core/entitlementGrant.ts grantIsOwned). Always decided
   * here, never by an admin flag of the same name, so a gift or a flag rule cannot claim it.
   */
  function ownedFlags(licence: LicenceRecord, base: Pick<EntitlementGrant, 'flags'>): Pick<EntitlementGrant, 'flags'> {
    const owned = ownsLicence(licence);
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

  return { options, config, commerce, store, demoStudio, now, provider, authLimiter, contactLimiter, contactGlobalLimiter, googleKeys, appleKeys, firebaseKeys, userGoogleKeys, adminEmailHashes, activateLimiter, paddleLimiter, checkoutLimiter, galleryLimiter, reportLimiter, audit, bearer, issueSession, signInWithProvider, providerRoute, createAccount, reserveQuota, switchConfigured, switchOn, reserveSpend, aiCall, cloudGate, accountIsPro, cloudJobStart, cloudJobOwned, settleFailedCloudJob, learningSubject, collabCfg, collabWritable, collab, accountStoredBytes, settleStorage, cloudCfg, cloud, notify, pushCfg, news, contactsCfg, erasureCfg, erasing, deletionBody, mergeCfg, merging, galleryCfg, gallery, galleryOwner, safetyCfg, safety, safetyCheck, safeCopyCfg, safeCopyUploadGate, admin, adminDone, FLAGS_SETTING, loadFlags, grantFlagsFor, recentReleases, releaseWithinAllowance, activateWithSwapGrace, ownedFlags, MANIFEST_CACHE_MS, verifiedModelManifest, effectiveAccountLicence };
}

export type AppContext = ReturnType<typeof createContext>;
