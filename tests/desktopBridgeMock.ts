import type { Page } from '@playwright/test';
import { open, readdir, readFile, stat } from 'node:fs/promises';

/**
 * A stand-in for the desktop app's bridge (Tauri `__TAURI_INTERNALS__`), so a browser test runs the desktop code paths:
 * the native photo picker returns file paths and originals are read from the disk on demand (stat, ranged reads).
 * `develop_raw` returns the picture a test supplies. Only the file paths a test hands in can be read. Other commands
 * resolve to null and are recorded in `calls`.
 */
export async function mockDesktopBridge(page: Page, pickedPaths: string[], options: {
  /** The developed picture the native RAW decoder returns, by original file size. */
  developed?: Record<number, string>;
  /** How long the native RAW develop takes, to reproduce a slow 45 MP develop. */
  developDelayMs?: number;
  /** Milliseconds each mebibyte of a ranged read takes, to reproduce a large original on a slow disk or bridge. */
  readMsPerMebibyte?: number;
  /** Folders whose files may be listed and read too (a drive the person points Reconnect at). */
  roots?: string[];
  /** What the system dialog answers, asked each time it opens; the picked paths when left out. */
  dialog?: () => string[] | string | null;
} = {}) {
  const calls: string[] = [];
  const allowed = new Set(pickedPaths);
  const roots = (options.roots ?? []).map((root) => root.replace(/\\/g, '/').replace(/\/+$/, ''));
  const reachable = (path: string) => allowed.has(path) || roots.some((root) => path === root || path.startsWith(`${root}/`));
  await page.exposeFunction('__kestrelTestDialog', () => (options.dialog ? options.dialog() : pickedPaths));
  await page.exposeFunction('__kestrelTestFs', async (op: string, path: string, offset = 0, length = 0) => {
    if (!reachable(path)) throw new Error(`Test bridge: ${path} was not offered to the picker.`);
    if (op === 'read_dir') {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((entry) => ({ name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory(), isSymlink: entry.isSymbolicLink() }));
    }
    if (op === 'stat') {
      const info = await stat(path);
      return { size: info.size, mtime: info.mtimeMs };
    }
    const handle = await open(path, 'r');
    try {
      const size = op === 'read_file' ? (await handle.stat()).size : length;
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, op === 'read_file' ? 0 : offset);
      if (op === 'read' && options.readMsPerMebibyte) await new Promise((resolve) => setTimeout(resolve, (bytesRead / 1048576) * options.readMsPerMebibyte!));
      return buffer.subarray(0, bytesRead).toString('base64');
    } finally { await handle.close(); }
  });
  await page.exposeFunction('__kestrelTestDevelop', async (size: number) => {
    if (options.developDelayMs) await new Promise((resolve) => setTimeout(resolve, options.developDelayMs));
    const developed = options.developed?.[size];
    if (!developed) throw new Error('This RAW file could not be read.');
    return readFile(developed).then((bytes) => bytes.toString('base64'));
  });
  await page.exposeFunction('__kestrelTestCall', (name: string) => { calls.push(name); });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { __kestrelTestDialog: () => Promise<unknown>; __kestrelTestFs: (...a: unknown[]) => Promise<any>; __kestrelTestCall: (n: string) => void; __kestrelTestDevelop: (size: number) => Promise<string> };
    const decode = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const handles = new Map<number, { path: string; position: number }>();
    let nextId = 1;
    const callbacks = new Map<number, (value: unknown) => void>();
    const info = (size: number, mtime: number) => ({
      isFile: true, isDirectory: false, isSymlink: false, size, mtime, atime: mtime, birthtime: mtime, readonly: true,
      fileAttributes: null, dev: null, ino: null, mode: null, nlink: null, uid: null, gid: null, rdev: null, blksize: null, blocks: null,
    });
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      plugins: {},
      transformCallback(callback: (value: unknown) => void) { const id = nextId++; callbacks.set(id, callback); return id; },
      unregisterCallback(id: number) { callbacks.delete(id); },
      convertFileSrc(path: string) { return path; },
      async invoke(cmd: string, args: Record<string, any> = {}) {
        switch (cmd) {
          case 'plugin:dialog|open': return w.__kestrelTestDialog();
          case 'plugin:fs|read_dir': return w.__kestrelTestFs('read_dir', args.path);
          case 'plugin:fs|stat':
          case 'plugin:fs|lstat': { const s = await w.__kestrelTestFs('stat', args.path); return info(s.size, s.mtime); }
          case 'plugin:fs|read_file': return decode(await w.__kestrelTestFs('read_file', args.path)).buffer;
          case 'plugin:fs|open': { const rid = nextId++; handles.set(rid, { path: args.path, position: 0 }); return rid; }
          case 'plugin:fs|seek': {
            const handle = handles.get(args.rid)!;
            handle.position = args.whence === 0 ? args.offset : handle.position + args.offset;
            return handle.position;
          }
          case 'plugin:fs|read': {
            const handle = handles.get(args.rid)!;
            const bytes = decode(await w.__kestrelTestFs('read', handle.path, handle.position, args.len));
            handle.position += bytes.length;
            const out = new Uint8Array(bytes.length + 8);
            out.set(bytes);
            new DataView(out.buffer).setBigUint64(bytes.length, BigInt(bytes.length));
            return out.buffer;
          }
          case 'develop_raw': return decode(await w.__kestrelTestDevelop((args as unknown as Uint8Array).byteLength)).buffer;
          case 'plugin:resources|close': handles.delete(args.rid); return null;
          default: w.__kestrelTestCall(cmd); return null;
        }
      },
    };
  });
  return calls;
}
