import { expect, test, type Page } from '@playwright/test';

// These need Pro. The Free-plan behaviour is covered in v2-ui.spec.ts. Run against the Vite dev server with Pro switched on for
// developers: V2_DEV_PRO=1 with a config whose server sets VITE_KESTREL_DEV_PRO=1 (a local, untracked config).
test.skip(!process.env.V2_DEV_PRO, 'needs the Vite dev server with VITE_KESTREL_DEV_PRO=1');
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name === 'phone', 'the V2 phone layout is a later slice'); });

async function openProject(page: Page, name: string, colour: string) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill(name);
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const image = await page.evaluate((fill) => { const c = document.createElement('canvas'); c.width = 320; c.height = 213; const x = c.getContext('2d')!; x.fillStyle = fill; x.fillRect(0, 0, 320, 213); return c.toDataURL('image/png').split(',')[1]; }, colour);
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'pro-1.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  return root;
}

test('Pro: a watermark image with a white background is added, cleaned, given a light version, and chosen automatically on a dark photo', async ({ page }) => {
  const root = await openProject(page, 'Watermark check', '#10141a');
  await root.getByRole('button', { name: 'Overlays', exact: true }).first().click();
  await root.getByRole('button', { name: 'Watermark', exact: true }).click();
  // A logo saved as a JPEG: black mark on a white background.
  const jpeg = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 80; const x = c.getContext('2d')!;
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 160, 80); x.fillStyle = '#111111'; x.fillRect(30, 20, 100, 40);
    const blob: Blob = await new Promise((resolve) => c.toBlob((b) => resolve(b!), 'image/jpeg', 0.95));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: 'Add a watermark image' }).click();
  await (await chooser).setFiles([{ name: 'my-logo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg) }]);
  const library = root.getByTestId('watermark-library');
  await expect(library.getByText('my-logo', { exact: true })).toBeVisible();
  // A dark mark belongs on light photos; the version for dark photos is missing until it is made.
  await expect(library.getByRole('button', { name: 'Make a light version' })).toBeVisible();
  // Remove the white background: the preview shows transparency at the corner.
  await library.getByRole('button', { name: 'Remove background (light photos)' }).click();
  const preview = library.getByTestId('cutout-preview');
  await expect(preview).toBeVisible();
  const cornerAlpha = () => preview.evaluate(async (img) => {
    const element = img as HTMLImageElement;
    await element.decode();
    const c = document.createElement('canvas'); c.width = element.naturalWidth; c.height = element.naturalHeight;
    const x = c.getContext('2d')!; x.drawImage(element, 0, 0);
    return [x.getImageData(1, 1, 1, 1).data[3], x.getImageData(c.width / 2, c.height / 2, 1, 1).data[3]];
  });
  await expect.poll(cornerAlpha).toEqual([0, 255]);
  await library.getByTestId('cutout-apply').click();
  await expect(library.getByTestId('cutout-editor')).toHaveCount(0);
  // Make the light version (white) for dark photos.
  await library.getByRole('button', { name: 'Make a light version' }).click();
  await expect(library.getByRole('button', { name: 'Make a light version' })).toHaveCount(0);
  // Use it on the dark photo with Auto: the light version is the one drawn on the canvas.
  await library.getByText('my-logo', { exact: true }).click();
  await root.getByRole('button', { name: 'Auto', exact: true }).click();
  const onCanvas = root.getByTestId('canvas-frame').getByRole('img', { name: 'my-logo' });
  await expect(onCanvas).toBeVisible();
  const darkSwatch = library.locator('img').nth(0);
  await expect.poll(async () => (await onCanvas.getAttribute('src')) === (await darkSwatch.getAttribute('src'))).toBe(true);
  // It is kept on this device: after a reload it is still in the library.
  await page.reload();
  await root.getByRole('button', { name: /Open studio/ }).first().click();
  await root.getByRole('button', { name: 'Overlays', exact: true }).first().click();
  await root.getByRole('button', { name: 'Watermark', exact: true }).click();
  await expect(root.getByTestId('watermark-library').getByText('my-logo', { exact: true })).toBeVisible();
});

test('Pro: text overlay settings are saved with the photo', async ({ page }) => {
  const root = await openProject(page, 'Text overlay check', '#586b82');
  await root.getByRole('button', { name: 'Overlays', exact: true }).first().click();
  const textSwitch = () => root.locator('div').filter({ hasText: /^Show text overlay on this photo/ }).getByRole('switch').first();
  await textSwitch().click();
  await expect(textSwitch()).toHaveAttribute('aria-checked', 'true');
  // Going back to the projects saves the project; then a full reload shows what was kept.
  await root.getByRole('button', { name: 'Back to projects' }).click();
  await expect(root.getByText(/1 photo/)).toBeVisible();
  await page.reload();
  await root.getByRole('button', { name: /Open studio/ }).first().click();
  await root.getByRole('button', { name: 'Overlays', exact: true }).first().click();
  await expect(textSwitch()).toHaveAttribute('aria-checked', 'true');
});

test('Pro: Auto-Cull scores the photos on this device and never rejects', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Pro cull check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const images = await page.evaluate(() => Array.from({ length: 4 }, (_, i) => { const c = document.createElement('canvas'); c.width = 400; c.height = 267; const x = c.getContext('2d')!; x.fillStyle = ['#586b82', '#776c56', '#5d735d', '#855e73'][i]; x.fillRect(0, 0, 400, 267); x.fillStyle = '#f2e6c8'; for (let k = 0; k < 40; k += 1) x.fillRect((k * 37 + i * 11) % 380, (k * 53) % 250, 14, 14); return c.toDataURL('image/png').split(',')[1]; }));
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles(images.map((img, i) => ({ name: `cull-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(img, 'base64') })));
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(4);
  await root.getByRole('button', { name: /Auto-Cull/ }).first().click();
  await expect(root.getByText(/Auto-cull looked at 4 photos/)).toBeVisible({ timeout: 90000 });
  await expect(root.getByText(/were rejected|has been rejected/)).toHaveCount(0);
});

test('Pro: the text overlay is drawn into the exported file, and left out when the export asks for no overlay', async ({ page }) => {
  const root = await openProject(page, 'Overlay export check', '#586b82');
  await root.getByRole('button', { name: 'Overlays', exact: true }).first().click();
  await root.locator('div').filter({ hasText: /^Show text overlay on this photo/ }).getByRole('switch').first().click();
  const exportOnce = async (withOverlay: boolean) => {
    await root.getByRole('button', { name: /^Export/ }).first().click();
    const dialog = page.getByRole('dialog', { name: /export/i });
    const sizes = dialog.locator('.grid.grid-cols-2 button[aria-pressed="true"]');
    const names = await sizes.allTextContents();
    for (const name of names.slice(1)) await dialog.locator('.grid.grid-cols-2 button[aria-pressed="true"]', { hasText: name }).first().click();
    if (!withOverlay) await dialog.getByRole('button', { name: 'With text overlay' }).first().click();
    const downloading = page.waitForEvent('download', { timeout: 60000 });
    await dialog.getByRole('button', { name: /export bundle/i }).click();
    const download = await downloading;
    const { readFileSync } = await import('node:fs');
    const base64 = readFileSync(await download.path()).toString('base64');
    await dialog.getByRole('button', { name: 'Close export dialog' }).click();
    // Count pixels that are clearly not the plain photo colour.
    return page.evaluate(async (data) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${data}`)).blob());
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0);
      const px = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let different = 0;
      for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - 0x58) + Math.abs(px[i + 1] - 0x6b) + Math.abs(px[i + 2] - 0x82) > 60) different += 1;
      return different;
    }, base64);
  };
  expect(await exportOnce(true)).toBeGreaterThan(200);
  expect(await exportOnce(false)).toBeLessThan(20);
});

