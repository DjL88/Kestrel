import { expect, test } from '@playwright/test';

test('macro pad mode and knob controls have accessible names and touch targets', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Macro pad test');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: page.viewportSize()!.width < 768 ? 'More' : 'Workspace options', exact: true }).click();
  await page.getByText('Macro pad', { exact: true }).click();

  const dialog = page.getByRole('dialog', { name: /Keymap/ });
  const editMode = dialog.getByRole('tab', { name: 'Edit mode' });
  const knob = dialog.getByRole('button', { name: /Remap .*knob anticlockwise/ });
  for (const control of [editMode, knob, dialog.getByRole('button', { name: 'Done' })]) {
    await expect(control).toBeVisible();
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }

  await editMode.click();
  await expect(editMode).toHaveAttribute('aria-selected', 'true');
  await knob.press('Enter');
  await expect(knob).toHaveAttribute('aria-pressed', 'true');
  await knob.press('Escape');
  await expect(knob).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
});
