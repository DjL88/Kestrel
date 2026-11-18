import type { IncomingMessage, ServerResponse } from 'node:http';
import type { z } from 'zod';

/** A failure the client is told about. `code` is stable; `message` is plain British English. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryable = false) { super(message); }
}

export interface Request {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  /** Raw body text (already size-limited). */
  rawBody: string;
  ip: string;
}

export interface Reply { status: number; body: unknown; headers?: Record<string, string> }

export type Handler = (req: Request, params: Record<string, string>) => Promise<Reply> | Reply;

export interface Route {
  method: 'GET' | 'POST';
  path: string;              // '/v1/admin/licences/:id/revoke'
  summary: string;
  auth: 'none' | 'user' | 'admin' | 'webhook';
  body?: z.ZodType;
  response?: z.ZodType;
  handler: Handler;
}

export function matchRoute(routes: Route[], method: string, path: string): { route: Route; params: Record<string, string> } | 'method' | null {
  let methodMismatch = false;
  for (const route of routes) {
    const pattern = route.path.split('/'), actual = path.split('/');
    if (pattern.length !== actual.length) continue;
    const params: Record<string, string> = {};
    const ok = pattern.every((part, i) => {
      if (part.startsWith(':')) { params[part.slice(1)] = decodeURIComponent(actual[i]); return actual[i].length > 0; }
      return part === actual[i];
    });
    if (!ok) continue;
    if (route.method !== method) { methodMismatch = true; continue; }
    return { route, params };
  }
  return methodMismatch ? 'method' : null;
}

/** Read at most `limit` bytes; anything longer is a 413, never buffered whole. */
export function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) { req.resume(); reject(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'That request is too large.')); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { req.destroy(); reject(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'That request is too large.')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function parseJson<T>(schema: z.ZodType<T>, raw: string): T {
  let data: unknown;
  try { data = raw ? JSON.parse(raw) : {}; } catch { throw new ApiError(400, 'BAD_JSON', 'The request body is not valid JSON.'); }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ').slice(0, 300));
  return parsed.data;
}

export function send(res: ServerResponse, reply: Reply, origin?: string): void {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...reply.headers,
  };
  if (origin) { headers['access-control-allow-origin'] = origin; headers.vary = 'Origin'; }
  res.writeHead(reply.status, headers);
  res.end(reply.status === 204 ? undefined : JSON.stringify(reply.body));
}
