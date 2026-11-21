import { expect, test } from '@playwright/test';

test('photo cards and Keep/Reject/Info touch targets stay onscreen from phone to desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Responsive decisions');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  const pictures = await page.evaluate(() => Array.from({ length: 6 }, (_, index) => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120;
    const paint = canvas.getContext('2d')!;
    paint.fillStyle = `rgb(${40 + index * 22},90,130)`;
    paint.fillRect(0, 0, 160, 120);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(pictures.map((data, index) => ({
    name: `responsive-${index}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64'),
  })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 6' })).toBeVisible({ timeout: 30_000 });
  const grid = page.getByTestId('virtualized-contact-sheet');
  for (const width of [320, 375, 420, 640, 960, 1280, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    const closeInfo = page.getByRole('button', { name: 'Close photo info', exact: true });
    if (await closeInfo.isVisible()) await closeInfo.click();
    await expect(grid).toBeVisible();
    await expect.poll(async () => {
      const bounds = await grid.boundingBox();
      if (!bounds) return false;
      const cards = await grid.getByRole('article').all();
      if (!cards.length) return false;
      for (const card of cards) {
        const box = await card.boundingBox();
        if (!box || box.x < bounds.x - 1 || box.x + box.width > bounds.x + bounds.width + 1) return false;
      }
      return true;
    }).toBe(true);
    const first = grid.getByRole('button', { name: 'View responsive-0.png', exact: true });
    if (await first.getAttribute('aria-pressed') !== 'true') await first.press('Space');
    const actions = page.getByRole('toolbar', { name: 'Actions for selected photos' });
    const more = actions.getByRole('button', { name: 'More actions', exact: true });
    await more.click({ timeout: 5000 });
    const menu = actions.getByRole('group', { name: 'More actions', exact: true });
    for (const [container, name] of [[actions, 'Keep'], [actions, 'Reject'], [actions, 'More actions'], [menu, 'Photo info']] as const) {
      const control = container.getByRole('button', { name, exact: true });
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box, `Missing ${name} at ${width}px`).toBeTruthy();
      expect(box!.width, `Narrow hit target at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `Short hit target at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    await page.keyboard.press('Escape');
  }
});
