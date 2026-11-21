import { expect, test } from '@playwright/test';

test('select multiple photos in Library, edit just that queue and export together', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'desktop grid/filmstrip flow; phone selection needs a dedicated test');
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Select and edit');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  const images = await page.evaluate(() => Array.from({ length: 4 }, (_, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = 180; canvas.height = 130;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = ['#586b82', '#776c56', '#5d735d', '#855e73'][i];
    ctx.fillRect(0, 0, 180, 130);
    ctx.fillStyle = 'white'; ctx.fillRect(15 + i * 10, 18, 45, 55);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByTestId('local-file-input').setInputFiles(images.map((img, i) => ({
    name: `frame-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(img, 'base64'),
  })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 4' })).toBeVisible();
  // Select in the existing library grid, without acting on unselected photographs.
  await page.getByRole('button', { name: 'Workspace options' }).click();
  await page.getByRole('button', { name: 'Select photos', exact: true }).click();
  await page.getByRole('button', { name: 'Select frame-1.png' }).click();
  await page.getByRole('button', { name: 'Select frame-3.png' }).click();
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit selected' }).click();
  const film = page.locator('[aria-label="Shoot filmstrip"]');
  await expect(film.getByRole('button', { name: 'Select frame-1.png' })).toBeVisible();
  await expect(film.getByRole('button', { name: 'Select frame-3.png' })).toBeVisible();
  await expect(film.getByRole('button', { name: 'Select frame-2.png' })).toHaveCount(0);
  const batch = page.getByRole('toolbar', { name: 'Photo navigation and editing actions' });
  // Primary Export handles selected photos; the filmstrip has no duplicate Export action.
  await expect(batch.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0);
  await expect(batch.getByRole('button', { name: 'Edit together' })).toBeVisible();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await batch.getByRole('button', { name: 'Edit together' }).click();
  await expect(batch.getByRole('button', { name: /Editing together/ })).toHaveAttribute('aria-pressed', 'true');
  const light = page.getByRole('slider', { name: 'Exposure adjustment' });
  await light.press('ArrowRight');
  await expect(light).toHaveValue('0.1');
  // Navigation flushes a pending linked adjustment, even when it happens immediately.
  // The arrow buttons are available after unpinning the persistent filmstrip.
  await page.getByRole('button', { name: 'Collapse filmstrip' }).click();
  await page.getByRole('button', { name: 'Next photo' }).click();
  await expect(light).toHaveValue('0.1');
  // The primary Export button follows the selection, even with the filmstrip hidden.
  const primaryExport = page.getByRole('button', { name: 'Export 2', exact: true });
  await expect(primaryExport).toBeVisible();
  await primaryExport.click();
  await expect(page.getByRole('heading', { name: 'Export 2 photos' })).toBeVisible();
  await page.getByRole('button', { name: 'Close export' }).click();
  await expect(page.getByRole('heading', { name: 'frame-3.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'frame-3.png' })).toHaveCount(0);
});

test('filmstrip selection can bulk export and paste slider edits, keeping original files untouched', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'desktop grid/filmstrip flow; phone selection needs a dedicated test');
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Filmstrip batch actions');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  const images = await page.evaluate(() => Array.from({ length: 3 }, (_, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = 200; canvas.height = 140;
    const c = canvas.getContext('2d')!;
    c.fillStyle = ['#6b8238', '#3a7188', '#7b4c6e'][i]; c.fillRect(0, 0, 200, 140);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByTestId('local-file-input').setInputFiles(images.map((img, i) =>
    ({ name: `batch-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(img, 'base64') })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 3' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  const light = page.getByRole('slider', { name: 'Exposure adjustment' });
  await light.press('ArrowRight');
  await expect(light).toHaveValue('0.1');
  const bar = page.getByRole('toolbar', { name: 'Photo navigation and editing actions' });
  await bar.getByRole('button', { name: 'Copy edits', exact: true }).click();
  await bar.getByRole('button', { name: 'Select photos' }).click();
  const film = page.locator('[aria-label="Shoot filmstrip"]');
  // Select photos starts with the active photo marked; clear it for this two-photo test.
  await film.getByRole('button', { name: 'Select batch-1.png' }).click();
  await film.getByRole('button', { name: 'Select batch-2.png' }).click();
  await film.getByRole('button', { name: 'Select batch-3.png' }).click();
  await expect(bar.getByRole('status')).toHaveText('2 selected');
  await bar.getByRole('button', { name: 'Paste to selected' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Paste adjustments to 2 photos?' })).toBeVisible();
  await page.getByRole('button', { name: 'Apply adjustments' }).click();
  // The last marked photo is active. Clicking it again would remove it from the export selection.
  await expect(page.getByRole('heading', { name: 'batch-3.png', exact: true })).toBeVisible();
  await expect(light).toHaveValue('0.1');
  await expect(bar.getByRole('status')).toHaveText('2 selected');
  // The primary Editor Export must send both selected frames, not just the active photo.
  await page.getByRole('button', { name: 'Export 2', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Export 2 photos' })).toBeVisible();
  await page.getByRole('button', { name: 'Close export' }).click();
  await bar.getByRole('button', { name: 'Done selecting' }).click();
  await film.getByRole('button', { name: 'Jump to frame batch-2.png' }).click();
  await expect(light).toHaveValue('0.1');
});
