/** Signed-in account routes (/v1/me/*). */
import type { Route } from './http.ts';
import { z } from 'zod';
import { type EntitlementGrant } from '../../../src/core/entitlementGrant.ts';
import { evaluateFlag } from '../../../src/core/featureFlags.ts';
import { verifyLicence } from '../../../src/core/licence.ts';
import { randomId, signEnvelope } from './crypto.ts';
import { mintLicenceKey, ownsLicence } from './licenceKeys.ts';
import { newLicence } from './store.ts';
import { accountCopy, parseSetupAnswers } from '../../../src/core/quickSetup.ts';
import { PADDLE_TRANSACTION_ID } from './commerce/paddle.ts';
import { caseForUploader } from './contentSafety.ts';
import { ApiError, parseJson } from './http.ts';
import { DAY_MS, QUOTA_PERIOD_MS, offlineDeadline, Schemas } from './appShared.ts';
import type { AppContext } from './appContext.ts';

export function meRoutes(ctx: AppContext): Route[] {
  const { options, config, store, now, activateLimiter, checkoutLimiter, audit, bearer, switchOn, accountIsPro, learningSubject, collab, accountStoredBytes, settleStorage, cloudCfg, cloud, erasureCfg, erasing, deletionBody, mergeCfg, merging, safetyCfg, safety, safeCopyCfg, admin, loadFlags, grantFlagsFor, releaseWithinAllowance, activateWithSwapGrace, ownedFlags, effectiveAccountLicence } = ctx;
  return [
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
      const check = await verifyLicence(body.licenceKey, config.licencePublicKey, null);
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
    method: 'POST', path: '/v1/me/activate', summary: 'Signed in: activate this device with the account\'s paid licence; returns an Ed25519-signed offline grant. Signing in alone grants nothing.', auth: 'user',
    body: Schemas.AccountActivateRequest, response: Schemas.ActivateResponse,
    handler: async (req) => {
      const claims = await bearer(req);
      if (!activateLimiter.take(req.ip, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
      const body = parseJson(Schemas.AccountActivateRequest, req.rawBody);
      const t = now();
      const licence = await effectiveAccountLicence(claims.sub, t);
      if (!licence) throw new ApiError(403, 'NO_LICENCE', 'This account has no Pro licence yet. Your local work is unaffected.');
      const outcome = await activateWithSwapGrace({
        licenceId: licence.licenceId, planIfNew: licence.plan, deviceHash: body.deviceHash, platform: body.platform,
        appVersion: body.appVersion, newActivationId: `act_${randomId(12)}`, nowMs: t,
      }, claims.sub);
      if (!outcome.ok && outcome.reason === 'not_active') throw new ApiError(403, 'LICENCE_NOT_ACTIVE', 'This licence is no longer active. Your local work is unaffected.');
      if (!outcome.ok) throw new ApiError(409, 'DEVICE_LIMIT', `This licence is already active on ${outcome.maxDevices} devices. Deactivate one first.`);
      const grant: EntitlementGrant = {
        schema: 1, grantId: `grt_${randomId(12)}`, plan: outcome.licence.plan as EntitlementGrant['plan'], managedAi: outcome.licence.managedAi,
        deviceHash: body.deviceHash, issuedAtMs: t, offlineUntilMs: offlineDeadline(outcome.licence, t),
        ...ownedFlags(outcome.licence, await grantFlagsFor({ plan: outcome.licence.plan === 'free' ? 'basic' : 'pro', user: (await store.getAccount(claims.sub))?.emailHash }, body.deviceHash, body.appVersion, t)),
      };
      await audit(claims.sub, 'device.activate.account', 'allowed', outcome.activationId);
      // Bought outright: hand the device the buyer's key too, so Pro survives signing out or this service going away.
      const licenceKey = ownsLicence(outcome.licence) && config.licencePrivateKey ? mintLicenceKey(outcome.licence, config.licencePrivateKey, t) : undefined;
      return { status: 200, body: { grant: signEnvelope(grant, config.signingKey), activationId: outcome.activationId, ...(licenceKey ? { licenceKey } : {}) } };
    },
  },
  {
    method: 'POST', path: '/v1/me/checkout/pro', summary: 'Signed in: start a server-priced Paddle checkout for Pro, bound to this account. Returns the checkout page to open; Paddle collects the country and tax.', auth: 'user',
    body: Schemas.ProCheckoutRequest,
    handler: async (req) => {
      const claims = await bearer(req);
      const checkout = options.proCheckout;
      if (!checkout || !(await switchOn('pro-checkout'))) throw new ApiError(503, 'CHECKOUT_DISABLED', 'Pro subscriptions are not open yet. Everything else keeps working.', true);
      if (!checkoutLimiter.take(claims.sub, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
      const { plan } = parseJson(Schemas.ProCheckoutRequest, req.rawBody);
      const t = now();
      const current = await effectiveAccountLicence(claims.sub, t);
      if (current?.paid) throw new ApiError(409, 'ALREADY_PRO', 'This account already has Pro.');
      const account = await store.getAccount(claims.sub);
      if (!account?.emailHash) throw new ApiError(403, 'ACCOUNT_UNVERIFIED', 'Sign in again to subscribe to Pro.');
      try {
        // The offer (admin flag proPromo, with its dates) counts only for someone signed in and buying while it is on.
        const promo = evaluateFlag('proPromo', await loadFlags(), {}, { audience: { plan: 'basic', user: account.emailHash }, nowMs: t }).on;
        const started = await checkout.start({ accountId: claims.sub, emailHash: account.emailHash, promo, plan });
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
    method: 'POST', path: '/v1/me/checkout/topup', summary: 'Signed in: start a server-priced Paddle checkout for a prepaid cloud top-up (500, 1000 or 2000 pence), bound to this account', auth: 'user',
    body: Schemas.TopUpCheckoutRequest,
    handler: async (req) => {
      const claims = await bearer(req);
      const checkout = options.topUpCheckout;
      if (!checkout || !(await switchOn('cloud-top-ups'))) throw new ApiError(503, 'CHECKOUT_DISABLED', 'Top-ups are not open yet. Your free monthly allowances keep working.', true);
      if (!checkoutLimiter.take(claims.sub, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
      const { pence } = parseJson(Schemas.TopUpCheckoutRequest, req.rawBody);
      if (!checkout.amounts.includes(pence)) throw new ApiError(400, 'TOP_UP_UNAVAILABLE', 'That amount is not on sale.');
      const account = await store.getAccount(claims.sub);
      if (!account?.emailHash) throw new ApiError(403, 'ACCOUNT_UNVERIFIED', 'Sign in again to top up.');
      try {
        const started = await checkout.start({ accountId: claims.sub, pence });
        await audit(claims.sub, 'checkout.topup.start', 'allowed', `${started.checkoutId} ${pence}p`);
        return { status: 201, body: started };
      } catch {
        throw new ApiError(502, 'CHECKOUT_UNAVAILABLE', 'The payment page could not be opened. Nothing was charged; try again shortly.', true);
      }
    },
  },
  {
    method: 'GET', path: '/v1/me/checkout/topup/:id', summary: 'Signed in: has this top-up been paid and verified with Paddle? Paid means the cloud balance has been credited.', auth: 'user',
    handler: async (req, params) => {
      const claims = await bearer(req);
      if (!options.topUpCheckout || !PADDLE_TRANSACTION_ID.test(params.id ?? '')) throw new ApiError(404, 'NOT_FOUND', 'No such checkout.');
      if (!checkoutLimiter.take(claims.sub, now())) throw new ApiError(429, 'RATE_LIMITED', 'Checking too often. Wait a minute and try again.', true);
      let status: 'paid' | 'pending' | null;
      try { status = await options.topUpCheckout.status({ accountId: claims.sub, checkoutId: params.id! }); }
      catch { throw new ApiError(503, 'PAYMENT_VERIFICATION_PENDING', 'The payment is still being checked. Try again shortly.', true); }
      if (!status) throw new ApiError(404, 'NOT_FOUND', 'No such checkout.');
      return { status: 200, body: { status } };
    },
  },
  {
    method: 'POST', path: '/v1/me/subscription/manage', summary: "Signed in: this account's Pro subscription (renewing, ending, payment due) and Paddle's own pages to cancel it or change the card", auth: 'user',
    handler: async (req) => {
      const claims = await bearer(req);
      if (!checkoutLimiter.take(claims.sub, now())) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true);
      if (!options.managePaddleSubscription) throw new ApiError(404, 'NO_SUBSCRIPTION', 'This account has no Pro subscription to manage.');
      let managed: Awaited<ReturnType<NonNullable<typeof options.managePaddleSubscription>>>;
      try { managed = await options.managePaddleSubscription(claims.sub); }
      catch { throw new ApiError(503, 'SUBSCRIPTION_UNAVAILABLE', 'Your subscription could not be checked just now. Nothing has changed; try again shortly.', true); }
      if (!managed) throw new ApiError(404, 'NO_SUBSCRIPTION', 'This account has no Pro subscription to manage. A one-off licence bought earlier never needs cancelling.');
      await audit(claims.sub, 'subscription.manage', 'allowed', managed.state);
      return { status: 200, headers: { 'cache-control': 'no-store' }, body: managed };
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
      if (!(await releaseWithinAllowance(licence.licenceId, device.activationId, now()))) throw new ApiError(404, 'NOT_FOUND', 'That device is no longer using this licence.');
      await audit(claims.sub, 'device.deactivate.account', 'allowed', device.activationId);
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

  // ---- App preferences kept with the account (quick setup's answers), so signing in elsewhere doesn't ask again.
  {
    method: 'GET', path: '/v1/me/preferences', summary: 'Signed in: the app preferences kept with this account (quick setup: language, what you shoot, experience, cloud choice, Flight mode, finished)', auth: 'user',
    handler: async (req) => {
      const claims = await bearer(req);
      return { status: 200, body: { preferences: (await store.getPreferences(claims.sub)) ?? {} } };
    },
  },
  {
    method: 'POST', path: '/v1/me/preferences', summary: 'Signed in: save quick setup\'s answers with this account. Only known answers are kept; nothing about photos', auth: 'user', body: Schemas.PreferencesRequest,
    handler: async (req) => {
      const claims = await bearer(req);
      const body = parseJson(Schemas.PreferencesRequest, req.rawBody);
      const setup = parseSetupAnswers(body.setup);
      if (!setup || setup.status === 'in-progress') throw new ApiError(400, 'BAD_PREFERENCES', 'Those setup answers could not be read. Nothing was changed.');
      const preferences = { ...((await store.getPreferences(claims.sub)) ?? {}), setup: accountCopy(setup) };
      await store.setPreferences(claims.sub, preferences);
      return { status: 200, body: { preferences } };
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
    method: 'GET', path: '/v1/me/usage', summary: 'This month: cloud downloads you pay for, in credits (1 credit = 1p), and your allowance', auth: 'user',
    handler: async (req) => {
      const claims = await bearer(req);
      const cfg = cloudCfg();
      const used = await cfg.meter.usage(claims.sub, now());
      const allowance = await cfg.allowance.monthlyMillicredits(claims.sub, now());
      // The Account screen's meters: plan, cloud photos this period and the prepaid balance, when those are set up.
      const cloud = options.cloud;
      const pro = await accountIsPro(claims.sub);
      const carried = cloud ? (await cloud.ledger.periodCarried?.(claims.sub, now(), QUOTA_PERIOD_MS)) ?? 0 : 0;
      const photos = cloud ? { photosUsed: (await cloud.ledger.periodUsed?.(claims.sub, now(), QUOTA_PERIOD_MS)) ?? 0, photosIncluded: (pro ? cloud.jobsPerPeriod : (cloud.basicJobsPerPeriod ?? 0)) + carried, photosCarried: carried } : {};
      await settleStorage(claims.sub);
      const balance = options.cloudBalance ? { balanceCredits: (await options.cloudBalance.millicredits(claims.sub)) / 1000 } : {};
      const storedBytes = options.collab ? { storedBytes: await accountStoredBytes(claims.sub) } : {};
      return { status: 200, body: { month: used.month, usedCredits: used.millicredits / 1000, allowanceCredits: allowance / 1000, bytes: used.bytes, downloads: used.downloads, plan: pro ? 'pro' : 'basic', ...photos, ...balance, ...storedBytes } };
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
  ];
}
