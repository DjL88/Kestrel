import { openV2Settings } from './helpers';
import { expect, test } from '@playwright/test';

test('Colour-vision support is off by default and, when turned on, names the colours in words', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Settings opens from the desktop tool rail.');
  await page.route('**/*.onnx*', (route) => route.abort());
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Colour words');
  await studio.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  await studio.getByRole('button', { name: 'Import', exact: true }).waitFor();
  // A synthetic photo: a strong red half and a green half of about the same lightness.
  const pixels = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'rgb(190, 60, 50)';
    context.fillRect(0, 0, 80, 120);
    context.fillStyle = 'rgb(90, 140, 50)';
    context.fillRect(80, 0, 80, 120);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await studio.evaluate((target, base64) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'red-green.png', { type: 'image/png' }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, pixels);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  const openPanel = studio.getByRole('button', { name: testInfo.project.name === 'phone' ? 'Flight' : 'Co-pilot', exact: true });
  if (!await studio.getByRole('button', { name: 'Check photo on this device' }).isVisible()) await openPanel.first().click();
  await studio.getByRole('button', { name: 'Check photo on this device' }).click();
  await expect(studio.getByText('Colour notes come from measuring the photo itself', { exact: false }).first()).toBeVisible();

  // Off by default: no colour list, and never an internal code such as "strongColour".
  await expect(studio.getByTestId('colour-words')).toHaveCount(0);
  await expect(studio.getByText(/strongColour|clippedColour/)).toHaveCount(0);

  await openV2Settings(page);
  await page.getByRole('tab', { name: 'Assistance' }).or(page.getByRole('button', { name: 'Assistance' })).first().click();
  const toggle = page.getByRole('switch', { name: 'Colour-vision support' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Close settings' }).click();

  if (!await studio.getByRole('button', { name: 'Check photo on this device' }).isVisible()) await openPanel.first().click();
  const words = studio.getByTestId('colour-words').first();
  await expect(words).toBeVisible();
  await expect(words).toContainText('Main colours');
  await expect(words).toContainText(/red/);
  await expect(words).toContainText(/green/);
});
