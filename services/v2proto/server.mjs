// Owner-only V2 prototype gateway. Auth is enforced for EVERY file, not merely
// the first HTML page. This service is deliberately distinct from the public
// homepage and existing control plane.
import { createServer } from 'node:http';
import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

const root = resolve(process.env.V2PROTO_STATIC_ROOT || '/app/site');
const clientId = process.env.V2PROTO_GOOGLE_CLIENT_ID || '';
const owners = new Set((process.env.V2PROTO_OWNER_EMAILS || '').split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean));
const secret = process.env.V2PROTO_COOKIE_SECRET || '';
if (!clientId || !owners.size || Buffer.byteLength(secret) < 32) {
  throw new Error('V2PROTO_GOOGLE_CLIENT_ID, V2PROTO_OWNER_EMAILS, and a 32-byte+ V2PROTO_COOKIE_SECRET are required');
}
const rootPath = '/V2Proto';
const lifetime = 12 * 60 * 60 * 1000;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.onnx': 'application/octet-stream' };
const keysCache = { until: 0, keys: [] };
const sign = value => createHmac('sha256', secret).update(value).digest('base64url');
function sessionToken(email) {
  const payload = Buffer.from(JSON.stringify({ email, expires: Date.now() + lifetime, nonce: randomBytes(12).toString('hex') })).toString('base64url');
  return payload + '.' + sign(payload);
}
function activeSession(request) {
  const match = /(?:^|;\s*)v2proto_session=([^;]+)/.exec(request.headers.cookie || '');
  if (!match) return false;
  const [data, signature, extra] = match[1].split('.');
  if (!data || !signature || extra) return false;
  const expected = Buffer.from(sign(data));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(data, 'base64url').toString());
    return typeof decoded.expires === 'number' && decoded.expires > Date.now() &&
      typeof decoded.email === 'string' && owners.has(decoded.email);
  } catch { return false; }
}
async function googleKeys() {
  if (keysCache.until > Date.now()) return keysCache.keys;
  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Could not verify Google keys');
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw new Error('Invalid Google keys');
  keysCache.keys = body.keys;
  keysCache.until = Date.now() + 60 * 60 * 1000;
  return keysCache.keys;
}
async function verifiedOwnerIdToken(token) {
  if (typeof token !== 'string' || token.length > 10000) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
    const key = (await googleKeys()).find(item => item.kid === header.kid && item.kty === 'RSA');
    if (!key || !verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) return null;
    if (!['accounts.google.com','https://accounts.google.com'].includes(claims.iss) || claims.aud !== clientId) return null;
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp <= now || typeof claims.iat !== 'number' || claims.iat > now + 60) return null;
    if (claims.email_verified !== true || typeof claims.email !== 'string' || typeof claims.sub !== 'string' || !claims.sub) return null;
    const email = claims.email.trim().toLowerCase();
    return owners.has(email) ? email : null;
  } catch { return null; }
}
function send(res, status, body, type = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow', ...headers });
  res.end(body);
}
function signInPage() {
  // clientId comes from administrator-controlled Cloud Run configuration.
  const id = JSON.stringify(clientId).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>InFlight V2 — Owner sign-in</title></head><body style="background:#0e1116;color:#f4efe8;font:16px system-ui;padding:clamp(20px,5vw,72px)"><main style="max-width:520px;margin:auto"><h1>InFlight V2 prototype</h1><p>Sign in with your approved Google owner account.</p><div id="google-signin"></div><p id="status" role="status"></p></main><script src="https://accounts.google.com/gsi/client" async defer></script><script>window.onload=()=>{google.accounts.id.initialize({client_id:${id},callback:async ({credential})=>{const el=document.getElementById('status');el.textContent='Checking access…';try{const r=await fetch('/V2Proto/session',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({credential})});if(!r.ok)throw Error('This account is not approved for the prototype.');location.replace('/V2Proto/');}catch(e){el.textContent=e.message;}}});google.accounts.id.renderButton(document.getElementById('google-signin'),{theme:'filled_black',size:'large'});};</script></body></html>`;
}
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url || '/', 'https://localhost').pathname;
  if (pathname !== rootPath && !pathname.startsWith(rootPath + '/')) { send(res, 404, 'Not found'); return; }
  if (req.method === 'POST' && pathname === rootPath + '/session') {
    if (req.headers.origin !== 'https://kestrel-hosting-kestrel.web.app') { send(res, 403, 'Forbidden'); return; }
    const chunks = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > 12000) { send(res, 413, 'Too large'); return; } chunks.push(chunk); }
    try {
      const { credential } = JSON.parse(Buffer.concat(chunks).toString());
      const owner = await verifiedOwnerIdToken(credential);
      if (!owner) { send(res, 403, 'Not authorised'); return; }
      send(res, 200, 'OK', 'text/plain; charset=utf-8', { 'Set-Cookie': 'v2proto_session=' + sessionToken(owner) + '; Path=/V2Proto; Max-Age=43200; Secure; HttpOnly; SameSite=Lax' });
    } catch { send(res, 403, 'Not authorised'); }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, 'Method not allowed'); return; }
  if (!activeSession(req)) {
    if (pathname.startsWith(rootPath + '/assets/') || pathname.startsWith(rootPath + '/models/')) { send(res, 401, 'Sign in required'); return; }
    send(res, 200, req.method === 'HEAD' ? '' : signInPage(), 'text/html; charset=utf-8', { 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline' https://accounts.google.com; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; style-src 'unsafe-inline'; img-src https: data:; frame-ancestors 'none'" });
    return;
  }
  if (pathname === rootPath + '/signout') {
    send(res, 302, '', 'text/plain; charset=utf-8', { Location: '/V2Proto/', 'Set-Cookie': 'v2proto_session=; Path=/V2Proto; Max-Age=0; Secure; HttpOnly; SameSite=Lax' });
    return;
  }
  let decoded;
  try { decoded = decodeURIComponent(pathname.slice(rootPath.length)); } catch { send(res, 400, 'Bad path'); return; }
  if (decoded.includes('\\') || decoded.includes('\0')) { send(res, 400, 'Bad path'); return; }
  const requested = decoded === '' || decoded === '/' ? 'v2-proto.html' : decoded.replace(/^\//, '');
  const file = resolve(root, requested);
  if (!file.startsWith(root + sep)) { send(res, 403, 'Forbidden'); return; }
  try {
    const info = await stat(file);
    if (!info.isFile()) { send(res, 404, 'Not found'); return; }
    const content = await readFile(file);
    send(res, 200, req.method === 'HEAD' ? '' : content, mime[extname(file)] || 'application/octet-stream', { 'Cache-Control': file.includes('/assets/') ? 'private, max-age=300' : 'no-store' });
  } catch { send(res, 404, 'Not found'); }
});
server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