test('Pro: an overlay is saved as a template on this device, kept after a reload, applied to the selected photos, and deleted', async ({ page }) => {
  const root = await openProject(page, 'Template check', '#406080');
  await root.getByRole('button', { name: 'Overlays', exact: true }).first().click();
  await expect(root.getByText('No templates yet.')).toBeVisible();
  await root.getByLabel('Template name').fill('Wildlife credit');
  await root.getByRole('button', { name: 'Save current overlay as a template' }).click();
  const list = root.getByRole('list', { name: 'Templates' });
  await expect(list.getByText('Wildlife credit')).toBeVisible();

  // Kept on this device: still there after a reload and a reopen of the project.
  await page.reload();
  await page.locator('.inflight-v2').getByRole('button', { name: /Template check/ }).first().click();
  await page.locator('.inflight-v2').getByRole('button', { name: 'Overlays', exact: true }).first().click();
  await expect(page.locator('.inflight-v2').getByRole('list', { name: 'Templates' }).getByText('Wildlife credit')).toBeVisible();

  await page.locator('.inflight-v2').getByRole('button', { name: /Apply to this photo: Wildlife credit/ }).click();
  await expect(page.locator('.inflight-v2').getByText(/Applied "Wildlife credit" to 1 photo/)).toBeVisible();

  await page.locator('.inflight-v2').getByRole('button', { name: 'Delete Wildlife credit' }).click();
  await expect(page.locator('.inflight-v2').getByText('No templates yet.')).toBeVisible();
});
