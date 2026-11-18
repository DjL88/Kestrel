import { expect, test, type Page } from '@playwright/test';

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 768, 'exercised on desktop; the phone menu differs');

async function project(page: Page, count: number) {
  await page.goto('/');
  const pictures = await page.evaluate((n) => Array.from({ length: n }, (_, i) => {
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 1100;
    const c = canvas.getContext('2d')!; const g = c.createLinearGradient(0, 0, 1600, 1100); g.addColorStop(0, `hsl(${i * 23},50%,30%)`); g.addColorStop(1, `hsl(${i * 23 + 90},60%,65%)`); c.fillStyle = g; c.fillRect(0, 0, 1600, 1100);
    for (let k = 0; k < 120; k += 1) { c.fillStyle = `rgba(${(k * 37 + i * 20) % 255},${(k * 91) % 255},${(k * 53) % 255},0.6)`; c.fillRect((k * 83 + i * 31) % 1560, (k * 47) % 1060, 40, 40); }
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  }), count);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Background cull');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(pictures.map((data, i) => ({ name: `b-${String(i + 1).padStart(2, '0')}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(data, 'base64') })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: `To review ${count}` })).toBeVisible({ timeout: 60000 });
}

async function openAutoCull(page: Page) {
  await page.getByRole('button', { name: 'More', exact: true }).or(page.getByRole('button', { name: 'Workspace options' })).click();
  await page.locator('#workspace-options').getByRole('button', { name: /Auto-cull/ }).click();
}

test('culling can carry on in the background while the photos are used, and comes back with its results', async ({ page }) => {
  test.setTimeout(180_000);
  await project(page, 40);
  await openAutoCull(page);
  const dialog = page.getByRole('dialog', { name: /Auto-cull/ });
  await dialog.getByRole('button', { name: /^Scan|Scan/ }).first().click();

  // While it scans, the photographer can put it away and keep working.
  await dialog.getByRole('button', { name: 'Cull in the background' }).click();
  await expect(dialog).toBeHidden();
  const collections = page.getByRole('navigation', { name: 'Photo collections' });
  await collections.getByRole('button', { name: /^All/ }).click();
  await expect(collections.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-current', 'page');

  // Opening Auto-cull again shows the same run (still scanning or finished), not a second scan.
  await openAutoCull(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Auto-cull summary' })).toBeVisible({ timeout: 120000 });
  await expect(dialog.getByText(/Scan finished · 40 photos/)).toBeVisible();
});

test('closing the panel while it scans keeps the scan going instead of throwing the work away', async ({ page }) => {
  test.setTimeout(180_000);
  await project(page, 40);
  await openAutoCull(page);
  const dialog = page.getByRole('dialog', { name: /Auto-cull/ });
  await dialog.getByRole('button', { name: /^Scan|Scan/ }).first().click();
  await expect(dialog.getByRole('button', { name: 'Cull in the background' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await openAutoCull(page);
  await expect(dialog.getByRole('region', { name: 'Auto-cull summary' })).toBeVisible({ timeout: 120000 });
});
