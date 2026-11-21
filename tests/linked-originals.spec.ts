import { expect, test } from '@playwright/test';

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 768, 'the desktop app is not a phone');

// The desktop app picks photos with the system dialog and reads them from where they are. Here the page believes it is the
// desktop app and the dialog and file reads are faked, so the test can see that nothing is copied into the app's storage.
test('desktop: photos stay where they are, nothing is copied into the app, and they still open after a restart', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __TAURI_INTERNALS__: unknown; __reads: string[] };
    w.__reads = [];
    const png = (hue: number) => {
      const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 400;
      const c = canvas.getContext('2d')!; c.fillStyle = `hsl(${hue},60%,45%)`; c.fillRect(0, 0, 600, 400);
      return new Promise<ArrayBuffer>((resolve) => canvas.toBlob((b) => b!.arrayBuffer().then(resolve), 'image/png'));
    };
    const files: Record<string, number> = { 'C:/shots/a.png': 10, 'C:/shots/b.png': 200 };
    // Match stat() and read_file() to one stable payload for each source file.
    // An asynchronous PNG encoder can otherwise return unrelated bytes while
    // the app correctly checks whether the source size changed during import.
    const bytes = new Map<string, Promise<ArrayBuffer>>();
    const bytesFor = (path: string) => {
      if (!bytes.has(path)) bytes.set(path, png(files[path] ?? 0));
      return bytes.get(path)!;
    };
    const recoveryRoot = 'D:/recovery';
    const recoveryMode = () => localStorage.getItem('test-original-recovery');
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      invoke: async (command: string, args: { path?: string; options?: { directory?: boolean } }) => {
        if (command === 'plugin:dialog|open') return args.options?.directory ? recoveryRoot : Object.keys(files);
        if (command === 'plugin:fs|read_dir' && args.path === recoveryRoot) {
          return ['a.png', 'b.png'].map(name => ({ name, isFile: true, isDirectory: false, isSymlink: false }));
        }
        const path = args.path ?? '';
        const recoveryCopy = path.startsWith(recoveryRoot + '/');
        const source = recoveryCopy ? path.replace(recoveryRoot, 'C:/shots') : path;
        if (recoveryMode() && !recoveryCopy && path === 'C:/shots/b.png') throw new Error('No such file');
        if (command === 'plugin:fs|stat') {
          const changedTime = recoveryCopy && source === 'C:/shots/b.png' && recoveryMode() === 'approximate' ? 30_000 : 0;
          return { isFile: true, isDirectory: false, isSymlink: false, size: (await bytesFor(source)).byteLength, mtime: 1700000000000 + (files[source] ?? 0) + changedTime, atime: null, birthtime: null, readonly: false, fileAttributes: null, dev: 0, ino: null, mode: 0, nlink: null, uid: 0, gid: 0, rdev: 0, blksize: 0, blocks: 0 };
        }
        if (command === 'plugin:fs|read_file') { w.__reads.push(path); return bytesFor(source); }
        return 0;
      },
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Linked');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByRole('button', { name: 'Choose files' }).click();
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 2' })).toBeVisible({ timeout: 30000 });

  // Nothing was copied into the app's own storage.
  const copies = await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open('kestrel-cull-v1');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('localFiles')) return resolve(0);
      const count = db.transaction('localFiles').objectStore('localFiles').count();
      count.onsuccess = () => resolve(count.result);
    };
  }));
  expect(copies).toBe(0);

  // The grid shows both photos, which were read from their paths.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __reads: string[] }).__reads.length)).toBeGreaterThan(1);

  // After a restart they are linked again from the saved paths, with no "reconnect" step.
  await page.waitForTimeout(800);
  await page.reload();
  await page.getByRole('button', { name: /Linked/ }).first().click();
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 2' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/reconnect|re-select|reselect/i)).toHaveCount(0);

  // Recover only the missing link. The other source still lives at its recorded
  // path, even though the recovery folder happens to contain an identical name.
  await page.evaluate(() => localStorage.setItem('test-original-recovery', 'approximate'));
  await page.reload();
  await page.getByRole('button', { name: /Linked/ }).first().click();
  const reconnect = page.getByRole('button', { name: 'Re-open Files', exact: true });
  await reconnect.click();
  await expect(page.getByText('No matching originals found.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __reads: string[] }).__reads)).not.toContain('D:/recovery/b.png');

  await page.evaluate(() => localStorage.setItem('test-original-recovery', 'exact'));
  await reconnect.click();
  await expect(reconnect).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __reads: string[] }).__reads)).toContain('D:/recovery/b.png');
  expect(await page.evaluate(() => (window as unknown as { __reads: string[] }).__reads)).not.toContain('D:/recovery/a.png');
});

