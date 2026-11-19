import { expect, test } from '@playwright/test';

const photo = { name: 'side.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') };

test('Photo info sits on the Preferred-hand side, where the editing tools are', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'on a phone Photo info is a sheet over the photos, not a side panel');
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles(photo);
  await page.getByRole('button', { name: 'Back', exact: true }).click({ timeout: 15000 });
  const info = page.getByRole('complementary', { name: 'Photo info' });
  await expect(info).toBeVisible();
  const centre = async () => { const box = (await info.boundingBox())!; return box.x + box.width / 2; };
  const width = page.viewportSize()!.width;
  expect(await centre(), 'right-handed: on the right').toBeGreaterThan(width / 2);

  await page.getByRole('button', { name: 'Workspace options' }).click();
  await page.locator('#workspace-options').getByRole('button', { name: 'Left-handed' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(centre).toBeLessThan(width / 2);
  // The editing tools are on the same side.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const tools = page.getByRole('tablist', { name: 'Editing tools' });
  await expect(tools).toBeVisible();
  const box = (await tools.boundingBox())!;
  expect(box.x + box.width / 2).toBeLessThan(width / 2);
});
