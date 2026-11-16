import { createHash, createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A small stand-in for an S3-compatible service, for tests. It checks every request's signature with its own code,
 * written separately from the app's, so a mistake in the app's signing shows up as a refused request.
 */
export const ACCESS_KEY = 'TESTACCESSKEY';
export const SECRET_KEY = 'test/secret+KEY';
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();
const encode = (text: string, keepSlash = false) => [...Buffer.from(text)].map((b) => {
  const c = String.fromCharCode(b);
  return /[A-Za-z0-9\-_.~]/.test(c) || (keepSlash && c === '/') ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
}).join('');

function signatureOk(req: IncomingMessage, body: Buffer): boolean {
  const auth = String(req.headers.authorization ?? '');
  const parts = /Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]+)/.exec(auth);
  if (!parts || parts[1] !== ACCESS_KEY) return false;
  const [, , day, region, signedHeaders, signature] = parts;
  const payloadHash = String(req.headers['x-amz-content-sha256'] ?? '');
  if (payloadHash !== sha(body)) return false;
  const url = new URL(req.url ?? '/', 'http://x');
  const path = url.pathname.split('/').map((segment) => encode(decodeURIComponent(segment))).join('/');
  const query = [...url.searchParams.entries()].map(([k, v]) => [encode(k), encode(v)]).sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]))).map(([k, v]) => `${k}=${v}`).join('&');
  const headers = signedHeaders.split(';').map((name) => `${name}:${String(req.headers[name] ?? '').trim().replace(/\s+/g, ' ')}\n`).join('');
  const canonical = [req.method, path, query, headers, signedHeaders, payloadHash].join('\n');
  const amzDate = String(req.headers['x-amz-date']);
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canonical)].join('\n');
  let key: Buffer = hmac(`AWS4${SECRET_KEY}`, day);
  for (const part of [region, 's3', 'aws4_request']) key = hmac(key, part);
  return hmac(key, toSign).toString('hex') === signature;
}

export interface MockS3 { server: Server; endpoint: string; objects: Map<string, Buffer>; refused: number; close: () => Promise<void> }

export async function startMockS3(bucket: string): Promise<MockS3> {
  const objects = new Map<string, Buffer>();
  const state = { refused: 0 };
  const server = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,PUT,DELETE,HEAD,OPTIONS', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': '*', 'Access-Control-Max-Age': '600' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (!signatureOk(req, body)) { state.refused += 1; res.writeHead(403, cors).end('<Error><Code>SignatureDoesNotMatch</Code></Error>'); return; }
      const url = new URL(req.url ?? '/', 'http://x');
      const [, name, ...rest] = url.pathname.split('/');
      if (name !== bucket) { res.writeHead(404, cors).end('<Error><Code>NoSuchBucket</Code></Error>'); return; }
      const key = rest.map(decodeURIComponent).join('/');
      if (req.method === 'PUT') { objects.set(key, body); res.writeHead(200, cors).end(); }
      else if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204, cors).end(); }
      else if (req.method === 'GET' && !key) {
        const prefix = url.searchParams.get('prefix') ?? '';
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
        const xml = `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${keys.map((k) => `<Contents><Key>${k.replace(/&/g, '&amp;')}</Key></Contents>`).join('')}</ListBucketResult>`;
        res.writeHead(200, { ...cors, 'Content-Type': 'application/xml' }).end(xml);
      } else if (req.method === 'GET') {
        const found = objects.get(key);
        if (found) res.writeHead(200, cors).end(found); else res.writeHead(404, cors).end('<Error><Code>NoSuchKey</Code></Error>');
      } else res.writeHead(405, cors).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, endpoint: `http://127.0.0.1:${port}`, objects, get refused() { return state.refused; }, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
