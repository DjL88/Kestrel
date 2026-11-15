import { expect, test } from '@playwright/test';

import type { Page } from '@playwright/test';

/** Every visible button that shows only an icon must have a tooltip. Hidden-from-sight text does not count as a label. */
async function expectIconButtonsHaveTooltips(page: Page, where: string) {
  const untitled = await page.evaluate(() => [...document.querySelectorAll('button')].flatMap((button) => {
    const box = button.getBoundingClientRect();
    if (!box.width || !box.height) return [];
    const copy = button.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.sr-only, [aria-hidden="true"]:not(svg)').forEach((node) => node.remove());
    const visibleText = (copy.textContent ?? '').trim();
    return visibleText || button.getAttribute('title') ? [] : [button.getAttribute('aria-label') ?? button.id ?? button.className.slice(0, 40)];
  }));
  expect(untitled, `icon-only buttons without a tooltip on ${where}`).toEqual([]);
}

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
  await expectIconButtonsHaveTooltips(page, 'the library');
  await page.getByRole('button', { name: 'Workspace options' }).click();
  await expectIconButtonsHaveTooltips(page, 'the workspace menu');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Keep frame-01.png', exact: true }).click();
  await expect(collections.getByRole('button', { name: 'To review 9' })).toBeVisible();
  await collections.getByRole('button', { name: 'Keepers 1' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  const light = page.getByRole('slider', { name: 'Light adjustment' });
  await expect(light).toBeEnabled();
  await expectIconButtonsHaveTooltips(page, 'the editor');
  // The macro pad is reachable from the editor, opens on Edit mode, explains itself, and its test box names the key pressed.
  await page.getByRole('button', { name: 'Macro pad and shortcuts' }).click();
  await expect(page.getByText('How to use a macro pad')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Edit mode' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('q');
  await expect(page.getByText('Cycle Adjustment (Edit mode)')).toBeVisible();
  await expect(light).toHaveValue('0');
  await page.keyboard.press('Escape');
  // On wide screens the panel runs down beside the filmstrip. Hiding the filmstrip must not push the panel's bottom off screen.
  if ((page.viewportSize()?.width ?? 0) >= 768) {
    const panelFitsWindow = () => page.evaluate(() => document.querySelector('[role=tablist]')!.parentElement!.getBoundingClientRect().bottom <= window.innerHeight + 1);
    expect(await panelFitsWindow()).toBe(true);
    await page.getByText('Edit options', { exact: true }).click();
    await page.getByText('Layout', { exact: true }).click();
    await page.getByRole('checkbox', { name: 'Pin filmstrip' }).uncheck();
    await expect.poll(panelFitsWindow).toBe(true);
    await page.getByRole('checkbox', { name: 'Pin filmstrip' }).check();
    await expect.poll(panelFitsWindow).toBe(true);
  }
  // The built-in opinion answers for an unedited photo, and stays on the page.
  await page.getByRole('tab', { name: 'Auto' }).click();
  await page.getByRole('button', { name: 'Get an opinion' }).click();
  await expect(page.getByRole('region', { name: 'Opinion on this edit' })).toBeVisible();
  await page.getByRole('button', { name: 'Hide opinion' }).click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
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
  await page.getByRole('tab', { name: 'Masks' }).click();
  // The tab bar must never cover the first line of a tab, however far the previous tab was scrolled.
  // On a phone the bar is at the bottom and the tools sit above it, otherwise the bar is at the top of the panel.
  await expect.poll(() => page.evaluate(() => {
    const bar = document.querySelector('[role=tablist]')!.getBoundingClientRect();
    const first = document.querySelector('#panel-masks')!.firstElementChild!.getBoundingClientRect();
    return window.innerWidth < 768 ? first.bottom <= bar.top + 0.5 : first.top >= bar.bottom - 0.5;
  })).toBe(true);
  await page.getByRole('button', { name: 'Find subject', exact: true }).click();
  // The sliders live on the Edit tab, so change the edit there while detection is still waiting for the model.
  await page.getByRole('tab', { name: 'Edit' }).click();
  await light.press('ArrowRight');
  await expect(light).toHaveValue('0.2');
  await page.evaluate(() => window.dispatchEvent(new Event('test-resume-model')));
  await page.getByRole('tab', { name: 'Masks' }).click();
  await expect(page.getByText('Photo edits changed. Find the subject or background again.')).toBeVisible({ timeout: 15000 });
  await page.getByRole('tab', { name: 'Edit' }).click();
  await expect(light).toHaveValue('0.2');
  await light.press('ArrowLeft');
  await expect(light).toHaveValue('0.1');

  // Delete removes the selected mask, and a brush only paints once Paint is switched on.
  await page.getByRole('tab', { name: 'Masks' }).click();
  await page.getByRole('button', { name: /^Brush$/ }).click();
  await expect(page.getByRole('tab', { name: /Masks\s*1/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Paint', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Paint', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Paint', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Paint', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Paint', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Delete');
  await expect(page.getByRole('tab', { name: /Masks\s*1/ })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Edit' }).click();

  await page.getByRole('tab', { name: 'Export' }).click();
  await page.getByRole('button', { name: 'Choose formats and export…' }).click();
  const exportHeading = page.getByRole('heading', { name: 'Export photo' });
  const prepare = page.getByRole('button', { name: 'Prepare 1 file', exact: true });
  await expect(exportHeading).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close export' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(prepare).toBeFocused();
  // Formats are grouped by platform, and a preview has the shape its format promises (a story is 9:16).
  // Platforms are accordions: Instagram opens on demand and says how many formats are chosen.
  const instagram = page.locator('details', { has: page.getByText('Instagram', { exact: true }) });
  await expect(instagram).not.toHaveAttribute('open', '');
  await instagram.getByText('Instagram', { exact: true }).click();
  await instagram.getByRole('checkbox', { name: /Story or Reel cover/ }).check();
  await expect.poll(() => page.getByRole('img', { name: /as Story or Reel cover/ }).evaluate((canvas: HTMLCanvasElement) => Number((canvas.width / canvas.height).toFixed(2)))).toBe(0.56);
  await expect(page.getByRole('button', { name: 'Prepare 2 files', exact: true })).toBeVisible();
  await expect(instagram.getByText('1 chosen')).toBeVisible();
  // The ratio can be turned on its side: the photo stays upright, the shape changes.
  await instagram.getByRole('checkbox', { name: /Post · 4:5/ }).check();
  await expect.poll(() => page.getByRole('img', { name: /as Post · 4:5/ }).evaluate((canvas: HTMLCanvasElement) => Number((canvas.width / canvas.height).toFixed(2)))).toBe(0.8);
  // Zoom in and the crop moves in every direction, not just one. The turn button sits on the preview itself.
  const crop = page.getByRole('group', { name: /Crop position for .* as Post · 4:5/ });
  const look = () => page.getByRole('img', { name: /as Post · 4:5/ }).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await crop.focus();
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  await expect.poll(look).not.toBe('');
  await page.waitForTimeout(400);
  const zoomed = await look();
  const box = (await crop.boundingBox())!;
  for (const [dx, dy] of [[-0.3, 0], [0, -0.3]]) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + box.width * dx, box.y + box.height / 2 + box.height * dy, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const after = await look();
    expect(after, `dragging ${dx ? 'sideways' : 'up'} should change the crop`).not.toBe(zoomed);
    await crop.dblclick();
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await page.waitForTimeout(400);
  }
  await page.getByRole('button', { name: /Turn Post · 4:5 on its side/ }).click();
  await expect.poll(() => page.getByRole('img', { name: /as Post · 5:4/ }).evaluate((canvas: HTMLCanvasElement) => Number((canvas.width / canvas.height).toFixed(2)))).toBe(1.25);
  await instagram.getByRole('checkbox', { name: /Post · 5:4/ }).uncheck();
  await instagram.getByRole('checkbox', { name: /Story or Reel cover/ }).uncheck();
  await expect(prepare).toBeVisible();
  // A custom size that is not a whole number is explained and cannot be prepared.
  await page.getByLabel('Custom size').check();
  await page.getByLabel('Width (px)').fill('0');
  await expect(page.getByRole('alert')).toContainText('whole numbers');
  await expect(page.getByRole('button', { name: /^Prepare/ })).toBeDisabled();
  await page.getByLabel('Custom size').uncheck();
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
  await expect(page.getByRole('button', { name: 'Choose formats and export…' })).toBeFocused();

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await expect(page.getByRole('button', { name: 'Ten-photo test 10 photos' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Ten-photo test 10 photos' }).click();
  await collections.getByRole('button', { name: 'Keepers 1' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Light adjustment' })).toHaveValue('0.1');
  await expect(page.getByRole('img', { name: 'Edited photo' })).toBeVisible();
  await page.getByRole('tab', { name: 'Crop' }).click();
  await page.getByLabel('Aspect ratio').selectOption('1');
  await page.getByRole('button', { name: 'Apply crop' }).click();
  // The crop must still be in place after applying it: a square photo, not the original 4:3.
  await expect.poll(() => page.getByRole('img', { name: 'Edited photo' }).evaluate((canvas: HTMLCanvasElement) => canvas.width === canvas.height)).toBe(true);
  await page.getByText('Export focus', { exact: true }).click();
  await page.getByRole('button', { name: 'Mark focus point' }).click();
  await page.getByRole('button', { name: 'Place export focus point' }).press('Enter');
  await expect(page.getByRole('button', { name: 'Move focus point' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  const saved = page.getByRole('img', { name: 'frame-01.png' });
  await expect.poll(() => saved.evaluate((node: HTMLImageElement) => node.naturalWidth > 0 && node.naturalWidth === node.naturalHeight)).toBeTruthy();
});

test('quick edit opens a photo straight in the editor and it can be moved to a project later', async ({ page }) => {
  await page.goto('/');
  // A project to move into later.
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Destination');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Back to projects' }).click();

  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const paint = canvas.getContext('2d')!;
    paint.fillStyle = '#4a7a9a';
    paint.fillRect(0, 0, 320, 240);
    paint.fillStyle = '#e2a64d';
    paint.fillRect(80, 60, 120, 100);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'quick.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  // No project was made first, and the photo is already open in the editor.
  await expect(page.getByRole('toolbar', { name: 'Editor actions' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Edited photo' })).toBeVisible();

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await expect(page.getByText('Quick edits').first()).toBeVisible();
  await page.getByRole('button', { name: /Quick edits/ }).first().click();
  await page.getByRole('button', { name: 'View quick.png' }).click();
  await page.getByRole('button', { name: 'Workspace options' }).click();
  await page.getByRole('button', { name: 'Move to project…' }).click();
  await page.getByLabel('Destination project').selectOption({ label: 'Destination (0)' });
  await page.getByRole('button', { name: 'Move photos' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Moved 1 photo to Destination' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await page.getByRole('button', { name: /Destination/ }).first().click();
  await expect(page.getByRole('button', { name: 'View quick.png' })).toBeVisible();
});
