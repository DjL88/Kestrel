import { expect, test, type Page } from '@playwright/test';

async function project(page: Page) {
  await page.goto('/');
  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 90;
    const c = canvas.getContext('2d')!; c.fillStyle = '#456'; c.fillRect(0, 0, 120, 90);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Selection bar');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(['one.png', 'two.png'].map((name) =>
    ({ name, mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 2' }))
    .toBeVisible({ timeout: 30000 });
}

test('the selection bar shows the everyday actions and keeps the rest behind More actions', async ({ page }) => {
  await project(page);
  await page.getByLabel('Frame one.png').click();
  const bar = page.getByRole('toolbar', { name: 'Actions for selected photos' });
  await expect(bar).toBeVisible();
  const phone = await page.evaluate(() => matchMedia('(pointer: coarse) and ((max-width: 599px) or (max-height: 500px))').matches);
  for (const name of phone ? ['Keep', 'Reject', 'Undecided'] : ['Keep', 'Reject', 'Edit photo', 'Export']) {
    await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
  }
  if (phone) {
    await expect(page.getByRole('toolbar', { name: 'Photo actions' }).getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    await expect(page.getByRole('banner').getByRole('button', { name: 'Export', exact: true })).toBeVisible();
  }
  for (const name of ['Reset edit', 'Auto-adjust', 'Apply look']) {
    await expect(bar.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  const more = bar.getByRole('button', { name: 'More actions' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const menu = bar.getByRole('group', { name: 'More actions', exact: true });
  for (const name of ['Undecided', 'Reset edit', 'Photo info']) {
    await expect(menu.getByRole('button', { name, exact: true })).toBeVisible();
  }
  // Escape closes only this menu and puts focus back where it came from.
  await page.keyboard.press('Escape');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(more).toBeFocused();
  await expect(bar).toBeVisible();
});

test('choosing from More actions closes the menu, and a click elsewhere also closes it', async ({ page }) => {
  await project(page);
  await page.getByLabel('Frame one.png').click();
  const bar = page.getByRole('toolbar', { name: 'Actions for selected photos' });
  const more = bar.getByRole('button', { name: 'More actions' });
  await more.click();
  await bar.getByRole('button', { name: 'Reset edit', exact: true }).click();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await page.mouse.click(5, 5);
  await expect(more).toHaveAttribute('aria-expanded', 'false');
});
