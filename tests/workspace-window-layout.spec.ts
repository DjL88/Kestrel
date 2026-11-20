import { expect, test, type Page } from '@playwright/test';

async function openOnePhotoProject(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Workspace width parity');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#456688'; ctx.fillRect(0, 0, 640, 480);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({
    name: 'bird-at-window.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64'),
  });
  await expect(page.getByRole('navigation', { name: 'Photo collections' })
    .getByRole('button', { name: /To review 1/ })).toBeVisible({ timeout: 30_000 });
}

test('900px tablet view never covers the photo with default Photo Info; editor retains one-tap access', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await openOnePhotoProject(page);
  await expect(page.locator('aside[aria-label="Photo info"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page.getByRole('region', { name: 'Photo editor' })).toBeVisible();
  await page.locator('header').getByRole('button', { name: 'Photo info' }).click();
  await expect(page.locator('aside[aria-label="Photo info"]')).toBeVisible();
  await page.getByRole('button', { name: 'Close photo info' }).click();
  await expect(page.locator('aside[aria-label="Photo info"]')).toHaveCount(0);
  await expect(page.locator('header').getByRole('button', { name: 'Photo info' })).toBeFocused();
});

test('detached Photo Info and Editing Tools can be focused independently without hiding Settings', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openOnePhotoProject(page);
  await page.getByRole('button', { name: 'Undock Photo Info' }).click();
  const info = page.locator('[data-floating-pane="kestrel-info-float-rect-v1"]');
  await expect(info).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByRole('button', { name: 'Undock editing tools' }).click();
  const tools = page.locator('[data-floating-pane="kestrel-tools-float-rect-v1"]');
  await expect(tools).toBeVisible();

  await info.getByRole('button', { name: /Move Photo info/ }).focus();
  const orderA = await page.evaluate(() => ({
    info: Number(getComputedStyle(document.querySelector('[data-floating-pane="kestrel-info-float-rect-v1"]')!).zIndex),
    tools: Number(getComputedStyle(document.querySelector('[data-floating-pane="kestrel-tools-float-rect-v1"]')!).zIndex),
  }));
  expect(orderA.info).toBeGreaterThan(orderA.tools);

  await tools.getByRole('button', { name: /Move Editing tools/ }).focus();
  const orderB = await page.evaluate(() => ({
    info: Number(getComputedStyle(document.querySelector('[data-floating-pane="kestrel-info-float-rect-v1"]')!).zIndex),
    tools: Number(getComputedStyle(document.querySelector('[data-floating-pane="kestrel-tools-float-rect-v1"]')!).zIndex),
  }));
  expect(orderB.tools).toBeGreaterThan(orderB.info);

  await page.locator('header').getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Display and layout settings' });
  await expect(settings).toBeVisible();
  const modalZ = await settings.evaluate((node) => Number(getComputedStyle(node.parentElement!).zIndex));
  expect(modalZ).toBeGreaterThan(orderB.tools);
  await settings.getByRole('button', { name: 'Done' }).click();

  const pin = tools.getByRole('button', { name: 'Keep Editing tools visible in Photo only' });
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('f');
  await expect(tools).toBeVisible();
  await expect(info).toHaveCount(0);
  await page.getByRole('button', { name: /Exit Photo only/i }).click();
  await expect(info).toBeVisible();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');

  await tools.getByRole('button', { name: /Move Editing tools/ }).focus();
  await page.keyboard.press('Escape');
  await expect(tools).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Photo editor' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undock editing tools' })).toBeFocused();
});
