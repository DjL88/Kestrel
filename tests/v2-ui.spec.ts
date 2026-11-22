import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'the V2 phone layout is checked in a later slice');
});

test('V2 is off by default and the current app is untouched', async ({ page }) => {
  await page.goto('/?v2=0');
  await expect(page.locator('.inflight-v2')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
});

test('?v2&stub=1 shows the sample-data hub, opens a project and toggles Compare', async ({ page }) => {
  await page.goto('/?v2&stub=1');
  const root = page.locator('.inflight-v2');
  await expect(root).toBeVisible();
  // Scoped tokens: the current app's styles are not changed.
  expect(await root.evaluate((el) => getComputedStyle(el).getPropertyValue('--brand-accent').trim())).toBe('#e8743c');
  expect(await page.evaluate(() => document.documentElement.dataset.theme ?? '')).not.toBe('light');
  await root.getByRole('button', { name: /Scottish Highlands/ }).first().click();
  const compare = root.getByRole('button', { name: 'Compare', exact: true });
  await expect(compare).toHaveAttribute('aria-pressed', 'false');
  await compare.click();
  await expect(compare).toHaveAttribute('aria-pressed', 'true');
  await expect(root.getByText('Before', { exact: true }).first()).toBeVisible();
});

test('leaving V2 with ?v2=0 restores the current app', async ({ page }) => {
  await page.goto('/?v2');
  await expect(page.locator('.inflight-v2')).toBeVisible();
  await page.goto('/?v2=0');
  await expect(page.locator('.inflight-v2')).toHaveCount(0);
});

test('?v2 runs on the real catalogue: create, import, flag, rate, reload and the photos are still there', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await expect(root.getByText('No projects yet')).toBeVisible();
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Real store check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // An empty real project: import three generated photos through the real loader.
  const images = await page.evaluate(() => Array.from({ length: 3 }, (_, i) => {
    const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 130;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = ['#586b82', '#776c56', '#5d735d'][i]; ctx.fillRect(0, 0, 180, 130);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles(images.map((img, i) => ({ name: `real-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(img, 'base64') })));
  const strip = root.getByRole('listbox', { name: 'Project photographs' });
  await expect(strip.getByRole('option')).toHaveCount(3);
  await expect(strip.getByText('Ready to edit').first()).toBeVisible();
  // Flag the first photo and rate it: both go through the catalogue's own decision path.
  await strip.getByRole('button', { name: 'Flag real-1.png' }).click();
  await expect(strip.getByRole('button', { name: 'Unflag real-1.png' })).toBeVisible();
  await root.getByRole('button', { name: 'Info', exact: true }).first().click();
  await root.getByRole('button', { name: 'Rate 4 stars' }).click();
  // Back to the hub: the project shows 3 photos and 1 flagged. Then a full reload keeps them.
  await root.getByRole('button', { name: /back|projects/i }).first().click();
  await expect(root.getByText('3 photos')).toBeVisible();
  await expect(root.getByText('1 flagged')).toBeVisible();
  await page.reload();
  await expect(root.getByText('3 photos')).toBeVisible();
  await root.getByRole('button', { name: /Open studio/ }).first().click();
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(3);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('button', { name: 'Unflag real-1.png' })).toBeVisible();
});
