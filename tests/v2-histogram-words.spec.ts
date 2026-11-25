import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  // On a phone, Info sits behind the More menu; the histogram's wording is the same there.
  test.skip(testInfo.project.name === 'phone', 'Info is reached from the desktop rail in this check');
});

// Colour-vision audit, gap 3: the histogram's channels must be told apart without relying on colour, and clipping is
// said in words per channel.
test('?v2 histogram: every line has its own pattern and name, and a clipped channel is named in words', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Histogram words');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // Pure red: the red channel is clipped at white, green and blue at black.
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 80;
    const x = c.getContext('2d')!;
    x.fillStyle = '#ff0000';
    x.fillRect(0, 0, 120, 80);
    return c.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'red.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await root.getByRole('button', { name: 'Info', exact: true }).first().click();

  const channels = root.getByTestId('histogram-channel-clipping');
  await expect(channels).toContainText('Red clipped: shadows 0%, highlights 100%', { timeout: 30000 });
  await expect(channels).toContainText('Green clipped: shadows 100%, highlights 0%');
  await expect(channels).toContainText('Blue clipped: shadows 100%, highlights 0%');
  await expect(root.getByTestId('histogram-legend')).toHaveText(/Red.*Green.*Blue.*Brightness/);

  // No two colour channels share a line pattern, and none relies on colour alone.
  const dashes = await root.locator('svg polyline[data-channel]').evaluateAll((lines) =>
    lines.map((line) => `${line.getAttribute('data-channel')}:${line.getAttribute('stroke-dasharray') ?? 'solid'}`));
  expect(dashes).toHaveLength(4);
  expect(new Set(dashes.map((entry) => entry.split(':')[1])).size).toBe(4);
});