// A desktop import needs a RAW's embedded preview and its EXIF, not the whole file (about 3 MB of a 29 MB Z8 NEF).
// The fake file system here answers ranged reads (open, seek, read) and counts every byte handed over.
test('desktop: importing a RAW reads only its preview and EXIF, never the whole file', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __TAURI_INTERNALS__: unknown; __wholeReads: number; __rangedBytes: number; __size: number };
    w.__wholeReads = 0; w.__rangedBytes = 0;
    const RAW_PADDING = 20 * 1024 * 1024; // stands in for the sensor data after the preview
    const nef = (async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
      const c = canvas.getContext('2d')!; c.fillStyle = 'hsl(200,55%,45%)'; c.fillRect(0, 0, 1200, 800);
      c.fillStyle = '#d4a017'; c.fillRect(400, 250, 400, 300);
      const jpeg = new Uint8Array(await (await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.9))).arrayBuffer());
      const at = 1024;
      const bytes = new Uint8Array(at + jpeg.length + RAW_PADDING);
      const view = new DataView(bytes.buffer);
      bytes.set([0x49, 0x49, 42, 0]); view.setUint32(4, 8, true); view.setUint16(8, 2, true);
      const entry = (i: number, tag: number, value: number) => { const o = 10 + i * 12; view.setUint16(o, tag, true); view.setUint16(o + 2, 4, true); view.setUint32(o + 4, 1, true); view.setUint32(o + 8, value, true); };
      entry(0, 0x0201, at); entry(1, 0x0202, jpeg.length); view.setUint32(34, 0, true);
      bytes.set(jpeg, at);
      w.__size = bytes.length;
      return bytes;
    })();
    const handles = new Map<number, number>(); let nextRid = 1;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      invoke: async (command: string, args: { path?: string; rid?: number; offset?: number; len?: number }) => {
        const file = await nef;
        if (command === 'plugin:dialog|open') return ['C:/shots/z8.nef'];
        if (command === 'plugin:fs|stat') return { isFile: true, isDirectory: false, isSymlink: false, size: file.length, mtime: 1700000000000, atime: null, birthtime: null, readonly: false, fileAttributes: null, dev: 0, ino: null, mode: 0, nlink: null, uid: 0, gid: 0, rdev: 0, blksize: 0, blocks: 0 };
        if (command === 'plugin:fs|read_file') { w.__wholeReads += 1; return file.buffer; }
        if (command === 'plugin:fs|open') { const rid = nextRid++; handles.set(rid, 0); return rid; }
        if (command === 'plugin:fs|seek') { handles.set(args.rid!, args.offset!); return args.offset; }
        if (command === 'plugin:fs|read') {
          const from = handles.get(args.rid!) ?? 0;
          const chunk = file.subarray(from, Math.min(file.length, from + args.len!));
          handles.set(args.rid!, from + chunk.length);
          w.__rangedBytes += chunk.length;
          const out = new Uint8Array(chunk.length + 8);
          out.set(chunk);
          new DataView(out.buffer).setBigUint64(chunk.length, BigInt(chunk.length));
          return out.buffer;
        }
        if (command === 'plugin:resources|close') { handles.delete(args.rid!); return null; }
        return 0;
      },
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Ranged');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByRole('button', { name: 'Choose files' }).click();
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 1' })).toBeVisible({ timeout: 30000 });
  const stats = await page.evaluate(() => {
    const w = window as unknown as { __wholeReads: number; __rangedBytes: number; __size: number };
    return { whole: w.__wholeReads, ranged: w.__rangedBytes, size: w.__size };
  });
  expect(stats.whole, 'the whole RAW was never read during import').toBe(0);
  expect(stats.ranged).toBeGreaterThan(0);
  expect(stats.ranged, `read ${stats.ranged} of ${stats.size} bytes`).toBeLessThan(stats.size / 4);
});
