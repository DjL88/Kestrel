import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

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
async function asDesktop(page: import('@playwright/test').Page, behaviour: 'works' | 'fails') {
  await page.addInitScript((mode) => {
    const w = window as unknown as { __TAURI_INTERNALS__: unknown; __developCalls: number };
    w.__developCalls = 0;
    const shown: number[] = [];
    (w as unknown as { __shown: number[] }).__shown = shown;
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => { if (object instanceof Blob) shown.push(object.size); return original(object); };
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      invoke: async (command: string) => {
        if (command !== 'develop_raw') return 0;
        w.__developCalls += 1;
        if (mode === 'fails') throw 'This RAW file could not be read: unsupported compression.';
        const canvas = document.createElement('canvas'); canvas.width = 3000; canvas.height = 2000;
        const c = canvas.getContext('2d')!; c.fillStyle = '#446'; c.fillRect(0, 0, 3000, 2000);
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9));
        (w as unknown as { __developedSize: number }).__developedSize = blob.size;
        return blob.arrayBuffer();
      },
    };
  }, behaviour);
}

const openEdit = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'DSC00001.ARW', mimeType: 'application/octet-stream', buffer: raw });
  await page.getByRole('tab', { name: 'Edit' }).click({ timeout: 20000 });
  const all = page.getByRole('button', { name: 'All controls' });
  if (await all.isVisible()) await all.click();
};

test('Develop from RAW swaps the embedded preview for the full developed picture', async ({ page }) => {
  await asDesktop(page, 'works');
  await openEdit(page);
  await expect(page.getByText('Editing embedded JPEG preview')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Develop from RAW' }).click();
  await expect(page.getByText('Developed from the RAW file')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Develop from RAW' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __developCalls: number }).__developCalls)).toBe(1);
  // The picture handed to the editor after developing is the developed one, not the embedded preview.
  await expect.poll(() => page.evaluate(() => { const w = window as unknown as { __shown: number[]; __developedSize: number }; return w.__shown.includes(w.__developedSize); }), { timeout: 15000 }).toBe(true);
});

test('when a RAW cannot be developed, the person is told and the preview keeps working', async ({ page }) => {
  await asDesktop(page, 'fails');
  await openEdit(page);
  await page.getByRole('button', { name: 'Develop from RAW' }).click({ timeout: 20000 });
  await expect(page.getByRole('status').filter({ hasText: 'unsupported compression' })).toContainText('keeps using the preview stored in the file');
  await expect(page.getByText('Editing embedded JPEG preview')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Develop from RAW' })).toBeEnabled();
});

test('outside the desktop app there is no Develop button, only the honest preview note', async ({ page }) => {
  await openEdit(page);
  await expect(page.getByText('Editing embedded JPEG preview')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Develop from RAW' })).toHaveCount(0);
});
