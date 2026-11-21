import { expect, test } from '@playwright/test';

const photo = { name: 'side.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') };

test('Photo info sits opposite the Preferred hand, and the editing tools on the hand side', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'on a phone Photo info is a sheet over the photos, not a side panel');
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles(photo);
  await page.getByRole('button', { name: 'Back', exact: true }).click({ timeout: 15000 });
  const info = page.getByRole('complementary', { name: 'Photo info' });
  await expect(info).toBeVisible();
  const centre = async () => { const box = (await info.boundingBox())!; return box.x + box.width / 2; };
  const width = page.viewportSize()!.width;
  expect(await centre(), 'right-handed: info on the left').toBeLessThan(width / 2);

  // The rail stays visible while Photo info is open and can fold/reopen it.
  // This is a real UI affordance rather than a hidden only-when-folded tab.
  const infoRail = page.getByRole('group', { name: 'Photo info', exact: true });
  await expect(infoRail.getByRole('button', { name: 'Fold photo info' })).toBeVisible();
  await infoRail.getByRole('button', { name: 'Fold photo info' }).click();
  await expect(info).toBeHidden();
  const foldedRail = page.getByRole('group', { name: 'Folded info pane' });
  await expect(foldedRail.getByRole('button', { name: 'Expand photo info' })).toBeVisible();
  await foldedRail.getByRole('button', { name: 'Expand photo info' }).click();
  await expect(info).toBeVisible();

  await page.getByRole('button', { name: 'Workspace options' }).click();
  await page.locator('#workspace-options').getByRole('button', { name: 'Left-handed' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(centre).toBeGreaterThan(width / 2);
  // The editing tools are on the hand side, opposite Photo info.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const tools = page.getByRole('tablist', { name: 'Editing tools' });
  await expect(tools).toBeVisible();
  const box = (await tools.boundingBox())!;
  expect(box.x + box.width / 2).toBeLessThan(width / 2);
});
