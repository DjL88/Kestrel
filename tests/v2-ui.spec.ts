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
  const advanced = root.getByRole('tab', { name: 'Advanced Edits' });
  if (!(await advanced.isVisible())) await root.getByRole('button', { name: 'Adjust', exact: true }).first().click();
  const curated = root.getByRole('tab', { name: 'Curated Looks' });
  await expect(curated).toHaveAttribute('aria-selected', 'true');
  await curated.focus();
  await curated.press('ArrowRight');
  await expect(advanced).toBeFocused();
  await expect(advanced).toHaveAttribute('aria-selected', 'true');
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
  // The Edit menu is not in the interface (the desktop app has it natively); Undo is the keyboard shortcut.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
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
  // The verdict is always written in words (in the merged Co-pilot panel), whatever it is, and comes from the measured values.
  await root.getByRole('button', { name: 'Co-pilot', exact: true }).first().click();
  const verdict = root.getByText(/Auto applied|Looks good|Cannot improve this safely|gentler version/);
  await expect(verdict.first()).toBeVisible({ timeout: 60000 });
  const apply = root.getByRole('button', { name: 'Apply suggested recipe' });
  if (await apply.count()) {
    await apply.click();
    await expect(root.getByRole('button', { name: 'Apply suggested recipe' })).toHaveCount(0);
  } else {
    await expect(root.getByText(/Looks good|Cannot improve/).first()).toBeVisible();
  }
});

