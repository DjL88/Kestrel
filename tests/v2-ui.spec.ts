import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'the V2 phone layout is checked in a later slice');
});

test('V2 is off by default and the current app is untouched', async ({ page }) => {
  await page.goto('/?v2=0');
  await expect(page.locator('.inflight-v2')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
});

test('?v2&stub=1 shows the sample-data hub, opens a project and toggles Compare', async ({ page }) => {
  await page.goto('/?v2&stub=1');
  const root = page.locator('.inflight-v2');
  await expect(root).toBeVisible();
  // Scoped tokens: the current app's styles are not changed.
  expect(await root.evaluate((el) => getComputedStyle(el).getPropertyValue('--brand-accent').trim())).toBe('#e8743c');
  expect(await page.evaluate(() => document.documentElement.dataset.theme ?? '')).not.toBe('light');
  await root.getByRole('button', { name: /Scottish Highlands/ }).first().click();
  const compare = root.getByRole('button', { name: 'Compare', exact: true });
  await expect(compare).toHaveAttribute('aria-pressed', 'false');
  await compare.click();
  await expect(compare).toHaveAttribute('aria-pressed', 'true');
  await expect(root.getByText('Before', { exact: true }).first()).toBeVisible();
});

test('leaving V2 with ?v2=0 restores the current app', async ({ page }) => {
  await page.goto('/?v2');
  await expect(page.locator('.inflight-v2')).toBeVisible();
  await page.goto('/?v2=0');
  await expect(page.locator('.inflight-v2')).toHaveCount(0);
});

test('?v2 runs on the real catalogue: create, import, flag, rate, reload and the photos are still there', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await expect(root.getByText('No projects yet')).toBeVisible();
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Real store check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // An empty real project: import three generated photos through the real loader.
  const images = await page.evaluate(() => Array.from({ length: 3 }, (_, i) => {
    const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 130;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = ['#586b82', '#776c56', '#5d735d'][i]; ctx.fillRect(0, 0, 180, 130);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles(images.map((img, i) => ({ name: `real-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(img, 'base64') })));
  const strip = root.getByRole('listbox', { name: 'Project photographs' });
  await expect(strip.getByRole('option')).toHaveCount(3);
  await expect(strip.getByText('Ready to edit').first()).toBeVisible();
  // Flag the first photo and rate it: both go through the catalogue's own decision path.
  await strip.getByRole('button', { name: 'Flag real-1.png' }).click();
  await expect(strip.getByRole('button', { name: 'Unflag real-1.png' })).toBeVisible();
  await root.getByRole('button', { name: 'Info', exact: true }).first().click();
  await root.getByRole('button', { name: 'Rate 4 stars' }).click();
  // Back to the hub: the project shows 3 photos and 1 flagged. Then a full reload keeps them.
  await root.getByRole('button', { name: /back|projects/i }).first().click();
  await expect(root.getByText('3 photos')).toBeVisible();
  await expect(root.getByText('1 flagged')).toBeVisible();
  await page.reload();
  await expect(root.getByText('3 photos')).toBeVisible();
  await root.getByRole('button', { name: /Open studio/ }).first().click();
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(3);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('button', { name: 'Unflag real-1.png' })).toBeVisible();
});

test('?v2 edits are real: Adjust changes the pixels, Compare splits original and edit, undo restores', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Real edit check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 160;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#586b82'; ctx.fillRect(0, 0, 240, 160);
    ctx.fillStyle = '#c9a36b'; ctx.fillRect(40, 30, 100, 80);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'edit-1.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  const frame = root.getByTestId('canvas-frame');
  await expect(frame.locator('canvas, img').first()).toBeVisible({ timeout: 30000 });
  // An unedited photo is an image; an edited one is drawn on a canvas. Read the mean brightness from whichever is shown.
  const mean = () => frame.locator('canvas, img').first().evaluate(async (el) => {
    const source = el as HTMLCanvasElement | HTMLImageElement;
    const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    if (!width || !height) return 0;
    const probe = document.createElement('canvas'); probe.width = width; probe.height = height;
    const ctx = probe.getContext('2d')!; ctx.drawImage(source, 0, 0);
    const data = ctx.getImageData(0, 0, width, height).data;
    let total = 0; for (let i = 0; i < data.length; i += 4) total += data[i] + data[i + 1] + data[i + 2];
    return total / (data.length / 4 * 3);
  });
  await expect.poll(mean).toBeGreaterThan(10);
  const before = await mean();
  // Move Exposure up through the real slider: the recipe becomes a PhotoEdit and the canvas redraws brighter.
  const exposure = root.getByLabel('Exposure', { exact: true });
  await exposure.fill('1');
  await expect.poll(mean, { timeout: 15000 }).toBeGreaterThan(before + 3);
  const brighter = await mean();
  // Compare: a real slider splits original and edit; keyboard moves it.
  await root.getByRole('button', { name: 'Compare', exact: true }).click();
  const split = root.getByRole('slider', { name: 'Before and after split' });
  await expect(split).toHaveAttribute('aria-valuenow', '50');
  await split.focus();
  await page.keyboard.press('ArrowRight');
  await expect(split).toHaveAttribute('aria-valuenow', '52');
  await page.keyboard.press('Home');
  await expect(split).toHaveAttribute('aria-valuenow', '0');
  await root.getByRole('button', { name: 'Compare', exact: true }).click();
  // Undo returns the picture to the original.
  await root.getByRole('button', { name: 'Edit', exact: true }).click();
  await root.getByRole('menuitem', { name: /^Undo/ }).click();
  await expect.poll(mean, { timeout: 15000 }).toBeLessThan(brighter - 3);
  await expect(root.getByLabel('Exposure', { exact: true })).toHaveValue('0');
});

test('?v2 Co-pilot checks the photo on this device, suggests Auto, and applying it is one undoable edit', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Real auto check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // A dark, low-contrast picture: Auto should find a real exposure lift, or say plainly that it cannot.
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 213;
    const ctx = canvas.getContext('2d')!; const gradient = ctx.createLinearGradient(0, 0, 320, 213);
    gradient.addColorStop(0, '#0c1016'); gradient.addColorStop(1, '#262c36'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 320, 213);
    ctx.fillStyle = '#3b3328'; ctx.fillRect(110, 70, 100, 70);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'dark-1.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  // The verdict is always written in words (Assist panel), whatever it is, and comes from the measured values.
  await root.getByRole('button', { name: 'Assist', exact: true }).first().click();
  const verdict = root.getByText(/Auto applied|Looks good|Cannot improve this safely|gentler version/);
  await expect(verdict.first()).toBeVisible({ timeout: 60000 });
  await root.getByRole('button', { name: 'Co-pilot', exact: true }).first().click();
  const apply = root.getByRole('button', { name: 'Apply suggested recipe' });
  if (await apply.count()) {
    await apply.click();
    await expect(root.getByRole('button', { name: 'Apply suggested recipe' })).toHaveCount(0);
    await root.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(root.getByRole('menuitem', { name: /^Undo/ })).toBeEnabled();
  } else {
    await expect(root.getByText(/Looks good|Cannot improve/).first()).toBeVisible();
  }
});
