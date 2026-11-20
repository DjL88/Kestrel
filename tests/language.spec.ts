import { expect, test } from '@playwright/test';

async function settings(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  return page.getByRole('dialog', { name: 'Appearance and layout settings' });
}

test('British English by default, with British dates, whatever the browser says', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Dates');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const paint = canvas.getContext('2d')!; paint.fillStyle = '#456'; paint.fillRect(0, 0, 320, 240);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({ name: 'when.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(picture, 'base64') });
  const collections = page.getByRole('navigation', { name: 'Photo collections' });
  await expect(collections.getByRole('button', { name: 'To review 1' })).toBeVisible({ timeout: 30_000 });
  if ((page.viewportSize()?.width ?? 1280) >= 1024) {
    // Photo info is open by default on wide screens. "Nov 19, 2026, 08:46:46 PM" was shown before.
    const captured = page.getByText('Captured', { exact: true }).locator('xpath=following-sibling::*[1]');
    await expect(captured).toHaveText(/^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}:\d{2}$/);
  }
});

test('choose Welsh, restart in it, and keep every decision', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Adar');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  const pictures = await page.evaluate(() => [0, 1].map((index) => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const paint = canvas.getContext('2d')!; paint.fillStyle = index ? '#654' : '#456'; paint.fillRect(0, 0, 320, 240);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(pictures.map((data, index) => ({
    name: `adar-${index + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64'),
  })));
  const collections = page.getByRole('navigation', { name: 'Photo collections' });
  await expect(collections.getByRole('button', { name: 'To review 2' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Keep adar-1.png', exact: true }).click();
  await expect(collections.getByRole('button', { name: 'Keepers 1' })).toBeVisible();

  const dialog = await settings(page);
  // Each language is listed by its own name; the label also says "Language" in English once another is in use.
  const picker = dialog.getByLabel('Language');
  await picker.selectOption('cy');
  // Nothing changes until the restart is asked for, and the warning is in Welsh so a Welsh speaker can read it.
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
  await expect(dialog.getByText(/Cyfieithiad drafft/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Ailgychwyn yn Cymraeg' }).click();

  await expect(page.locator('html')).toHaveAttribute('lang', 'cy');
  await expect(page.getByRole('heading', { name: 'Prosiectau' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Adar/ }).first().click();
  const welsh = page.getByRole('navigation', { name: 'Photo collections' });
  await expect(welsh.getByRole('button', { name: 'I’w cadw 1' })).toBeVisible({ timeout: 30_000 });
  await expect(welsh.getByRole('button', { name: 'I’w hadolygu 1' })).toBeVisible();

  // And back again: the label keeps the English word, so nobody is stranded in a language they can't read.
  const again = await settings(page);
  await again.getByLabel(/Language/).selectOption('en-GB');
  await again.getByRole('button', { name: 'Restart in English (UK)' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible({ timeout: 30_000 });
});

test.describe('a Danish device at first run', () => {
  test.use({ locale: 'da-DK' });

  test('is offered Danish once, and nothing changes until it is chosen', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
    const welcome = page.locator('section', { has: page.getByRole('combobox') }).filter({ hasText: 'Dansk' }).first();
    await expect(welcome).toBeVisible();
    await expect(welcome.getByRole('combobox')).toHaveValue('da');
    // The button is written in the language on offer, and names it in its own words.
    await welcome.getByRole('button', { name: /Dansk/ }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'da');
    // Chosen once: the card does not come back.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'da');
    await expect(page.getByRole('button', { name: /Dansk/ })).toHaveCount(0);
  });

  test('keeping British English hides the card for good', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Keep English (UK)' }).click();
    await expect(page.getByRole('button', { name: 'Keep English (UK)' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Keep English (UK)' })).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
  });
});

test('a British device is not asked: it is already in its language', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep English (UK)' })).toHaveCount(0);
});
