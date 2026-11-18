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
  await page.getByRole('textbox', { name: 'Project name' }).fill('Cull');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(pictures.map((data, i) => ({ name: `c-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 6' })).toBeVisible({ timeout: 30000 });
}

test('after Auto Cull, one button jumps to the keepers, instead of a long list of photos to open', async ({ page }) => {
  await project(page);
  await page.getByRole('button', { name: 'More', exact: true }).or(page.getByRole('button', { name: 'Workspace options' })).click();
  await page.locator('#workspace-options').getByRole('button', { name: /Auto-cull/ }).click();
  const dialog = page.getByRole('dialog', { name: /Auto-cull/ });
  await dialog.getByRole('button', { name: /^Scan|Scan/ }).first().click();
  await expect(dialog.getByRole('region', { name: 'Auto-cull summary' })).toBeVisible({ timeout: 60000 });
  // When the summary appears, the way forward has keyboard focus (choosing a tier below then moves focus, as any click does).
  const jump = dialog.getByRole('button', { name: /^Show my keepers/ });
  await expect(jump).toBeFocused();
  const more = dialog.getByRole('region', { name: 'Find more keeper candidates' });
  await expect(more).toBeVisible();
  await more.getByRole('button', { name: 'Good · broader' }).click();
  await expect(more.getByRole('button', { name: 'Good · broader' })).toHaveAttribute('aria-pressed', 'true');
  // Merely choosing a broader tier shows recommendations; it never applies decisions.
  await expect(more.getByRole('status')).toContainText(/additional|No additional/i);
  // The reasons exist, but are folded away, so the first thing seen is the way forward, not a list of every photo.
  await expect(dialog.getByRole('button', { name: /Review photo/ })).toHaveCount(0);
  await jump.click();
  await expect(dialog).toBeHidden();
  // The library is showing the keepers.
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: /^Keepers/ })).toBeVisible();
});
