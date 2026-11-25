import { expect, test, type Page } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Import storage behaves the same on every layout.');
});

/**
 * G07 (owner's 2,000-NEF test): leaving a project while it imports, and coming back, must not lose a photo, its
 * original or its preview. Synthetic photos; every read is slowed so the import is still running when the project is
 * left, as it is with a large card of RAWs.
 */
const COUNT = 24;

async function slowReads(page: Page) {
  await page.addInitScript(() => {
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function (this: Blob) {
      if ((window as unknown as { __slowReads?: boolean }).__slowReads) await new Promise((r) => setTimeout(r, 250));
      return read.call(this);
    };
  });
}

async function newProject(page: Page, name: string) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  await root.getByRole('button', { name: 'Import', exact: true }).first().waitFor();
  return root;
}

/** Drop COUNT distinct synthetic JPEGs, taken ten minutes apart so none is grouped into a burst. */
async function dropPhotos(page: Page) {
  await page.locator('.inflight-v2').evaluate(async (target, count) => {
    (window as unknown as { __slowReads?: boolean }).__slowReads = true;
    const transfer = new DataTransfer();
    for (let n = 0; n < count; n += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 214;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = `hsl(${(n * 47) % 360} 60% 50%)`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = '64px sans-serif';
      ctx.fillText(String(n + 1), 20, 120);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9));
      const name = `DSC_${String(n + 1).padStart(4, '0')}.jpg`;
      transfer.items.add(new File([blob], name, { type: 'image/jpeg', lastModified: Date.UTC(2025, 5, 14, 6) + n * 600_000 }));
    }
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, COUNT);
}

/** Photos in the strip whose preview has actually drawn. */
const drawnThumbnails = (page: Page) => page.locator('.inflight-v2').getByRole('listbox', { name: 'Project photographs' })
  .evaluate((list) => [...list.querySelectorAll('[role="option"] img')].filter((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0).length);

test('?v2 leaving a project mid-import and coming back keeps every photo, its original and its preview', async ({ page }) => {
  test.setTimeout(180_000);
  await slowReads(page);
  const root = await newProject(page, 'Leave mid-import');
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await dropPhotos(page);

  // The first photos arrive; leave while the rest are still importing.
  await expect(options.nth(1)).toBeVisible({ timeout: 60_000 });
  const before = await options.count();
  expect(before, 'the import is still running when the project is left').toBeLessThan(COUNT);
  await root.getByRole('button', { name: 'Back to projects' }).click();

  // Away for a while, then back.
  await page.waitForTimeout(3_000);
  await root.getByText('Leave mid-import', { exact: true }).first().click();
  await expect(options).toHaveCount(COUNT, { timeout: 120_000 });

  // Every photo has its preview, and none says its original is missing.
  await expect.poll(() => drawnThumbnails(page), { timeout: 60_000, message: 'every photo shows its preview' }).toBe(COUNT);
  for (const index of [0, before, COUNT - 1]) {
    await options.nth(index).click();
    await expect(root.getByText('Original not connected, preview only')).toHaveCount(0);
  }

  // And after a reload, too: the photos and their originals were stored, not just held in this tab.
  await page.evaluate(() => { (window as unknown as { __slowReads?: boolean }).__slowReads = false; });
  await page.reload();
  const title = root.getByText('Leave mid-import', { exact: true }).first();
  await expect(title.or(options.first()).first()).toBeVisible({ timeout: 30_000 });
  if (!await options.first().isVisible()) await title.click();
  await expect(options).toHaveCount(COUNT, { timeout: 60_000 });
  await expect.poll(() => drawnThumbnails(page), { timeout: 60_000 }).toBe(COUNT);
});
