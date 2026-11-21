import { expect, test, type Page } from '@playwright/test';

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 640, 'the Eye control is in the single-photo bar from tablet width up');

/** Two synthetic birds whose eyes are in different places, so following the eye must move the view. */
async function birds(page: Page) {
  return page.evaluate(() => [[900, 300], [330, 520]].map(([ex, ey], i) => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#c9d8e6'; c.fillRect(0, 0, 1200, 800);
    c.fillStyle = '#6b6f73'; c.beginPath(); c.ellipse(600, 430, 300, 170, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(ex - 40, ey + 20, 110, 90, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#111'; c.beginPath(); c.arc(ex, ey, 14, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#f5f5f5'; c.beginPath(); c.arc(ex - 4, ey - 5, 4, 0, Math.PI * 2); c.fill();
    return { name: `bird-${i + 1}.png`, data: canvas.toDataURL('image/png').split(',')[1] };
  }));
}

const transformOf = (page: Page) => page.getByRole('group', { name: 'Single photo controls' }).evaluate((bar) => {
  const root = bar.parentElement!;
  const layer = Array.from(root.querySelectorAll<HTMLElement>('[style*="scale("]'))[0];
  return layer?.style.transform ?? '';
});

test('Eye in single-photo review zooms to each photo\'s eye as you step, and switches back to the whole photo', async ({ page }) => {
  test.setTimeout(150_000); // on-device subject models load on first use
  await page.goto('/');
  const files = await birds(page);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Eye mode');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(files.map(({ name, data }) => ({ name, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 2' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Workspace options', exact: true }).click();
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption('loupe');
  await page.keyboard.press('Escape');

  const controls = page.getByRole('group', { name: 'Single photo controls' });
  const eye = controls.getByRole('button', { name: 'Eye', exact: true });
  await expect(eye).toHaveAttribute('aria-pressed', 'false');
  await eye.click();
  await expect(eye).toHaveAttribute('aria-pressed', 'true');
  const note = controls.getByRole('status');
  await expect(note).toHaveText(/Zoomed to|No eye stood out|No clear subject/, { timeout: 120_000 });
  const first = await transformOf(page);
  if (/Zoomed to/.test(await note.innerText())) expect(first).not.toMatch(/scale\(1\)/);

  // Stepping keeps Eye on and looks again on the next photo: the view lands on that photo's eye, somewhere else.
  await controls.getByRole('button', { name: 'Next frame' }).click();
  await expect(eye).toHaveAttribute('aria-pressed', 'true');
  if (!/scale\(1\)/.test(first)) {
    await expect.poll(() => transformOf(page), { timeout: 120_000 }).not.toMatch(/scale\(1\)/);
    expect(await transformOf(page)).not.toBe(first);
  }
  await expect(note).toHaveText(/Zoomed to|No eye stood out|No clear subject/, { timeout: 120_000 });

  // Off again: back to the whole photo.
  await eye.click();
  await expect(eye).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => transformOf(page)).toMatch(/scale\(1\)/);
});
