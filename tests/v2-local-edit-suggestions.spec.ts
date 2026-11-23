import { expect, test } from '@playwright/test';

test('Co-pilot renders a local edit preview and only changes the photo after Apply', async ({ page }, testInfo) => {
  // The safety-checked global recipe is available even without the optional subject detector.
  await page.route('**/*.onnx*', (route) => route.abort());
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Local edit preview');
  await studio.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  await studio.getByRole('button', { name: 'Import', exact: true }).waitFor();
  const pixels = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(160, 120);
    for (let y = 0; y < 120; y++) for (let x = 0; x < 160; x++) {
      const i = (y * 160 + x) * 4;
      const texture = 0.5 + 0.35 * Math.sin(x * 0.9) * Math.cos(y * 0.7);
      const v = Math.round(255 * Math.pow(texture * 0.07, 1 / 2.2));
      image.data.set([v, Math.round(v * 0.98), Math.round(v * 0.96), 255], i);
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await studio.evaluate((target, base64) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'underexposed.png', { type: 'image/png' }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, pixels);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  const openPanel = studio.getByRole('button', { name: testInfo.project.name === 'phone' ? 'Flight' : 'Co-pilot', exact: true });
  if (!await studio.getByRole('button', { name: 'Check photo on this device' }).isVisible()) await openPanel.first().click();
  await studio.getByRole('button', { name: 'Check photo on this device' }).click();
  const before = studio.getByText('Current edit', { exact: true }).first().locator('..').locator('img');
  const after = studio.getByRole('img', { name: 'Natural', exact: true });
  await expect(after).toHaveAttribute('src', /^data:image\/jpeg/);
  expect(await after.getAttribute('src')).not.toBe(await before.getAttribute('src'));
  const phone = testInfo.project.name === 'phone';
  const undo = studio.getByRole('button', { name: 'Undo', exact: true });
  if (phone) await expect(undo).toBeDisabled();
  await studio.getByRole('button', { name: 'Apply', exact: true }).first().click();
  await expect(studio.getByRole('button', { name: 'Applied', exact: true })).toBeDisabled();
  if (phone) {
    await studio.getByRole('button', { name: 'Close mobile drawer' }).click();
    await undo.click();
    await expect(undo).toBeDisabled();
    await expect(studio.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
  } else {
    await page.keyboard.press('Control+z');
    await expect(studio.getByRole('button', { name: 'Apply', exact: true }).first()).toBeEnabled();
  }
});
