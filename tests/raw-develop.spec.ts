import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openExportDialog } from './helpers';

const jpeg = readFileSync('src/assets/images/demo_red_kite_flight_1794721996053.jpg');
const raw = (() => {
  // A synthetic ARW: a TIFF directory pointing at the demo JPEG as its embedded preview.
  const head = Buffer.alloc(34);
  head.writeUInt16LE(0x4949, 0); head.writeUInt16LE(42, 2); head.writeUInt32LE(8, 4); head.writeUInt16LE(2, 8);
  [[0x0201, 30_000], [0x0202, jpeg.length]].forEach(([tag, value], i) => { const at = 10 + i * 12; head.writeUInt16LE(tag, at); head.writeUInt16LE(4, at + 2); head.writeUInt32LE(1, at + 4); head.writeUInt32LE(value, at + 8); });
  return Buffer.concat([head, Buffer.alloc(30_000 - 34), jpeg, Buffer.alloc(256)]);
})();

// The real decoder runs in the desktop app. Here the page believes it is in the desktop app and the native call is faked:
// it answers with a 3000 x 2000 picture, so the test can see that the editor and export switch to the developed picture.
async function asDesktop(page: import('@playwright/test').Page, behaviour: 'works' | 'fails' | 'sideways' | 'corrupt') {
  await page.addInitScript(([mode, kiteBase64]) => {
    const w = window as unknown as { __TAURI_INTERNALS__: unknown; __developCalls: number };
    w.__developCalls = 0;
    const shown: number[] = [];
    const blobs: Blob[] = [];
    (w as unknown as { __blobs: Blob[] }).__blobs = blobs;
    (w as unknown as { __shown: number[] }).__shown = shown;
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => { if (object instanceof Blob) { shown.push(object.size); blobs.push(object); } return original(object); };
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      invoke: async (command: string) => {
        if (command !== 'develop_raw') return 0;
        w.__developCalls += 1;
        if (mode === 'fails') throw 'This RAW file could not be read: unsupported compression.';
        if (mode === 'corrupt') return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer;
        if (mode === 'sideways') {
          // The same picture as the embedded preview, but lying on its side, as raw sensor data comes out.
          const bytes = Uint8Array.from(atob(kiteBase64 as string), (ch) => ch.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
          const turned = document.createElement('canvas'); turned.width = bitmap.height; turned.height = bitmap.width;
          const g = turned.getContext('2d')!; g.translate(turned.width / 2, turned.height / 2); g.rotate(-Math.PI / 2); g.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
          const sideways = await new Promise<Blob>((resolve) => turned.toBlob((b) => resolve(b!), 'image/jpeg', 0.9));
          return sideways.arrayBuffer();
        }
        const canvas = document.createElement('canvas'); canvas.width = 3000; canvas.height = 2000;
        const c = canvas.getContext('2d')!; c.fillStyle = '#446'; c.fillRect(0, 0, 3000, 2000);
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9));
        (w as unknown as { __developedSize: number }).__developedSize = blob.size;
        return blob.arrayBuffer();
      },
    };
  }, [behaviour, jpeg.toString('base64')] as const);
}

const openEdit = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'DSC00001.ARW', mimeType: 'application/octet-stream', buffer: raw });
  await page.getByRole('tab', { name: 'Edit' }).click({ timeout: 20000 });
  const all = page.getByRole('button', { name: 'All controls' });
  if (await all.isVisible()) await all.click();
};

test('a RAW file develops to full quality automatically, no click required', async ({ page }) => {
  await asDesktop(page, 'works');
  await openEdit(page);
  // The embedded preview makes the editor usable immediately - nothing to wait on. Not asserted as a visible
  // state here: a mocked "works" decode can resolve in well under one assertion poll, so the transient text is
  // not reliably observable and isn't what this test is checking anyway (see 'outside the desktop app' below).
  await expect(page.getByRole('img', { name: 'Edited photo' })).toBeVisible({ timeout: 20000 });
  // ...then silently swaps in the full decode, with no "Develop from RAW" click from the person.
  await expect(page.getByText('Developed from the RAW file')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Developed from the RAW file')).toContainText('8-bit JPEG');
  expect(await page.evaluate(() => (window as unknown as { __developCalls: number }).__developCalls)).toBe(1);
  // The picture handed to the editor after developing is the developed one, not the embedded preview.
  await expect.poll(() => page.evaluate(() => { const w = window as unknown as { __shown: number[]; __developedSize: number }; return w.__shown.includes(w.__developedSize); }), { timeout: 15000 }).toBe(true);
  await openExportDialog(page);
  await expect(page.getByText('Developed RAW files export from an 8-bit JPEG', { exact: false })).toBeVisible();
});

test('there is no RAW options menu or experimental TIFF button, and no retry until something has failed', async ({ page }) => {
  await asDesktop(page, 'fails');
  await openEdit(page);
  await expect(page.getByText('RAW options', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Save 16-bit TIFF/ })).toHaveCount(0);
});

test('when a RAW cannot be developed automatically, the person is told and can retry by hand', async ({ page }) => {
  await asDesktop(page, 'fails');
  await openEdit(page);
  await expect(page.getByRole('status').filter({ hasText: 'unsupported compression' })).toContainText('keeps using the preview stored in the file', { timeout: 20000 });
  await expect(page.getByText("You're editing the quick preview", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __developCalls: number }).__developCalls)).toBe(1);
  const retry = page.getByRole('button', { name: 'Develop from RAW' });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __developCalls: number }).__developCalls)).toBe(2);
});

test('in the web app a RAW the decoder cannot read behaves as on desktop: honest note, preview kept, retry offered', async ({ page }) => {
  // The web app develops RAW files with the same pipeline compiled to WebAssembly. This test file is only a TIFF
  // wrapper round a JPEG, with no sensor data, so development fails and the embedded preview is kept, as on desktop.
  await openEdit(page);
  await expect(page.getByRole('status').filter({ hasText: 'keeps using the preview stored in the file' })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText("You're editing the quick preview", { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Develop from RAW' })).toBeEnabled();
  // Nothing was developed, so there is no sensor data to offer as a 16-bit TIFF.
  await expect(page.getByRole('button', { name: /16-bit TIFF/ })).toHaveCount(0);
});

test('unreadable native output never replaces the working RAW preview', async ({ page }) => {
  await asDesktop(page, 'corrupt');
  await openEdit(page);
  await expect(page.getByRole('status').filter({ hasText: 'developed RAW picture could not be opened' })).toContainText('keeps using the preview stored in the file', { timeout: 20000 });
  await expect(page.getByText("You're editing the quick preview", { exact: false })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Edited photo' })).toBeVisible();
});

test('a developed picture that comes out sideways is turned to match the camera preview', async ({ page }) => {
  await asDesktop(page, 'sideways');
  await openEdit(page);
  await expect(page.getByText('Developed from the RAW file')).toBeVisible({ timeout: 30000 });
  const shape = await page.evaluate(async () => {
    const blobs = (window as unknown as { __blobs: Blob[] }).__blobs.filter((b) => b.type === 'image/jpeg');
    const sizes: string[] = [];
    for (const blob of blobs) { const bm = await createImageBitmap(blob); sizes.push(`${bm.width}x${bm.height}`); bm.close(); }
    return sizes;
  });
  // The preview is landscape. Every full-size picture handed to the editor after developing must be landscape too.
  const last = shape.at(-1)!.split('x').map(Number);
  expect(last[0], `last picture ${shape.at(-1)}`).toBeGreaterThan(last[1]);
});
