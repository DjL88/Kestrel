import { expect, test } from '@playwright/test';

test('export wizard: platform, size, position, then export', async ({ page }) => {
  await page.goto('/');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 900; canvas.height = 600;
    const c = canvas.getContext('2d')!;
    const g = c.createLinearGradient(0, 0, 900, 600); g.addColorStop(0, '#23405a'); g.addColorStop(1, '#d9a45c');
    c.fillStyle = g; c.fillRect(0, 0, 900, 600);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'wiz.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.getByRole('tab', { name: 'Export' }).click();
  await page.getByRole('button', { name: 'Choose formats and export…' }).click();

  // 1. Where to. Nothing can be skipped to before a place is chosen.
  const steps = page.getByRole('list', { name: 'Export steps' });
  await expect(steps.getByRole('listitem').first()).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Instagram' }).click();

  // 2. Size.
  await expect(page.getByRole('region', { name: 'Instagram sizes' })).toBeVisible();
  const next = page.getByRole('button', { name: 'Next', exact: true });
  await page.getByRole('checkbox', { name: /Post · 4:5/ }).check();
  await next.click();

  // 3. Position, with the preview, zoom and turn right there.
  await expect(page.getByRole('region', { name: 'Position' })).toBeVisible();
  const preview = page.getByRole('img', { name: /as Post · 4:5/ });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((canvas: HTMLCanvasElement) => Number((canvas.width / canvas.height).toFixed(2)))).toBe(0.8);
  await page.getByRole('button', { name: /Turn Post · 4:5 on its side/ }).click();
  await expect.poll(() => page.getByRole('img', { name: /as Post · 5:4/ }).evaluate((canvas: HTMLCanvasElement) => Number((canvas.width / canvas.height).toFixed(2)))).toBe(1.25);
  await next.click();

  // 4. Review, back and forward keep the choices, then export.
  await expect(page.getByRole('region', { name: 'Ready to export' })).toBeVisible();
  await expect(page.getByText('Post · 5:4').first()).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Position' })).toBeVisible();
  await next.click();
  await page.getByRole('button', { name: 'Prepare 1 file' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 file ready' })).toBeVisible({ timeout: 30000 });
});
