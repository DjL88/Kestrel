import { expect, test } from '@playwright/test';

test('import ten photos, keep and edit a frame, export it and reopen offline', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.getByText('Create a project to import photos, or restore a Kestrel backup.')).toBeVisible();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Ten-photo test');
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

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare 1 file', exact: true }).click();
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
  await page.getByRole('button', { name: 'Close export' }).click();

  await page.getByRole('button', { name: 'Back to Library', exact: true }).click();
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
});
