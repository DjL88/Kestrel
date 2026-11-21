import { expect, test, type Page } from '@playwright/test';

const png = (shade: number) => ({ name: `shot-${shade}.png`, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });

async function makeProject(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill(name);
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles([png(1), png(2)]);
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 2' })).toBeVisible({ timeout: 30_000 });
}

test('a project opens again after an export and after leaving the library', async ({ page }) => {
  await makeProject(page, 'Export then reopen');
  // Open the export dialog from the header, prepare the default export, then close the dialog.
  await page.locator('header').getByRole('button', { name: 'Export' }).first().click();
  const dialog = page.getByRole('dialog', { name: /Export/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^Prepare/ }).click();
  await expect(dialog.getByRole('button', { name: 'Close export' })).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Close export' }).click();
  await expect(dialog).toBeHidden();

  // Leave the project and open it again.
  await page.getByRole('button', { name: 'Back to projects' }).first().click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await page.getByRole('button', { name: /Export then reopen/ }).first().click();
  await expect(page.getByRole('navigation', { name: 'Photo collections' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: /All photos 2/ })).toBeVisible();
});

test('sharing keeps the prepared files on cancellation and closes export after handoff', async ({ page }) => {
  await page.addInitScript(() => {
    const attempts: { name: string; size: number; type: string }[][] = [];
    Object.defineProperty(window, 'testShareAttempts', { value: attempts });
    Object.defineProperty(navigator, 'canShare', { value: () => true });
    Object.defineProperty(navigator, 'share', {
      value: async ({ files }: ShareData) => {
        attempts.push((files ?? []).map(({ name, size, type }) => ({ name, size, type })));
        if (attempts.length === 1) throw new DOMException('Dismissed', 'AbortError');
        if (attempts.length === 2) throw new DOMException('Target unavailable', 'DataError');
      },
    });
  });
  await makeProject(page, 'Share then reopen');
  await page.locator('header').getByRole('button', { name: 'Export' }).first().click();
  const dialog = page.getByRole('dialog', { name: /Export/ });
  await dialog.getByRole('checkbox', { name: /^Full size · PNG/ }).check();
  await dialog.getByRole('button', { name: /^Prepare/ }).click();
  const share = dialog.getByRole('button', { name: 'Share / save to device' });

  await share.click();
  await expect(dialog.getByRole('status')).toHaveText('2 files ready');
  await expect(dialog.getByRole('alert')).toHaveCount(0);

  await share.click();
  await expect(dialog.getByRole('alert')).toHaveText('Could not share these files. Try downloading them.');
  await expect(share).toBeEnabled();

  await share.click();
  await expect(dialog).toBeHidden();
  const attempts = await page.evaluate(() => (window as unknown as {
    testShareAttempts: { name: string; size: number; type: string }[][];
  }).testShareAttempts);
  expect(attempts).toHaveLength(3);
  expect(attempts[0]).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[2]).toEqual(attempts[0]);
  expect(attempts[2].every(file => file.size > 0)).toBe(true);
  expect(attempts[2].map(file => file.type).sort()).toEqual(['image/jpeg', 'image/png']);
});
