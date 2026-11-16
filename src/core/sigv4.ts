/**
 * AWS Signature Version 4, the request signing used by Amazon S3 and by the many services that copy its interface
 * (Backblaze B2, Cloudflare R2, MinIO, Wasabi, many NAS boxes). Uses the browser's built-in crypto, so it runs in the
 * web app, the desktop app and the tests, and the secret key is only ever used to sign: it is never sent.
 */
const encoder = new TextEncoder();

const toHex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource));
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey('raw', key as unknown as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', imported, encoder.encode(data));
}

/** Percent-encode the way the signing rules need: everything except letters, digits and - _ . ~ (and "/" in a path). */
export function awsEncode(text: string, keepSlash = false): string {
  return [...text].map((char) => {
    if (/[A-Za-z0-9\-_.~]/.test(char)) return char;
    if (char === '/' && keepSlash) return '/';
    return [...encoder.encode(char)].map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`).join('');
  }).join('');
}

export interface SignInput {
  method: string;
  url: URL;
  region: string;
  /** "s3" for storage. */
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Hex SHA-256 of the request body (of the empty string when there is none). */
  payloadHash: string;
  now: Date;
  /** Extra headers that must be signed, such as content-type. */
  headers?: Record<string, string>;
  /** S3 wants the body hash sent as a header too. The generic signing test vectors do not. Default true. */
  sendContentHash?: boolean;
}

const stamp = (date: Date) => date.toISOString().replace(/[:-]|\.\d{3}/g, '');

/** The headers to send with a request so the service accepts it: Authorization, x-amz-date and (for S3) x-amz-content-sha256. */
export async function signV4(input: SignInput): Promise<Record<string, string>> {
  const amzDate = stamp(input.now);
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { host: input.url.host, 'x-amz-date': amzDate };
  if (input.sendContentHash !== false) headers['x-amz-content-sha256'] = input.payloadHash;
  for (const [name, value] of Object.entries(input.headers ?? {})) headers[name.toLowerCase()] = value.trim().replace(/\s+/g, ' ');

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = names.join(';');
  const path = input.url.pathname.split('/').map((segment) => awsEncode(decodeURIComponent(segment))).join('/') || '/';
  const query = [...input.url.searchParams.entries()]
    .map(([key, value]) => [awsEncode(key), awsEncode(value)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`).join('&');
  const canonicalRequest = [input.method.toUpperCase(), path, query, canonicalHeaders, signedHeaders, input.payloadHash].join('\n');

  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
  let key = await hmac(encoder.encode(`AWS4${input.secretAccessKey}`), day);
  for (const part of [input.region, input.service, 'aws4_request']) key = await hmac(key, part);
  const signature = toHex(await hmac(key, toSign));

  const out: Record<string, string> = {
    'x-amz-date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (input.sendContentHash !== false) out['x-amz-content-sha256'] = input.payloadHash;
  return out;
}
