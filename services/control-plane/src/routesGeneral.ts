/** Health, sign-in, licences, billing, AI, cloud, gallery, notices and the other public routes. */
import type { Route } from './http.ts';
import { z } from 'zod';
import { type EntitlementGrant } from '../../../src/core/entitlementGrant.ts';
import { forPublicDocument } from '../../../src/core/featureFlags.ts';
import { verifyLicence } from '../../../src/core/licence.ts';
import { newerRelease } from '../../../src/core/desktopRelease.ts';
import { randomId, sha256Hex, signEnvelope, verifyPassword, verifyWebhook } from './crypto.ts';
import { publicExamples } from './demoStudio.ts';
import { licenceIsUsable } from './store.ts';
import { identify, suggest, verifyColour } from './gateway.ts';
import { PADDLE_TRANSACTION_ID, PaddleEvent, verifyPaddleSignature, PADDLE_ADJUSTMENT_ID } from './commerce/paddle.ts';
import { DEFAULT_MAX_JOB_MS } from './cloudJobs.ts';
import { galleryIdFor } from './gallery.ts';
import { SAFE_COPY_MAX_BYTES, safeCopyKey } from './safeCopy.ts';
import { htmlLang, mailWords } from './mailText.ts';
import { ApiError, parseJson, send, type Reply } from './http.ts';
import { offlineDeadline, Version, Schemas, esc, MAIL_PAGE_HEADERS, mailPage } from './appShared.ts';
import type { AppContext } from './appContext.ts';

