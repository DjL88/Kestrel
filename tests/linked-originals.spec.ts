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
    // A real stat() and read_file() always agree on a file's size; the app now treats any mismatch as the
    // original changing mid-import. Cache each photo's bytes so both calls (and the post-reload relink) see
    // the same size instead of racing two independent, unrelated numbers.
    const bytes = new Map<string, Promise<ArrayBuffer>>();
    const bytesFor = (path: string) => {
      if (!bytes.has(path)) bytes.set(path, png(files[path] ?? 0));
      return bytes.get(path)!;
    };
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      invoke: async (command: string, args: { path?: string }) => {
        if (command === 'plugin:dialog|open') return Object.keys(files);
        if (command === 'plugin:fs|stat') {
          const buf = await bytesFor(args.path!);
          return { isFile: true, isDirectory: false, isSymlink: false, size: buf.byteLength, mtime: 1700000000000 + (files[args.path!] ?? 0), atime: null, birthtime: null, readonly: false, fileAttributes: null, dev: 0, ino: null, mode: 0, nlink: null, uid: 0, gid: 0, rdev: 0, blksize: 0, blocks: 0 };
        }
        if (command === 'plugin:fs|read_file') { w.__reads.push(args.path!); return bytesFor(args.path!); }
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
});
