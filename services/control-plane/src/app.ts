/** The control-plane HTTP app: builds the shared context, gathers the route groups and serves them. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { uuid } from './crypto.ts';
import { licenceKeyMail, mintLicenceKey, ownsLicence } from './licenceKeys.ts';
import { type LicenceRecord } from './store.ts';
import { MAX_RECIPE_BYTES } from './collaboration.ts';
import { COMPLIANCE_MAX_BYTES } from './complianceDocs.ts';
import { cloudRunClientIp } from './networkCountry.ts';
import { ApiError, matchRoute, readBody, send, type Route } from './http.ts';
import { CollabApiError } from './appShared.ts';
import { createContext } from './appContext.ts';
import { adminRoutes } from './routesAdmin.ts';
import { collabRoutes } from './routesCollab.ts';
import { meRoutes } from './routesMe.ts';
import { generalRoutes } from './routesGeneral.ts';
export { DEVICE_RELEASES_PER_YEAR, MAX_IMAGE_BYTES, MAX_IMAGE_EDGE, SWAP_IDLE_DAYS, Schemas } from './appShared.ts';
export type { AppOptions } from './appShared.ts';
import type { AppOptions } from './appShared.ts';

export function createApp(options: AppOptions) {
  const ctx = createContext(options);
  const { config, store, now, audit, bearer, issueSession, createAccount, switchOn, collab, compliance, admin } = ctx;
  const routes: Route[] = [...generalRoutes(ctx), ...meRoutes(ctx), ...collabRoutes(ctx), ...adminRoutes(ctx)];

  const bodyLimit = (path: string) => /^\/v1\/collab\/projects\/[^/]+\/photos\/[^/]+\/revisions$/.test(path) ? MAX_RECIPE_BYTES + 4096 : path === '/v1/admin/compliance/documents' ? Math.ceil(COMPLIANCE_MAX_BYTES / 3) * 4 + 4096 : path.startsWith('/v1/ai/') ? 800 * 1024 : 64 * 1024;

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

  /**
   * Email a new buyer their key, once, right after the payment creates the licence (proSettlement's onNewLicence).
   * Only to the verified sign-in address (noticeContacts), only with app email switched on, and only where this server
   * can sign keys. Whatever happens here, the key is still handed to each device at sign-in and shown in Settings.
   */
  async function sendLicenceKey(licence: LicenceRecord): Promise<'sent' | 'skipped'> {
    if (!ownsLicence(licence) || !licence.accountId || !config.licencePrivateKey || !options.mailer || !options.contacts || !(await switchOn('email'))) return 'skipped';
    const to = await options.contacts.addressBook(licence.accountId);
    if (!to) return 'skipped';
    const mail = licenceKeyMail(mintLicenceKey(licence, config.licencePrivateKey, now()), licence.majorVersion);
    const sent = await options.mailer.sendNotice({ to: to.address, accountId: licence.accountId, ...mail, language: to.language, stream: 'account' });
    await audit(licence.accountId, 'licence.key.email', sent.sent ? 'allowed' : 'denied', licence.licenceId);
    return sent.sent ? 'sent' : 'skipped';
  }

  return { handle, routes, store, createAccount, issueSession, config, sendLicenceKey };
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