export function generalRoutes(ctx: AppContext): Route[] {
  const { options, config, store, demoStudio, now, authLimiter, contactLimiter, contactGlobalLimiter, activateLimiter, paddleLimiter, galleryLimiter, reportLimiter, audit, bearer, issueSession, providerRoute, switchOn, aiCall, cloudGate, cloudJobStart, cloudJobOwned, settleFailedCloudJob, collab, cloud, notify, pushCfg, news, contactsCfg, galleryCfg, gallery, ownerSuspended, safetyCfg, safety, safeCopyCfg, safeCopyUploadGate, admin, loadFlags, grantFlagsFor, releaseWithinAllowance, activateWithSwapGrace, ownedFlags, verifiedModelManifest } = ctx;
  return [
  // Cloud Run's front end reserves some paths ending in 'z' (including /healthz) and answers them with its own 404
  // before the request reaches the container, so public clients probe /health. /healthz stays for the container probe.
  {
    method: 'GET', path: '/v1/mail/unsubscribe', summary: 'Confirm page for stopping emails: all of them for an address (invitations), or one kind for an account (news or product emails). A link only shows a button, so mail scanners cannot unsubscribe anyone', auth: 'none',
    handler: (req) => {
      const t = req.query.get('t') ?? ''; const l = htmlLang(req.query.get('l') ?? undefined);
      const s = req.query.get('s') ?? ''; const a = req.query.get('a') ?? ''; const r = req.query.get('r') ?? '';
      const w = mailWords(l).unsubscribe;
      const safe = (v: string) => v.replace(/[^A-Za-z0-9_-]/g, '');
      const scoped = !!options.mailer && options.mailer.checkStreamUnsubscribe(s, a, t) ? s as 'news' | 'notice' : null;
      const ok = scoped !== null || (!s && !!options.mailer && options.mailer.checkUnsubscribe(r, t));
      const action = scoped ? `s=${scoped}&amp;a=${safe(a)}&amp;t=${safe(t)}` : `r=${safe(r)}&amp;t=${safe(t)}`;
      const title = scoped === 'news' ? w.stopNews : scoped === 'notice' ? w.stopNotices : w.title;
      const confirm = scoped === 'news' ? w.confirmNews : scoped === 'notice' ? w.confirmNotices : w.confirm;
      const button = scoped === 'news' ? w.stopNews : scoped === 'notice' ? w.stopNotices : w.button;
      return { status: ok ? 200 : 400, body: mailPage(l, ok ? title : w.invalid, ok
        ? `<p>${esc(confirm)}</p><form method="post" action="/v1/mail/unsubscribe?${action}&amp;l=${encodeURIComponent(l)}"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">${esc(button)}</button></form>`
        : `<p>${esc(w.invalidHint)}</p>`), headers: MAIL_PAGE_HEADERS };
    },
  },
  {
    method: 'POST', path: '/v1/mail/unsubscribe', summary: 'One-click unsubscribe (RFC 8058): every email to an address, or one kind (news, product emails) for an account', auth: 'none',
    handler: async (req) => {
      const t = req.query.get('t') ?? ''; const l = htmlLang(req.query.get('l') ?? undefined);
      const s = req.query.get('s') ?? ''; const a = req.query.get('a') ?? ''; const r = req.query.get('r') ?? '';
      const w = mailWords(l).unsubscribe;
      if (s) {
        if (!options.mailer || !options.mailer.checkStreamUnsubscribe(s, a, t)) throw new ApiError(400, 'UNSUBSCRIBE_INVALID', 'This unsubscribe link is not valid.');
        // The preference lives with the account, so the app's switch shows it and can turn it back on.
        if (!options.contacts) throw new ApiError(503, 'EMAIL_PREFS_NOT_CONFIGURED', 'Email preferences are not available on this server right now. Reply to the email and we will stop them.', true);
        if (s === 'news') await options.contacts.setProductNews(a, false, now());
        else await options.contacts.setProductEmail(a, false);
        await audit(a, s === 'news' ? 'notify.news-email' : 'notify.product-email', 'allowed', 'off (email link)');
        return { status: 200, body: mailPage(l, s === 'news' ? w.stopNews : w.stopNotices, `<p>${esc(s === 'news' ? w.doneNews : w.doneNotices)}</p>`), headers: MAIL_PAGE_HEADERS };
      }
      if (!options.mailer || !options.mailer.checkUnsubscribe(r, t)) throw new ApiError(400, 'UNSUBSCRIBE_INVALID', 'This unsubscribe link is not valid.');
      await options.mailer.unsubscribe(r);
      await audit('anonymous', 'mail.unsubscribe', 'allowed', '');
      return { status: 200, body: mailPage(l, w.title, `<p>${esc(w.done)}</p>`), headers: MAIL_PAGE_HEADERS };
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
      const check = await verifyLicence(body.licenceKey, config.licencePublicKey, null);
      if (!check.ok) throw new ApiError(400, 'LICENCE_INVALID', 'That licence key was not recognised.');
      const t = now();
      const outcome = await activateWithSwapGrace({
        licenceId: check.details.id, planIfNew: check.details.plan, deviceHash: body.deviceHash, platform: body.platform,
        appVersion: body.appVersion, newActivationId: `act_${randomId(12)}`, nowMs: t,
      }, null);
      if (!outcome.ok && outcome.reason === 'not_active') throw new ApiError(403, 'LICENCE_NOT_ACTIVE', 'This licence is no longer active. Your local work is unaffected.');
      if (!outcome.ok) throw new ApiError(409, 'DEVICE_LIMIT', `This licence is already active on ${outcome.maxDevices} devices. Deactivate one first.`);
      const { activationId, licence } = outcome;
      const grant: EntitlementGrant = {
        schema: 1, grantId: `grt_${randomId(12)}`, plan: licence.plan as EntitlementGrant['plan'], managedAi: licence.managedAi,
        deviceHash: body.deviceHash, issuedAtMs: t, offlineUntilMs: offlineDeadline(licence, t),
        ...ownedFlags(licence, await grantFlagsFor({ plan: licence.plan === 'free' ? 'basic' : 'pro' }, body.deviceHash, body.appVersion, t)),
      };
      return { status: 200, body: { grant: signEnvelope(grant, config.signingKey), activationId } };
    },
  },
  {
    method: 'POST', path: '/v1/licences/status', summary: 'For whoever holds the key: is it active, and on which devices', auth: 'none',
    body: Schemas.LicenceStatusRequest, response: Schemas.LicenceStatusResponse,
    handler: async (req) => {
      if (!activateLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
      const body = parseJson(Schemas.LicenceStatusRequest, req.rawBody);
      const check = await verifyLicence(body.licenceKey, config.licencePublicKey, null);
      if (!check.ok) throw new ApiError(400, 'LICENCE_INVALID', 'That licence key was not recognised.');
      const licence = await store.getLicence(check.details.id);
      if (!licence) return { status: 200, body: { status: 'unknown', validUntilMs: null, maxDevices: 5, devices: [] } };
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
      const check = await verifyLicence(body.licenceKey, config.licencePublicKey, null);
      if (!check.ok) throw new ApiError(400, 'LICENCE_INVALID', 'That licence key was not recognised.');
      const devices = await store.listActivationsForLicence(check.details.id);
      if (!devices.some((d) => d.activationId === body.activationId) || !(await releaseWithinAllowance(check.details.id, body.activationId, now()))) {
        throw new ApiError(404, 'NOT_FOUND', 'That device is not using this licence.');
      }
      await audit(`licence:${check.details.id}`, 'device.deactivate.self', 'allowed', body.activationId);
      return { status: 200, body: { deactivated: true } };
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
        await cloud.runner.start(record.jobId, record.kind, record.inputKind);
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
      return { status: 200, body: { available, productNews: prefs.productNews, productEmail: prefs.productEmail, productEmailAvailable: !!options.mailer && (await switchOn('email')) } };
    },
  },
  {
    method: 'POST', path: '/v1/notify/email', summary: 'Turn product news (marketing) or product emails (shared-project notices) on or off, and tell the server which language the app is in', auth: 'user', body: Schemas.EmailPreferences,
    handler: async (req) => {
      const claims = await bearer(req);
      const body = parseJson(Schemas.EmailPreferences, req.rawBody);
      const contacts = contactsCfg();
      if (body.language) await contacts.setLanguage(claims.sub, body.language);
      if (body.productNews !== undefined) {
        await contacts.setProductNews(claims.sub, body.productNews, now());
        await audit(claims.sub, 'notify.news-email', 'allowed', body.productNews ? 'on' : 'off');
      }
      if (body.productEmail !== undefined) {
        await contacts.setProductEmail(claims.sub, body.productEmail);
        await audit(claims.sub, 'notify.product-email', 'allowed', body.productEmail ? 'on' : 'off');
      }
      const prefs = await contacts.preferences(claims.sub);
      return { status: 200, body: { productNews: prefs.productNews, productEmail: prefs.productEmail } };
    },
  },
  {
    method: 'POST', path: '/v1/gallery/open', summary: 'Open a client gallery from its link (no account). The token is in the page fragment, never the URL path', auth: 'none', body: Schemas.GalleryOpen,
    handler: async (req) => {
      if (!galleryLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
      const body = parseJson(Schemas.GalleryOpen, req.rawBody);
      const { view } = await gallery(() => galleryCfg().open(body.token, body.password, now(), ownerSuspended));
      return { status: 200, body: view };
    },
  },
  {
    method: 'POST', path: '/v1/gallery/feedback', summary: 'A favourite, comment or approval from a client, when the photographer allows it', auth: 'none', body: Schemas.GalleryFeedback,
    handler: async (req) => {
      if (!galleryLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
      const body = parseJson(Schemas.GalleryFeedback, req.rawBody);
      const g = await gallery(() => galleryCfg().feedback(body.token, body.password, { visitor: body.visitor, photoId: body.photoId, kind: body.kind, text: body.text }, now(), ownerSuspended));
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
  ];
}
