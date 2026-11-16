import { expect, test } from '@playwright/test';

const photo = { name: 'hand.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') };

test('left- or right-handed is chosen in the header menu, remembered, and mirrors the thumb controls on a phone', async ({ page }, info) => {
  const phone = (info.project.name === 'phone');
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles(photo);
  await page.getByRole('button', { name: 'Back', exact: true }).click({ timeout: 15000 });
  const open = async () => {
    await page.getByRole('button', { name: 'More', exact: true }).or(page.getByRole('button', { name: 'Workspace options' })).click();
    return page.locator('#workspace-options');
  };
  await expect(page.locator('html')).toHaveAttribute('data-hand', 'right');
  let menu = await open();
  await expect(menu.getByRole('button', { name: 'Right-handed' })).toHaveAttribute('aria-pressed', 'true');
  await menu.getByRole('button', { name: 'Left-handed' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-hand', 'left');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-hand', 'left');
  // A reload returns to the home page: open the project again, and the choice is still the same.
  await page.getByRole('button', { name: /Quick edits/ }).first().click();
  menu = await open();
  await expect(menu.getByRole('button', { name: 'Left-handed' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');

  if (phone) {
    // In the editor the undo and redo buttons move to the right, away from the hand that is not holding the phone.
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('tab', { name: 'Edit', exact: true }).click();
    const quick = page.getByRole('region', { name: 'Quick adjust' });
    await expect(quick).toBeVisible({ timeout: 15000 });
    const back = (await quick.getByRole('button', { name: 'Step back' }).boundingBox())!;
    const all = (await quick.getByRole('button', { name: 'All controls' }).boundingBox())!;
    expect(back.x, 'with the left hand, the step buttons are on the right').toBeGreaterThan(all.x);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
  }
  menu = await open();
  await menu.getByRole('button', { name: 'Right-handed' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-hand', 'right');
});
