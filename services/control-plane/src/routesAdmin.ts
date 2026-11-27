/** The admin console routes (/v1/admin/*): allow-listed staff only. */
import type { Route } from './http.ts';
import crypto from 'node:crypto';
import { parseFlagSet, MAX_GRANT_FLAGS } from '../../../src/core/featureFlags.ts';
import { verifyLicence } from '../../../src/core/licence.ts';
import { randomId, sha256Hex, signSession } from './crypto.ts';
import { newLicence } from './store.ts';
import { emailHashOf, giftEntitlement } from './entitlement.ts';
import { verifyGoogleIdToken } from './googleIdToken.ts';
import { UK_VAT_THRESHOLD_PENCE, UK_VAT_WARNING_PENCE } from './commerce/turnover.ts';
import { COMPLIANCE_MAX_BYTES } from './complianceDocs.ts';
import { reservationPence, APPROVED_MONTHLY_PENCE, billingMonth } from './vertexLearning.ts';
import { ApiError, parseJson, send } from './http.ts';
import { DAY_MS, QUOTA_PERIOD_MS, AdminTaxSettings, SWITCHES, Schemas } from './appShared.ts';
import type { AppContext } from './appContext.ts';

export function adminRoutes(ctx: AppContext): Route[] {
  const { options, config, commerce, store, now, provider, authLimiter, googleKeys, adminEmailHashes, audit, createAccount, switchConfigured, switchOn, collab, settleStorage, cloudCfg, cloud, news, erasureCfg, erasing, gallery, complianceCfg, compliance, safetyCfg, safety, admin, adminDone, FLAGS_SETTING, loadFlags, ownedFlags } = ctx;
  return [
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
  // ---- Reports about shared content. InFlight does not scan photos.
  {
    method: 'GET', path: '/v1/admin/safety', summary: 'Gallery reports, as metadata only (never the pictures)', auth: 'admin',
    handler: async (req) => {
      const claims = await admin(req, 'safety.read');
      const service = options.safety?.service;
      return adminDone(claims, 'safety.read', '', {
        notices: service ? (await service.notices()).map(({ receiptHash: _r, ...n }) => n) : [],
      });
    },
  },
  // ---- Compliance documents (complianceDocs.ts): signed risk assessments, admin only, every upload and download audited.
  {
    method: 'GET', path: '/v1/admin/compliance/documents', summary: 'Signed compliance documents (risk assessments), newest first', auth: 'admin',
    handler: async (req) => {
      const claims = await admin(req, 'compliance.list');
      const docs = await compliance(() => complianceCfg().list());
      return adminDone(claims, 'compliance.list', String(docs.length), { documents: docs.map(({ sha256: _s, ...d }) => d), maxBytes: COMPLIANCE_MAX_BYTES });
    },
  },
  {
    method: 'POST', path: '/v1/admin/compliance/documents', summary: 'Upload a signed copy (PDF or Markdown). Never replaces an earlier one', auth: 'admin', body: Schemas.ComplianceUpload,
    handler: async (req) => {
      const claims = await admin(req, 'compliance.upload');
      const body = parseJson(Schemas.ComplianceUpload, req.rawBody);
      const doc = await compliance(() => complianceCfg().upload({ title: body.title, fileName: body.fileName, contentType: body.contentType, body: Buffer.from(body.base64, 'base64'), by: claims.sub, atMs: now() }));
      return adminDone(claims, 'compliance.upload', `${doc.id} sha256=${doc.sha256}`, { document: { ...doc, sha256: undefined } });
    },
  },
  {
    method: 'GET', path: '/v1/admin/compliance/documents/:id/download', summary: 'A 10-minute download link for one compliance document', auth: 'admin',
    handler: async (req, params) => {
      const claims = await admin(req, 'compliance.download');
      const link = await compliance(() => complianceCfg().download(params.id));
      return adminDone(claims, 'compliance.download', params.id, link);
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
    method: 'GET', path: '/v1/admin/messages', summary: 'Contact form messages and contributor feedback, newest first', auth: 'admin',
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
        email: body.email, plan: body.plan, majorVersion: body.majorVersion, managedAi: body.managedAi, contributor: body.contributor,
        note: body.note ?? (body.contributor ? 'Contributor' : null),
        validUntilMs: body.validDays ? now() + body.validDays * DAY_MS : null, accountId: existing?.accountId ?? null,
      }, now());
      const result = await store.grantLicence(record);
      // The address is never written to the audit log, only a short hash, like the admin sign-in entries.
      return adminDone(claims, 'licence.grant', `${record.licenceId} plan=${body.plan} v${body.majorVersion}${body.contributor ? ' contributor' : ''}${result.created ? '' : ' (already granted)'}`,
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
    method: 'POST', path: '/v1/admin/licences/:id/releases/reset', summary: 'Support: give a licence its yearly device moves back (for example after a lost or broken device)', auth: 'admin',
    handler: async (req, params) => {
      const claims = await admin(req, 'licence.releases.reset');
      if (!(await store.getLicence(params.id))) throw new ApiError(404, 'NOT_FOUND', 'No such licence.');
      await store.setSetting(`device-releases:${params.id}`, '[]');
      return adminDone(claims, 'licence.releases.reset', params.id, { reset: true });
    },
  },
  {
    method: 'POST', path: '/v1/admin/licences/revoke-by-key', summary: 'Revoke a key by pasting it, even one no device has used yet. Keeps only its licence id', auth: 'admin', body: Schemas.AdminRevokeKey,
    handler: async (req) => {
      const claims = await admin(req, 'licence.revoke');
      const body = parseJson(Schemas.AdminRevokeKey, req.rawBody);
      // The signature check keeps typos and made-up keys out of the list. The key itself is never stored or logged.
      const check = await verifyLicence(body.licenceKey, config.licencePublicKey, null);
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
    method: 'GET', path: '/v1/admin/balance-refunds', summary: 'Unused cloud balances owed back after an account deletion, to refund through Paddle', auth: 'admin',
    handler: async (req) => {
      const claims = await admin(req, 'balance.refund.list');
      const refunds = await erasureCfg().owedRefunds();
      return adminDone(claims, 'balance.refund.list', `owed=${refunds.length}`, { refunds });
    },
  },
  {
    method: 'POST', path: '/v1/admin/balance-refunds/:id/refunded', summary: 'Mark an owed balance as refunded through Paddle (safe to repeat)', auth: 'admin', body: Schemas.BalanceRefunded,
    handler: async (req, params) => {
      const claims = await admin(req, 'balance.refund.done');
      const body = parseJson(Schemas.BalanceRefunded, req.rawBody);
      const refund = await erasing(() => erasureCfg().markRefunded(params.id, body.paddleReference));
      return adminDone(claims, 'balance.refund.done', params.id, { refund });
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
      if (url.protocol !== 'https:' || !config.releaseUrlPrefixes.some((prefix) => url.toString().startsWith(prefix)) || url.username || url.password) {
        await audit(claims.sub, 'release.publish', 'denied', `host ${url.hostname}`);
        throw new ApiError(400, 'RELEASE_URL_NOT_ALLOWED', `Release links must start with ${config.releaseUrlPrefixes.join(' or ')}.`);
      }
      const inserted = await store.insertRelease({ platform: body.platform, channel: body.channel, version: body.version, url: url.toString(), notes: body.notes, minSupported: body.minSupported, publishedAtMs: now() });
      if (!inserted) throw new ApiError(409, 'RELEASE_EXISTS', 'That version is already published on this channel.');
      return adminDone(claims, 'release.publish', `${body.platform} ${body.version}`, { published: true });
    },
  },
  ];
}
