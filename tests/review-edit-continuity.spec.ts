import { test, expect } from '@playwright/test';

test('review selection survives the complete Edit → Review return journey', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Selection continuity');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();

  const pictures = await page.evaluate(() => [0, 1, 2].map((index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext('2d')!;
    context.fillStyle = ['#94552c', '#346388', '#598466'][index];
    context.fillRect(0, 0, 320, 240);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(pictures.map((data, index) => ({
    name: `continuity-${index + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64'),
  })));
  const collections = page.getByRole('navigation', { name: 'Photo collections' });
  await expect(collections.getByRole('button', { name: 'To review 3' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: page.viewportSize()!.width < 768 ? 'More' : 'Workspace options', exact: true }).click();
  await page.getByRole('button', { name: 'Select photos' }).click();
  await page.getByRole('button', { name: 'Select continuity-1.png', exact: true }).click();
  await page.getByRole('button', { name: 'Select continuity-2.png', exact: true }).click();
  const first = page.getByRole('article', { name: 'Frame continuity-1.png' });
  const second = page.getByRole('article', { name: 'Frame continuity-2.png' });
  await expect(first.getByTestId('tile-selected')).toBeVisible();
  await expect(second.getByTestId('tile-selected')).toBeVisible();

  await page.getByRole('button', { name: 'Edit selected', exact: true }).first().click();
  await expect(page.getByRole('region', { name: 'Photo editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(first.getByTestId('tile-selected')).toBeVisible();
  await expect(second.getByTestId('tile-selected')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Frame continuity-3.png' }).getByTestId('tile-selected')).toHaveCount(0);
});

test('workspace options route appearance to the one global Settings dialog', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 768, 'Desktop toolbar: phone uses the compact More control');
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('One Settings');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Workspace options' }).click();
  const menu = page.locator('[data-workspace-options]');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Display and layout', exact: true })).toBeVisible();
  await menu.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /Display and layout settings/i })).toBeVisible();
});
