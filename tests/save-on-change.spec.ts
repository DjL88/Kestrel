import { expect, test, type Page } from '@playwright/test';

async function project(page: Page) {
  await page.goto('/');
  const pictures = await page.evaluate(() => Array.from({ length: 3 }, (_, index) => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300;
    const c = canvas.getContext('2d')!; c.fillStyle = `rgb(${60 + index * 40},90,120)`; c.fillRect(0, 0, 400, 300);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Batching');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(pictures.map((data, i) => ({ name: `s-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 3' })).toBeVisible({ timeout: 30000 });
}

test('leaving a project straight after a change saves it', async ({ page }) => {
  await project(page);
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Keep s-2.png', exact: true }).click();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await page.getByRole('button', { name: /Batching/ }).first().click({ timeout: 15000 });
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'Keepers 1' })).toBeVisible({ timeout: 15000 });
});
