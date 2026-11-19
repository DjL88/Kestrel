import { expect, test } from '@playwright/test';

/** Colour is never the only cue (PRODUCT-SPEC §1): decisions and selection show words and shapes on every tile. */
test('kept, rejected and selected photos are marked with words and shapes, not just border colour', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Marks');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  const pictures = await page.evaluate(() => [0, 1, 2].map((index) => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const paint = canvas.getContext('2d')!; paint.fillStyle = `rgb(${50 + index * 60},90,120)`; paint.fillRect(0, 0, 320, 240);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(pictures.map((data, index) => ({
    name: `mark-${index + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64'),
  })));
  const collections = page.getByRole('navigation', { name: 'Photo collections' });
  await expect(collections.getByRole('button', { name: 'To review 3' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Keep mark-1.png', exact: true }).click();
  await page.getByRole('button', { name: 'Move mark-2.png to Trash', exact: true }).click();
  await collections.getByRole('button', { name: /^All photos/ }).click();

  const tile = (name: string) => page.getByRole('article', { name: `Frame ${name}` });
  await expect(tile('mark-1.png').getByTestId('tile-decision')).toHaveText('Kept');
  await expect(tile('mark-2.png').getByTestId('tile-decision')).toHaveText('Rejected');
  await expect(tile('mark-3.png').getByTestId('tile-decision')).toHaveCount(0);
  // Each mark carries an icon as well as its word.
  await expect(tile('mark-1.png').getByTestId('tile-decision').locator('svg')).toHaveCount(1);
  await expect(tile('mark-2.png').getByTestId('tile-decision').locator('svg')).toHaveCount(1);

  // Selecting several photos shows a tick box on each chosen one.
  await page.getByRole('button', { name: page.viewportSize()!.width < 768 ? 'More' : 'Workspace options', exact: true }).click();
  await page.getByRole('button', { name: 'Select photos' }).click();
  await page.getByRole('button', { name: 'Select mark-3.png', exact: true }).click();
  await expect(tile('mark-3.png').getByTestId('tile-selected')).toBeVisible();
  await expect(tile('mark-1.png').getByTestId('tile-selected')).toHaveCount(0);
});

test('the chosen flag in Photo info has a tick and bold words', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1024, 'Photo info is docked on wide screens; on phones it opens on demand');
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Flags');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const paint = canvas.getContext('2d')!; paint.fillStyle = '#567'; paint.fillRect(0, 0, 320, 240);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({ name: 'flag.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 1' })).toBeVisible({ timeout: 30_000 });
  // Show every photo, so the photo stays in view once it is kept.
  await page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: /^All photos/ }).click();
  const flags = page.getByRole('group', { name: 'Photo flag' });
  await expect(flags.getByRole('button', { name: 'Unflagged' })).toContainText('✓');
  await flags.getByRole('button', { name: 'keep' }).click();
  await expect(flags.getByRole('button', { name: 'keep' })).toContainText('✓');
  await expect(flags.getByRole('button', { name: 'Unflagged' })).not.toContainText('✓');
});
