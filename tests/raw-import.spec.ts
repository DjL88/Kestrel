import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const jpeg = readFileSync('src/assets/images/demo_red_kite_flight_1794721996053.jpg');

// Synthetic files in each maker's layout, carrying a real JPEG preview. They prove the import path, not a camera's own files.
function tiffWith(tags: [number, number][]) {
  const head = Buffer.alloc(10 + tags.length * 12 + 4);
  head.writeUInt16LE(0x4949, 0); head.writeUInt16LE(42, 2); head.writeUInt32LE(8, 4); head.writeUInt16LE(tags.length, 8);
  tags.forEach(([tag, value], i) => { const at = 10 + i * 12; head.writeUInt16LE(tag, at); head.writeUInt16LE(4, at + 2); head.writeUInt32LE(1, at + 4); head.writeUInt32LE(value, at + 8); });
  return Buffer.concat([head, Buffer.alloc(30_000 - head.length), jpeg, Buffer.alloc(256)]);
}
const files: Record<string, Buffer> = {
  'DSC00001.ARW': tiffWith([[0x0201, 30_000], [0x0202, jpeg.length]]),
  'IMG_0001.CR2': tiffWith([[0x0111, 30_000], [0x0117, jpeg.length]]),
  'IMG_0002.CR3': Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypcrx '), Buffer.alloc(12), Buffer.alloc(60_000), jpeg, Buffer.alloc(256)]),
};

for (const [name, buffer] of Object.entries(files)) {
  test(`${name} opens with its embedded preview and says so`, async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('quick-edit-input').setInputFiles({ name, mimeType: 'application/octet-stream', buffer });
    await page.getByRole('tab', { name: 'Edit' }).click({ timeout: 20000 });
    const all = page.getByRole('button', { name: 'All controls' });
    if (await all.isVisible()) await all.click(); // on a phone the full panel sits behind this button
    await expect(page.getByText("You're editing the quick preview", { exact: false }).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/no usable embedded JPEG/i)).toHaveCount(0);
  });
}
