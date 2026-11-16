import { expect, test, type Page } from '@playwright/test';

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 768, 'exercised on desktop; the phone menu differs');

async function project(page: Page) {
  await page.goto('/');
  const pictures = await page.evaluate(() => Array.from({ length: 6 }, (_, i) => {
    const canvas = document.createElement('canvas'); canvas.width = 500; canvas.height = 340;
    const c = canvas.getContext('2d')!; const g = c.createLinearGradient(0, 0, 500, 340); g.addColorStop(0, `hsl(${i * 55},50%,30%)`); g.addColorStop(1, `hsl(${i * 55 + 90},60%,65%)`); c.fillStyle = g; c.fillRect(0, 0, 500, 340);
    for (let k = 0; k < 60; k += 1) { c.fillStyle = `rgba(${(k * 37 + i * 20) % 255},${(k * 91) % 255},${(k * 53) % 255},0.6)`; c.fillRect((k * 83 + i * 31) % 480, (k * 47) % 320, 30, 30); }
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Zoom');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(pictures.map((data, i) => ({ name: `c-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 6' })).toBeVisible({ timeout: 30000 });
}

test('zoom controls step in and out, jump to actual pixels, and go back to fit', async ({ page }) => {
  await project(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const zoom = page.getByRole('group', { name: 'Zoom' });
  const level = zoom.getByLabel('Zoom level');
  await expect(level).toBeVisible({ timeout: 30000 });
  const fitText = await level.innerText();
  await zoom.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => parseInt(await level.innerText())).toBeGreaterThan(parseInt(fitText));
  await zoom.getByRole('button', { name: '200%' }).click();
  await expect(level).toHaveText('200%');
  await zoom.getByRole('button', { name: '100%' }).click();
  // This small test picture is already shown above 100% when fitted, so 100% can only mean fit.
  await expect.poll(async () => parseInt(await level.innerText())).toBe(Math.max(100, parseInt(fitText)));
  await zoom.getByRole('button', { name: '200%' }).click();
  await page.keyboard.press('-');
  await expect.poll(async () => parseInt(await level.innerText())).toBeLessThan(200);
  await zoom.getByRole('button', { name: 'Fit' }).click();
  await expect(level).toHaveText(fitText);
});
