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

test('first run asks for a language even on an English (UK) system; the choice stays saved', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to Kestrel' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
  await page.getByRole('button', { name: 'Continue in English (UK)' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Kestrel' })).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome to Kestrel' })).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
});

test.describe('Canadian French system locale', () => {
  test.use({ locale: 'fr-CA' });

  test('offers the detected regional language once, then honours the chosen language', async ({ page }) => {
    await page.goto('/');
    const welcome = page.getByRole('heading', { name: 'Welcome to Kestrel' });
    await expect(welcome).toBeVisible();
    const chooser = page.getByLabel('Which language would you like?');
    await expect(chooser).toHaveValue('fr-CA');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB', 'device preference is offered, not applied automatically');
    await page.getByRole('button', { name: 'Continue in Français (Canada)' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
    await expect(page.getByRole('heading', { name: 'Projets' })).toBeVisible();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
    await expect(welcome).toBeHidden();
  });
});
