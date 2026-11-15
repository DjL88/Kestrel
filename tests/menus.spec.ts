import { expect, test } from '@playwright/test';

async function makeProject(page: import('@playwright/test').Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill(name);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
}

test('grid actions are reachable at every width and never run off the screen', async ({ page }) => {
  await makeProject(page, 'Menus');
  for (const name of ['Add photos to project', 'Edit', 'Export']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  const phone = page.viewportSize()!.width < 768;
  // On a phone the actions sit in a footer within thumb reach, and More opens the rest as a sheet above it.
  if (phone) {
    const footer = page.getByRole('toolbar', { name: 'Photo actions' });
    const box = (await footer.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(page.viewportSize()!.height - 2);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    const sheet = page.locator('#workspace-options');
    await expect(sheet).toBeVisible();
    expect((await sheet.boundingBox())!.y + (await sheet.boundingBox())!.height).toBeLessThanOrEqual(box.y + 1);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  }
});

test('the editor can go full screen and come back', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles({
    name: 'f.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  });
  await page.getByRole('tab', { name: 'Crop' }).waitFor();
  const full = page.getByRole('button', { name: 'Full screen' });
  test.skip(!(await full.count()), 'This browser does not allow full screen');
  await full.click();
  await expect(page.getByRole('button', { name: 'Leave full screen' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Leave full screen' }).click();
  await expect(page.getByRole('button', { name: 'Full screen' })).toHaveAttribute('aria-pressed', 'false');
});

test('rating filter is one row of stars: tap sets, tap again clears, the symbol flips to exactly', async ({ page }) => {
  await makeProject(page, 'Stars');
  const three = page.getByRole('button', { name: '3 stars or more' });
  await three.click();
  await expect(three).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Matching this rating or more/ }).click();
  await expect(page.getByRole('button', { name: 'Exactly 3 stars' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Exactly 3 stars' }).click();
  await expect(page.getByRole('button', { name: 'Exactly 3 stars' })).toHaveAttribute('aria-pressed', 'false');
});
