import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  // On a phone, Info sits behind the More menu; the words are the same there.
  test.skip(testInfo.project.name === 'phone', 'Info is reached from the desktop rail in this check');
});

// "Edit in another app" needs the desktop app (it opens another app and watches its saves). In a browser tab the
// control is shown, switched off, with the reason in words, and nothing is sent anywhere.
test('?v2 Edit in another app is shown as unavailable in a browser, in plain words', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Other editor');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 120; c.height = 80;
    const x = c.getContext('2d')!; x.fillStyle = '#5a7a3a'; x.fillRect(0, 0, 120, 80);
    return c.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'green.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await root.getByRole('button', { name: 'Info', exact: true }).first().click();

  const block = root.getByTestId('external-edit-unavailable');
  const button = block.getByRole('button', { name: 'Edit in another app' });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAccessibleDescription(/needs the InFlight desktop app/);
  await expect(block).toContainText('Nothing has been sent.');
  await expect(root.getByTestId('external-edit')).toHaveCount(0);
});
