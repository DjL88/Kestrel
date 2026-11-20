// Serves site/ locally for previews and tests (the website is plain static files).
// Usage: node scripts/site/serve-site.mjs [port]   (default 4180)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site');

// Optional localhost-only backend bridge for exercising the authenticated Demo Studio locally.
// Never acts as a proxy in the public Firebase Hosting deployment.
const apiTarget = process.env.KESTREL_LOCAL_DEMO_API || '';
if (apiTarget && !/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(apiTarget)) {
  throw new Error('KESTREL_LOCAL_DEMO_API must point to an explicitly chosen localhost port.');
}
async function forwardApi(req, res, url) {
  try {
    const chunks = [];
    let length = 0;
    if (req.method === 'POST') {
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 2_300_000) { res.writeHead(413).end('Demo request too large.'); return; }
        chunks.push(chunk);
      }
    }
    const response = await fetch(apiTarget + url.pathname + url.search, {
      method: req.method,
      headers: {
        ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
        ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}),
      },
      ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
    });
    const payload = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/json', 'Cache-Control':'no-store' });
    res.end(payload);
  } catch {
    res.writeHead(502, { 'Content-Type':'application/json', 'Cache-Control':'no-store' }).end(JSON.stringify({
      error: { message:'Local demo backend unavailable. Start npm run control-plane and try again.' },
    }));
  }
}

const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
};

export function startSiteServer(port = 4180) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (apiTarget && url.pathname.startsWith('/v1/')) { await forwardApi(req,res,url); return; }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(siteRoot, rel);
    if (!file.startsWith(siteRoot)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || process.env.PORT || 4180);
  await startSiteServer(port);
  console.log(`Kestrel site on http://127.0.0.1:${port}/`);
}
