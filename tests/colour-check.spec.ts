import { expect, test, type Page } from '@playwright/test';

async function openInEditor(page: Page, paint: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Colour');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  const picture = await page.evaluate((recipe) => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300;
    const c = canvas.getContext('2d')!;
    for (const [fill, x, y, w, h] of JSON.parse(recipe) as [string, number, number, number, number][]) { c.fillStyle = fill; c.fillRect(x, y, w, h); }
    return canvas.toDataURL('image/png').split(',')[1];
  }, paint);
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({ name: 'colour.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 1' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  // Phones open on Quick adjust; the colour check is with all the controls, one tap away.
  const all = page.getByRole('button', { name: 'All controls' });
  if (await all.isVisible()) await all.click();
  return page.getByTestId('colour-check');
}

test('the colour check names the colours and says what is wrong, in words, with a fix', async ({ page }) => {
  // Very strong red over half the photo, on a warm grey: a red that is too strong, and a warm cast.
  const panel = await openInEditor(page, JSON.stringify([['rgb(150,130,100)', 0, 0, 400, 300], ['rgb(255,0,30)', 0, 0, 400, 150]]));
  await expect(panel.getByTestId('colour-palette')).toContainText('red, very strong');
  await expect(panel.getByTestId('colour-palette')).toContainText('brown');
  const strong = panel.locator('[data-finding="strongColour"]');
  await expect(strong).toContainText('Watch out:');
  await expect(strong).toContainText('Very strong red');
  await expect(panel.locator('[data-finding="cast"]')).toContainText('warm cast');
  // Each finding has an icon and a word, not just a colour.
  await expect(strong.locator('svg')).toHaveCount(1);

  await strong.getByRole('button', { name: 'Soften colour' }).click();
  // The fix goes into the normal, undoable edit, and the check runs again on the softened picture.
  await expect(panel.getByRole('status')).toContainText('Edit history');
  await expect(page.getByRole('button', { name: /^Undo/ }).first()).toBeEnabled();
});

test('a calm, natural photo gets its colours named and no warnings', async ({ page }) => {
  const panel = await openInEditor(page, JSON.stringify([['rgb(110,150,200)', 0, 0, 400, 150], ['rgb(80,120,70)', 0, 150, 400, 150]]));
  await expect(panel.getByTestId('colour-palette')).toContainText('blue');
  await expect(panel.getByTestId('colour-palette')).toContainText('green');
  await expect(panel.locator('[data-finding="strongColour"], [data-finding="clippedColour"], [data-finding="cast"]')).toHaveCount(0);
  await expect(panel.getByTestId('colour-findings')).toContainText('Nothing looks wrong');
});
