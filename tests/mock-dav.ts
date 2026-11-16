import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A small stand-in for a NAS's WebDAV: strict about passwords and about parent folders existing, like the real thing. */
export const DAV_USER = 'nasuser';
export const DAV_PASSWORD = 'nas pass/ü';

export interface MockDav { endpoint: string; files: Map<string, Buffer>; folders: Set<string>; refused: number; close: () => Promise<void> }

export async function startMockDav(): Promise<MockDav> {
  const files = new Map<string, Buffer>();
  const folders = new Set<string>(['/photos']);
  const state = { refused: 0 };
  const href = (path: string, folder: boolean) => `<D:response><D:href>${encodeURI(path)}${folder && !path.endsWith('/') ? '/' : ''}</D:href><D:propstat><D:prop><D:resourcetype>${folder ? '<D:collection/>' : ''}</D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
  const server: Server = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,PUT,DELETE,PROPFIND,MKCOL,OPTIONS', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': '*', 'Access-Control-Max-Age': '600' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const wanted = `Basic ${Buffer.from(`${DAV_USER}:${DAV_PASSWORD}`).toString('base64')}`;
      if (req.headers.authorization !== wanted) { state.refused += 1; res.writeHead(401, { ...cors, 'WWW-Authenticate': 'Basic realm="nas"' }).end(); return; }
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/\/+$/, '');
      const parent = path.slice(0, path.lastIndexOf('/'));
      if (req.method === 'PROPFIND') {
        const depth = req.headers.depth ?? '1';
        if (folders.has(path)) {
          const children = [...folders].filter((f) => f.startsWith(`${path}/`) && !f.slice(path.length + 1).includes('/')).map((f) => href(f, true))
            .concat([...files.keys()].filter((f) => f.startsWith(`${path}/`) && !f.slice(path.length + 1).includes('/')).map((f) => href(f, false)));
          res.writeHead(207, { ...cors, 'Content-Type': 'application/xml' }).end(`<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${href(path, true)}${depth === '0' ? '' : children.join('')}</D:multistatus>`);
        } else if (files.has(path)) res.writeHead(207, { ...cors, 'Content-Type': 'application/xml' }).end(`<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${href(path, false)}</D:multistatus>`);
        else res.writeHead(404, cors).end();
      } else if (req.method === 'MKCOL') {
        if (folders.has(path) || files.has(path)) res.writeHead(405, cors).end();
        else if (!folders.has(parent)) res.writeHead(409, cors).end();
        else { folders.add(path); res.writeHead(201, cors).end(); }
      } else if (req.method === 'PUT') {
        if (!folders.has(parent)) res.writeHead(409, cors).end(); else { files.set(path, Buffer.concat(chunks)); res.writeHead(201, cors).end(); }
      } else if (req.method === 'GET') {
        const found = files.get(path);
        if (found) res.writeHead(200, cors).end(found); else res.writeHead(404, cors).end();
      } else if (req.method === 'DELETE') { files.delete(path); res.writeHead(204, cors).end(); }
      else res.writeHead(405, cors).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { endpoint: `http://127.0.0.1:${port}/photos`, files, folders, get refused() { return state.refused; }, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
