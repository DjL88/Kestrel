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
