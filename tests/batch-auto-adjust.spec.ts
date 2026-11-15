import { expect, test } from '@playwright/test';

test('library can auto-adjust an unedited keeper locally and retain editable sliders', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'written for the desktop layout; the phone flow (More menu, folded Auto sheet) still needs its own version of this test');
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Auto adjustment acceptance');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#272727'; context.fillRect(0, 0, 320, 240);
    context.fillStyle = '#353535'; context.fillRect(60, 60, 100, 90);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((result) => resolve(result!), 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'low-light.png', { type: 'image/png' }));
    const input = document.querySelector<HTMLInputElement>('[data-testid="local-file-input"]')!;
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const collections = page.getByRole('navigation', { name: 'Photo collections' });
  await expect(collections.getByRole('button', { name: 'To review 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep low-light.png' }).click();
  await collections.getByRole('button', { name: 'Keepers 1' }).click();
  await page.getByRole('button', { name: 'Workspace options' }).click();
  await page.getByRole('button', { name: 'Auto-adjust unedited keepers…' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Auto-adjust unedited keepers?' })).toBeVisible();
  await page.getByRole('button', { name: 'Auto-adjust keepers', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Auto-adjusted 1 keepers' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  const exposure = Number(await page.getByRole('slider', { name: 'Light adjustment' }).inputValue());
  expect(exposure).toBeGreaterThan(0);
});