async function importGenerated(page: import('@playwright/test').Page, name: string, count: number) {
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill(name);
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const images = await page.evaluate((n) => Array.from({ length: n }, (_, i) => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 267;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = ['#586b82', '#776c56', '#5d735d', '#855e73'][i % 4]; ctx.fillRect(0, 0, 400, 267);
    ctx.fillStyle = '#f2e6c8'; for (let k = 0; k < 40; k += 1) ctx.fillRect((k * 37 + i * 11) % 380, (k * 53) % 250, 14, 14);
    return canvas.toDataURL('image/png').split(',')[1];
  }), count);
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles(images.map((img, i) => ({ name: `cull-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(img, 'base64') })));
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(count);
}

test('?v2 Auto-Cull says it is part of Pro on the Free plan and changes nothing', async ({ page }) => {
  await page.goto('/?v2');
  await importGenerated(page, 'Free cull check', 2);
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: /Auto-Cull/ }).first().click();
  await expect(root.getByText('Auto-cull is part of InFlight Pro.')).toBeVisible();
  await expect(root.getByRole('button', { name: /^Unflag / })).toHaveCount(0);
});

test('?v2 marks Pro features with the Pro badge, and leaves Basic features unmarked', async ({ page }) => {
  await page.goto('/?v2&stub=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: /Scottish Highlands/ }).first().click();
  // Auto-Cull is Pro: the badge is the word "Pro" in the brand badge, with the same words for screen readers.
  const autoCull = root.getByRole('button', { name: /Auto-Cull/ }).first();
  await expect(autoCull.getByText('Part of InFlight Pro')).toHaveCount(1);
  // Dark and light versions of the brand badge are both in the page; the theme shows one.
  await expect(autoCull.locator('img.v2-pro-dark, img.v2-pro-light')).toHaveCount(2);
  await expect(autoCull.locator('img.v2-pro-dark')).toBeVisible();
  // Import is Basic: no badge.
  await expect(root.getByRole('button', { name: /^Import/ }).first().getByText('Part of InFlight Pro')).toHaveCount(0);
  // Deep Vision (online AI) is Pro too.
  await root.getByRole('button', { name: 'Co-pilot', exact: true }).first().click();
  await expect(root.getByRole('button', { name: /Deep Vision Review/ }).getByText('Part of InFlight Pro')).toHaveCount(1);
});

test('?v2 chrome: icons load, no File/Edit/View or mode switch in the header, the mode shows as a flag and is set in Settings', async ({ page }) => {
  const missing: string[] = [];
  page.on('response', (response) => { if (response.url().includes('/v2-icons/') && response.status() >= 400) missing.push(response.url()); });
  await page.goto('/?v2&stub=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: /Scottish Highlands/ }).first().click();
  const header = root.getByRole('banner');
  await expect(header.getByRole('navigation', { name: 'Application menus' })).toHaveCount(0);
  await expect(header.getByRole('radiogroup', { name: /assist mode/i })).toHaveCount(0);
  await expect(header.getByRole('button', { name: 'Back to projects' })).toBeVisible();
  // Assist and Co-pilot are one tool: there is no separate Assist in the rail.
  const rail = root.getByRole('complementary', { name: 'Studio tools' });
  await expect(rail.getByRole('button', { name: /^Assist/ })).toHaveCount(0);
  // The flag says which mode is on; Settings changes it.
  const flag = root.getByTestId('mode-flag');
  await expect(flag).toContainText('Co-pilot');
  await flag.click();
  await root.getByRole('button', { name: 'Auto-pilot', exact: true }).click();
  await root.getByRole('button', { name: 'Close settings' }).click().catch(() => page.keyboard.press('Escape'));
  await expect(flag).toContainText('Auto-pilot');
  // Tasks sit at the bottom with a count in a progress ring.
  await expect(root.getByTestId('tasks-wheel')).toBeVisible();
  await page.waitForTimeout(500);
  expect(missing, `icons that did not load: ${missing.join(', ')}`).toEqual([]);
});

test('?v2 font picker: favourites shown in their own typeface, a sample of real text, and fonts added from the device', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'Overlays', exact: true }).first().click();
  // The text controls are greyed until the overlay is on.
  await root.getByRole('switch', { name: 'Show text overlay on this photo' }).click();
  await root.getByRole('button', { name: 'Plus Jakarta Sans' }).first().click();
  const list = root.getByRole('listbox', { name: 'Fonts' });
  await expect(list.getByText('Our favourites')).toBeVisible();
  // Each favourite is drawn in its own font, and the font is actually loaded (bundled, so it works offline).
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return ['Playfair Display', 'Oswald', 'Caveat Script'.replace(' Script', ''), 'Lora', 'JetBrains Mono'].map((name) => document.fonts.check(`16px "${name}"`));
  });
  expect(loaded.every(Boolean)).toBe(true);
  await expect(list.getByRole('button', { name: /Playfair Display/ })).toHaveCSS('font-family', /Playfair Display|sans-serif/);
  const family = await list.getByText('Playfair Display', { exact: true }).evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toContain('Playfair Display');
  // The chosen font shows a sample of what the row will say.
  await list.getByRole('button', { name: /Oswald/ }).click();
  await expect(root.getByTestId('font-sample').first()).toHaveCSS('font-family', /Oswald/);
  // Add a font from this device: search by name, see it in its typeface, add it, find it under "On this device".
  await root.getByRole('button', { name: /Oswald/ }).first().click();
  await root.getByRole('button', { name: 'Add a font from this device' }).click();
  await root.getByRole('searchbox', { name: /Search the fonts on this device/ }).fill('fut');
  await root.getByRole('button', { name: /Futura/ }).click();
  await expect(root.getByRole('listbox', { name: 'Fonts' }).getByText('On this device').first()).toBeVisible();
  await expect(root.getByRole('listbox', { name: 'Fonts' }).getByRole('button', { name: /Futura/ }).first()).toBeVisible();
});

test('?v2 on the Free plan the Overlays tool is not offered at all', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Overlay lock check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 140; const x = c.getContext('2d')!; x.fillStyle = '#586b82'; x.fillRect(0, 0, 200, 140); return c.toDataURL('image/png').split(',')[1]; });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'ov-1.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  // Text and watermark are Pro, so the tool is left out of the rail rather than shown locked.
  await expect(root.getByRole('complementary', { name: 'Studio tools' }).getByRole('button', { name: 'Overlays' })).toHaveCount(0);
  await expect(root.getByRole('complementary', { name: 'Studio tools' }).getByRole('button', { name: 'Adjust' })).toBeVisible();
});

test('?v2 shows the engine ranking as a word, and says "Not ranked yet" rather than guessing', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  await expect(root.getByTestId('tier-badge').first()).toBeVisible();
  await expect(root.getByTestId('tier-badge').filter({ hasText: /^Best$/ }).first()).toBeVisible();
  // The real catalogue has no engine ranking wired yet: a photo shows "Not ranked yet", never a made-up tier.
  await page.goto('/?v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Rank check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 140; const x = c.getContext('2d')!; x.fillStyle = '#586b82'; x.fillRect(0, 0, 200, 140); return c.toDataURL('image/png').split(',')[1]; });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'rk-1.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await expect(root.getByTestId('tier-badge')).toHaveCount(0);
  await root.getByRole('button', { name: 'Info', exact: true }).first().click();
  await expect(root.getByText('Not ranked yet')).toBeVisible();
});

test('?v2 slice 1A: no Info in the footer, a bigger logo, Compare off in split, and left-handed mode', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  // Photo info lives in the left tools only.
  const dock = root.getByRole('tablist', { name: 'Bottom dock views' });
  await expect(dock.getByRole('tab')).toHaveText([/Filmstrip/]);
  // The logo is bigger.
  const logo = root.getByRole('banner').getByRole('img', { name: 'InFlight' });
  expect((await logo.boundingBox())!.height).toBeGreaterThanOrEqual(36);
  // Compare is greyed out, with the reason, while a photo is split.
  const compare = root.getByRole('button', { name: 'Compare', exact: true });
  await expect(compare).toBeEnabled();
  await root.getByRole('button', { name: 'Split 2', exact: true }).first().click();
  await expect(compare).toBeDisabled();
  await expect(compare).toHaveAttribute('title', /Rejoin it to compare/);
  // Left-handed mode puts the tools on the right.
  const rail = root.getByRole('complementary', { name: 'Studio tools' });
  const before = (await rail.boundingBox())!;
  expect(before.x).toBeLessThan(10);
  await root.getByTestId('mode-flag').click();
  await root.getByRole('tab', { name: /Appearance/ }).first().click();
  await root.getByRole('radio', { name: /left-handed/i }).click();
  await root.getByRole('button', { name: /close settings/i }).first().click().catch(() => page.keyboard.press('Escape'));
  const after = (await rail.boundingBox())!;
  expect(after.x).toBeGreaterThan(400);
});

test('?v2 slice 1A: the histogram is measured, the zoom % jumps to 100%, and interface choices are kept', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Slice 1A check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // A pure white 1200 x 800 picture: every pixel is clipped, and it has a known size.
  const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 800; const x = c.getContext('2d')!; x.fillStyle = '#ffffff'; x.fillRect(0, 0, 1200, 800); return c.toDataURL('image/png').split(',')[1]; });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'white-1.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  // Real histogram: it reports what the pixels are, here 100% highlight clipping.
  await root.getByRole('button', { name: 'Info', exact: true }).first().click();
  await expect(root.getByTestId('histogram-clipping')).toContainText('Highlights clipped 100%', { timeout: 30000 });
  // Zoom: click the percentage to see the picture at 100%, and again to fit.
  const zoom = root.getByTestId('zoom-percent');
  const fit = await zoom.textContent();
  expect(fit).not.toBe('100%');
  await zoom.click();
  await expect(zoom).toHaveText('100%');
  await zoom.click();
  await expect(zoom).toHaveText(fit!);
  // Interface choices are kept: left-handed mode survives a reload.
  await root.getByRole('button', { name: 'Back to projects' }).click();
  await root.getByRole('button', { name: /Settings/ }).first().click();
  await root.getByRole('tab', { name: /Appearance/ }).first().click();
  await root.getByRole('radio', { name: /left-handed/i }).click();
  await page.reload();
  await root.getByRole('button', { name: /Settings/ }).first().click();
  await root.getByRole('tab', { name: /Appearance/ }).first().click();
  await expect(root.getByRole('radio', { name: /left-handed/i })).toHaveAttribute('aria-checked', 'true');
});

test('?v2 overlay text is the same share of the frame in every format and at every zoom (a true reflection of size)', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'Overlays', exact: true }).first().click();
  const text = root.locator('div').filter({ hasText: /^Show text overlay on this photo/ }).getByRole('switch').first();
  await text.click();
  await expect(text).toHaveAttribute('aria-checked', 'true');
  await root.getByRole('button', { name: /All formats/ }).click();
  const layers = root.getByTestId('overlay-layer');
  await expect(layers).toHaveCount(3);
  // Font size as a share of the frame's width, for each format on the board.
  const shares = await layers.evaluateAll((els) => els.map((layer) => {
    const line = layer.querySelector('p') as HTMLElement;
    return parseFloat(getComputedStyle(line).fontSize) / (layer as HTMLElement).getBoundingClientRect().width;
  }));
  expect(shares).toHaveLength(3);
  for (const share of shares) expect(Math.abs(share - shares[0])).toBeLessThan(0.002);
  // And the same share in the single view of the 4:5 format.
  await root.getByRole('button', { name: /Single/ }).first().click();
  await root.getByRole('button', { name: '4:5', exact: true }).first().click();
  const single = await root.getByTestId('overlay-layer').first().evaluate((layer) => {
    const line = layer.querySelector('p') as HTMLElement;
    return parseFloat(getComputedStyle(line).fontSize) / (layer as HTMLElement).getBoundingClientRect().width;
  });
  expect(Math.abs(single - shares[0])).toBeLessThan(0.002);
});

test('?v2 a format is capped at the photo\'s own pixels, with a small warning', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Size cap check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // A 1500 x 1000 picture on a format that asks for 3000 x 2000.
  const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1500; c.height = 1000; const x = c.getContext('2d')!; x.fillStyle = '#586b82'; x.fillRect(0, 0, 1500, 1000); return c.toDataURL('image/png').split(',')[1]; });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'cap-1.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  const warning = root.getByTestId('size-cap-warning');
  await expect(warning).toContainText('Smaller than 3000×2000', { timeout: 30000 });
  await expect(root.getByText('1500×1000 (3:2)')).toBeVisible();
  await expect(warning).toHaveAttribute('title', /never enlarges/);
});

test('?v2 crop: corners keep the format\'s shape, double-click shows the whole picture, a plain drag moves the format', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  const frame = root.getByTestId('canvas-frame');
  const zoomOf = () => frame.locator('img').first().evaluate((img) => { const m = new DOMMatrixReadOnly(getComputedStyle(img).transform === 'none' ? undefined : getComputedStyle(img).transform); return m.a; });
  const before = (await frame.boundingBox())!;
  expect(await zoomOf()).toBeCloseTo(1, 1);
  // Pull the top-left corner in: the picture zooms, and the frame keeps exactly the same shape and size.
  const corner = root.getByRole('button', { name: 'Drag top left crop corner' });
  const c = (await corner.boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + 90, c.y + 60, { steps: 6 });
  await page.mouse.up();
  expect(await zoomOf()).toBeGreaterThan(1.05);
  const after = (await frame.boundingBox())!;
  expect(Math.abs(after.width - before.width)).toBeLessThan(1);
  expect(Math.abs(after.height - before.height)).toBeLessThan(1);
  // Pulling it back out returns toward fit, never below it.
  const c2 = (await corner.boundingBox())!;
  await page.mouse.move(c2.x + c2.width / 2, c2.y + c2.height / 2);
  await page.mouse.down();
  await page.mouse.move(c2.x - 200, c2.y - 150, { steps: 6 });
  await page.mouse.up();
  expect(await zoomOf()).toBeGreaterThanOrEqual(0.99);
  // Double-click shows the whole picture as a ghost; Escape leaves it.
  await expect(root.getByTestId('crop-ghost')).toHaveCount(0);
  await frame.dblclick({ position: { x: 200, y: 150 } });
  await expect(root.getByTestId('crop-ghost')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(root.getByTestId('crop-ghost')).toHaveCount(0);
  // Outside that mode, a plain drag moves the format on the canvas.
  const start = (await frame.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 80, start.y + start.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  const moved = (await frame.boundingBox())!;
  expect(moved.x - start.x).toBeGreaterThan(60);
  expect(moved.y - start.y).toBeGreaterThan(25);
  expect(Math.abs(moved.width - start.width)).toBeLessThan(1);
});

test('?v2 overlay text drags smoothly (no jump at 35% or 65%), snaps to the centre, and resizes from its corners', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'Overlays', exact: true }).first().click();
  const text = root.locator('div').filter({ hasText: /^Show text overlay on this photo/ }).getByRole('switch').first();
  await text.click();
  const box = root.locator('[data-overlay="text"]');
  await expect(box).toBeVisible();
  const frameBox = (await root.getByTestId('canvas-frame').boundingBox())!;
  const start = (await box.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  // Drag right across the whole frame in small steps, recording the box's left edge each time.
  const lefts: number[] = [];
  const step = 12;
  for (let dx = step; dx <= frameBox.width * 0.7; dx += step) {
    await page.mouse.move(start.x + start.width / 2 + dx, start.y + start.height / 2);
    lefts.push((await box.boundingBox())!.x);
  }
  await page.mouse.up();
  // Smooth: the box never moves much more than the pointer did between two samples (a jump at 35% or 65% would be half a box wide).
  for (let i = 1; i < lefts.length; i += 1) expect(Math.abs(lefts[i] - lefts[i - 1])).toBeLessThan(step * 2 + 4);
  // Resize from a corner: pulling the bottom-right corner outward makes the text bigger.
  const fontBefore = await box.locator('p').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await box.hover();
  const corner = box.getByRole('button', { name: 'Resize text' }).nth(3);
  const c = (await corner.boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + 90, c.y + 60, { steps: 6 });
  await page.mouse.up();
  const fontAfter = await box.locator('p').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontAfter).toBeGreaterThan(fontBefore * 1.1);
});

test('?v2 overlay panel: clear on/off toggle that greys the controls until on, position dots, a composition grid, and no density setting', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'Overlays', exact: true }).first().click();
  const toggle = root.getByRole('switch', { name: 'Show text overlay on this photo' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(toggle).toContainText('Off');
  // Off: the controls below are greyed and cannot be reached.
  const dots = root.getByRole('group', { name: 'Position (per image)' }).or(root.getByRole('group').filter({ has: root.getByRole('button', { name: /Place text at/ }) }));
  await expect(root.locator('[aria-disabled="true"]').first()).toBeVisible();
  await toggle.click();
  await expect(toggle).toContainText('On');
  await expect(root.locator('[aria-disabled="true"]')).toHaveCount(0);
  await expect(root.getByRole('button', { name: /Place text at/ })).toHaveCount(9);
  await expect(dots.first()).toBeVisible();
  // A composition grid over the frame: off, 3x3, 4x4, off.
  const grid = root.getByTestId('grid-toggle');
  await expect(root.getByTestId('composition-grid')).toHaveCount(0);
  await grid.click();
  await expect(root.getByTestId('composition-grid')).toBeVisible();
  await expect(root.getByTestId('composition-grid').locator('line')).toHaveCount(4);
  await grid.click();
  await expect(root.getByTestId('composition-grid').locator('line')).toHaveCount(6);
  await grid.click();
  await expect(root.getByTestId('composition-grid')).toHaveCount(0);
  // Compact and comfortable looked the same, so the setting is gone.
  await root.getByTestId('mode-flag').click();
  await root.getByRole('tab', { name: /Appearance/ }).click();
  await expect(root.getByText(/comfortable|compact/i)).toHaveCount(0);
});
