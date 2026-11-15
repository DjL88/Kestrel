import { expect, test } from '@playwright/test';

test('import ten photos, keep and edit a frame, export it and reopen offline', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.getByText('Create a project to import photos, or restore a Kestrel backup.')).toBeVisible();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Ten-photo test');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  // Turn the helpers off so the test controls every decision itself.
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();

  // Use actual PNG files and the normal file chooser. The test images stay outside the production bundle.
  const pictures = await page.evaluate(() => Array.from({ length: 10 }, (_, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const paint = canvas.getContext('2d')!;
    const sky = paint.createLinearGradient(0, 0, 640, 480);
    sky.addColorStop(0, '#223f5a');
    sky.addColorStop(1, '#89aec9');
    paint.fillStyle = sky;
    paint.fillRect(0, 0, 640, 480);
    paint.fillStyle = '#e2a64d';
    paint.fillRect(60 + index * 20, 140, 208, 174);
    paint.fillStyle = 'white';
    paint.font = 'bold 40px sans-serif';
    paint.fillText(String(index + 1), 80 + index * 20, 218);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(pictures.map((data, index) => ({
    name: `frame-${String(index + 1).padStart(2, '0')}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  })));

  const collections = page.getByRole('navigation', { name: 'Photo collections' });
  await expect(collections.getByRole('button', { name: 'To review 10' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep frame-01.png', exact: true }).click();
  await expect(collections.getByRole('button', { name: 'To review 9' })).toBeVisible();
  await collections.getByRole('button', { name: 'Keepers 1' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const light = page.getByRole('slider', { name: 'Light adjustment' });
  await expect(light).toBeEnabled();
  await light.press('ArrowRight');
  await expect(light).toHaveValue('0.1');

  // Hold the local model fetch until another adjustment has been committed.
  await page.evaluate(() => {
    const fetchModel = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (typeof input === 'string' && /u2netp.*\.onnx/.test(input)) {
        await new Promise<void>((resolve) => window.addEventListener('test-resume-model', () => resolve(), { once: true }));
      }
      return fetchModel(input, init);
    };
  });
  await page.getByText('Masks', { exact: true }).click();
  await page.getByRole('button', { name: 'Find subject', exact: true }).click();
  await light.press('ArrowRight');
  await expect(light).toHaveValue('0.2');
  await page.evaluate(() => window.dispatchEvent(new Event('test-resume-model')));
  await expect(page.getByText('Photo edits changed. Find the subject or background again.')).toBeVisible({ timeout: 15000 });
  await expect(light).toHaveValue('0.2');
  await light.press('ArrowLeft');
  await expect(light).toHaveValue('0.1');

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const exportHeading = page.getByRole('heading', { name: 'Export photo' });
  const prepare = page.getByRole('button', { name: 'Prepare 1 file', exact: true });
  await expect(exportHeading).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(prepare).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close export' })).toBeFocused();
  await prepare.click();
  await expect(page.getByRole('status').filter({ hasText: '1 file ready' })).toBeVisible();
  await expect(exportHeading).toBeFocused();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('frame-01-kestrel.png');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const png = Buffer.concat(chunks);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([640, 480]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeFocused();

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await expect(page.getByRole('button', { name: 'Ten-photo test 10 photos' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Ten-photo test 10 photos' }).click();
  await collections.getByRole('button', { name: 'Keepers 1' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Light adjustment' })).toHaveValue('0.1');
  await expect(page.getByRole('img', { name: 'Edited photo' })).toBeVisible();
  await page.getByText('Crop & straighten', { exact: true }).click();
  await page.getByLabel('Aspect ratio').selectOption('1');
  await page.getByText('Crop & straighten', { exact: true }).click();
  await page.getByText('Export focus', { exact: true }).click();
  await page.getByRole('button', { name: 'Mark focus point' }).click();
  await page.getByRole('button', { name: 'Place export focus point' }).press('Enter');
  await expect(page.getByRole('button', { name: 'Move focus point' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  const saved = page.getByRole('img', { name: 'frame-01.png' });
  await expect.poll(() => saved.evaluate((node: HTMLImageElement) => node.naturalWidth > 0 && node.naturalWidth === node.naturalHeight)).toBeTruthy();
});
