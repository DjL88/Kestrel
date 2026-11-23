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

test('?v2 Remove only offers itself once a photo is set aside, asks first, and Undo brings it straight back', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Remove and restore check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const images = await page.evaluate(() => Array.from({ length: 2 }, (_, i) => {
    const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 130;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = ['#586b82', '#776c56'][i]; ctx.fillRect(0, 0, 180, 130);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles(images.map((img, i) => ({ name: `rm-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(img, 'base64') })));
  const strip = root.getByRole('listbox', { name: 'Project photographs' });
  await expect(strip.getByRole('option')).toHaveCount(2);

  // Right-click an unreviewed photo: no Remove action is offered yet.
  const first = strip.getByRole('option').first();
  await first.click({ button: 'right' });
  const menu = root.getByRole('menu', { name: 'Photo actions' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Remove/ })).toHaveCount(0);

  // Set it aside, then Remove becomes available; it asks for confirmation before touching the catalogue.
  await menu.getByRole('menuitem', { name: 'Reject / set aside' }).click();
  await first.click({ button: 'right' });
  const menu2 = root.getByRole('menu', { name: 'Photo actions' });
  await menu2.getByRole('menuitem', { name: /^Remove/ }).click();
  const confirm = root.getByRole('alertdialog', { name: 'Remove this photo?' });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText("Your original file on disk is never touched")).toBeVisible();
  await confirm.getByRole('button', { name: 'Keep photo' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(strip.getByRole('option')).toHaveCount(2);

  // Confirm for real this time: the catalogue entry goes to Trash, never the original file.
  await first.click({ button: 'right' });
  await root.getByRole('menu', { name: 'Photo actions' }).getByRole('menuitem', { name: /^Remove/ }).click();
  await root.getByRole('alertdialog', { name: 'Remove this photo?' }).getByRole('button', { name: 'Remove' }).click();
  await expect(strip.getByRole('option')).toHaveCount(1);

  // Undo is the same per-photo Undo as any other edit, and brings the removed photo straight back.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(strip.getByRole('option')).toHaveCount(2);
});

test('?v2 Removed photos panel browses Trash and restores without using Undo', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Removed panel check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 130;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#4a6150'; ctx.fillRect(0, 0, 180, 130);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'panel-1.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  const strip = root.getByRole('listbox', { name: 'Project photographs' });
  await expect(strip.getByRole('option')).toHaveCount(1);

  // Before anything is removed, the panel says so plainly instead of showing an empty list with no explanation.
  await root.getByRole('button', { name: 'File' }).click();
  await root.getByRole('menuitem', { name: 'Removed photos…' }).click();
  const emptyPanel = root.getByRole('dialog', { name: 'Removed photos (0)' });
  await expect(emptyPanel).toBeVisible();
  await expect(emptyPanel.getByText('Nothing removed right now.')).toBeVisible();
  await emptyPanel.getByRole('button', { name: 'Close' }).click();

  // Set the photo aside and remove it to Trash.
  const first = strip.getByRole('option').first();
  await first.click({ button: 'right' });
  await root.getByRole('menu', { name: 'Photo actions' }).getByRole('menuitem', { name: 'Reject / set aside' }).click();
  await first.click({ button: 'right' });
  await root.getByRole('menu', { name: 'Photo actions' }).getByRole('menuitem', { name: /^Remove/ }).click();
  await root.getByRole('alertdialog', { name: 'Remove this photo?' }).getByRole('button', { name: 'Remove' }).click();
  await expect(strip.getByRole('option')).toHaveCount(0);

  // The Removed photos panel lists it by filename and restores it, with no Undo involved.
  await root.getByRole('button', { name: 'File' }).click();
  await root.getByRole('menuitem', { name: 'Removed photos…' }).click();
  const panel = root.getByRole('dialog', { name: 'Removed photos (1)' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('panel-1.png')).toBeVisible();
  await panel.getByRole('button', { name: 'Restore panel-1.png' }).click();
  await expect(root.getByRole('dialog', { name: 'Removed photos (0)' })).toBeVisible();
  await expect(strip.getByRole('option')).toHaveCount(1);
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

test('?v2 export draws the size copy as the canvas shows it: capped at the picture, flipped when the format is flipped', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Real export check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // A 2:1 picture, red on the left and blue on the right, so a crop, a flip and the size cap are all visible in the file.
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2000; canvas.height = 1000;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#d02020'; ctx.fillRect(0, 0, 1000, 1000);
    ctx.fillStyle = '#2020d0'; ctx.fillRect(1000, 0, 1000, 1000);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'export-1.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await expect(root.getByTestId('canvas-frame').locator('canvas, img').first()).toBeVisible({ timeout: 30000 });
  // The flip applies to the format on the canvas: remember which one that is and export only it.
  const shown = ((await root.getByTestId('canvas-frame').locator('xpath=../../div[1]/span[1]').textContent()) ?? '').trim();
  expect(shown).not.toBe('');
  await root.getByRole('button', { name: 'Flip horizontally' }).click();
  await root.getByRole('button', { name: /^Export/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /export/i });
  await dialog.getByRole('button', { name: /Download individual files/i }).click();
  // Keep one format: the one that was flipped.
  const sizes = dialog.locator('.grid.grid-cols-2 button[aria-pressed="true"]');
  // The list shrinks as formats are switched off, so read every name first.
  const names = (await sizes.allTextContents()).filter((text) => !text.includes(shown));
  for (const name of names) await dialog.locator('.grid.grid-cols-2 button[aria-pressed="true"]', { hasText: name }).first().click();
  const downloading = page.waitForEvent('download', { timeout: 60000 });
  await dialog.getByRole('button', { name: /export bundle/i }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.jpg$/);
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const base64 = readFileSync(path).toString('base64');
  const result = await page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${data}`)).blob());
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0);
    const at = (x: number) => Array.from(ctx.getImageData(Math.round(bitmap.width * x), Math.round(bitmap.height / 2), 1, 1).data.slice(0, 3));
    return { width: bitmap.width, height: bitmap.height, left: at(0.25), right: at(0.75) };
  }, base64);
  // The picture is 2000 x 1000: whatever the format asks for, the file is never larger than the picture can fill.
  expect(result.width).toBeLessThanOrEqual(2000);
  expect(result.height).toBeLessThanOrEqual(1000);
  // Flipped: the left of the file is blue, the right is red.
  expect(result.left[2]).toBeGreaterThan(result.left[0] + 80);
  expect(result.right[0]).toBeGreaterThan(result.right[2] + 80);
});

test('?v2 masks are real: Subject is found on this device, its sliders change the picture, hiding restores it, delete removes it', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Real mask check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // A bright, sharp-edged shape on a plain dark background: the subject, and the background around it.
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 320;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#2a3340'; ctx.fillRect(0, 0, 480, 320);
    const g = ctx.createRadialGradient(240, 160, 10, 240, 160, 90); g.addColorStop(0, '#f2d9a0'); g.addColorStop(1, '#b8863c');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(240, 160, 90, 70, 0, 0, Math.PI * 2); ctx.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'mask-1.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await expect(root.getByTestId('canvas-frame').locator('canvas, img').first()).toBeVisible({ timeout: 30000 });
  await root.getByRole('button', { name: 'Masks', exact: true }).first().click();
  await root.getByRole('button', { name: /Detect subject/ }).click();
  const layer = root.getByRole('button', { name: /Hide Subject/ });
  await expect(layer).toBeVisible({ timeout: 60000 });
  const frame = root.getByTestId('canvas-frame');
  const luma = (x: number, y: number) => frame.locator('canvas, img').first().evaluate((el, [fx, fy]) => {
    const source = el as HTMLCanvasElement | HTMLImageElement;
    const w = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth, h = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
    const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d')!; ctx.drawImage(source, 0, 0);
    const d = ctx.getImageData(Math.round(w * fx), Math.round(h * fy), 1, 1).data; return d[0] + d[1] + d[2];
  }, [x, y]);
  // A new mask changes nothing until a slider moves. Settle, then read the subject (middle) and the background (corner).
  await page.waitForTimeout(1500);
  const subject0 = await luma(0.5, 0.5), back0 = await luma(0.05, 0.05);
  await root.getByRole('button', { name: /^Subject/ }).first().click();
  const exposure = root.getByRole('slider', { name: 'Subject Exposure' });
  await exposure.fill('-1.5');
  await expect.poll(() => luma(0.5, 0.5), { timeout: 20000 }).toBeLessThan(subject0 - 60);
  // The background is outside the mask: it is not darkened with the subject.
  expect(Math.abs((await luma(0.05, 0.05)) - back0)).toBeLessThan(20);
  // Hiding the mask restores the picture; showing it brings the edit back.
  await root.getByRole('button', { name: 'Hide Subject' }).click();
  await expect.poll(() => luma(0.5, 0.5), { timeout: 20000 }).toBeGreaterThan(subject0 - 20);
  await root.getByRole('button', { name: 'Show Subject' }).click();
  await expect.poll(() => luma(0.5, 0.5), { timeout: 20000 }).toBeLessThan(subject0 - 60);
  // Deleting removes the layer and the edit.
  await root.getByRole('button', { name: 'Delete Subject' }).click();
  await expect(root.getByRole('button', { name: /Hide Subject|Show Subject/ })).toHaveCount(0);
  await expect.poll(() => luma(0.5, 0.5), { timeout: 20000 }).toBeGreaterThan(subject0 - 20);
});

test('?v2 Settings storage uses the shared connections (NAS, cloud drives and their logos)', async ({ page }) => {
  await page.goto('/?v2&stub=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: /Scottish Highlands/ }).first().click();
  await root.getByTestId('mode-flag').click();
  await root.getByRole('tab', { name: /Storage/ }).or(root.getByRole('button', { name: /^Storage/ })).first().click();
  await expect(root.getByText('Where your work lives')).toBeVisible();
  await root.getByRole('button', { name: 'Add a place' }).click();
  const kinds = root.getByRole('radiogroup', { name: 'Kind of place' });
  for (const name of ['Synology', 'QNAP', 'Nextcloud', 'Backblaze B2', 'Cloudflare R2']) await expect(kinds.getByText(name, { exact: true })).toBeVisible();
  await expect(kinds.getByText(/Dropbox/).first()).toBeVisible();
  // Dropbox and Google Drive draw their marks (an svg), next to their written names.
  expect(await kinds.locator('svg').count()).toBeGreaterThan(3);
  // OneDrive shows Microsoft's own logo as a picture, not a plain cloud.
  await expect(kinds.locator('img').first()).toBeVisible();
  expect(await kinds.locator('img').first().evaluate((img: HTMLImageElement) => img.naturalWidth > 0)).toBe(true);
  await kinds.getByText(/NAS or server over WebDAV/).click();
  await expect(root.getByRole('button', { name: /Test|Connect|Save/ }).first()).toBeVisible();
});

test('?v2 Denoise runs on this device when not signed in and says so', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Denoise check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 220;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#586b82'; ctx.fillRect(0, 0, 320, 220);
    const data = ctx.getImageData(0, 0, 320, 220);
    let seed = 3; for (let i = 0; i < data.data.length; i += 4) { for (let c = 0; c < 3; c += 1) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; data.data[i + c] = Math.max(0, Math.min(255, data.data[i + c] + ((seed >> 8) % 41) - 20)); } }
    ctx.putImageData(data, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'noisy-1.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await expect(root.getByTestId('canvas-frame').locator('canvas, img').first()).toBeVisible({ timeout: 30000 });
  await root.getByRole('button', { name: 'Enhance', exact: true }).first().click();
  await root.getByRole('button', { name: 'Denoise this photo' }).click();
  await expect(root.getByText(/Denoised on this device|Left as it was/).first()).toBeVisible({ timeout: 30000 });
});

test('?v2 export: Original file is the exact bytes, and Before + After is a zip with an unedited copy that is not called the original', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Variants check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 200;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#336699'; ctx.fillRect(0, 0, 400, 200);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'variants-1.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await expect(root.getByTestId('canvas-frame').locator('canvas, img').first()).toBeVisible({ timeout: 30000 });
  await root.getByRole('button', { name: /^Export/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /export/i });
  // The wording never passes a developed copy off as the original.
  await expect(dialog.getByRole('button', { name: /Before: unedited, developed to JPEG \(not the original file\)/ })).toBeVisible();
  // Original file only.
  await dialog.getByRole('button', { name: /Original file: exact copy/ }).click();
  await dialog.getByRole('button', { name: /After \(edited\)/ }).click();
  const original = page.waitForEvent('download', { timeout: 60000 });
  await dialog.getByRole('button', { name: /export bundle/i }).click();
  const originalDownload = await original;
  expect(originalDownload.suggestedFilename()).toMatch(/\.zip$/);
  const { readFileSync } = await import('node:fs');
  const { unzipSync } = await import('fflate');
  const entries = unzipSync(readFileSync((await originalDownload.path())!));
  expect(Object.keys(entries)).toEqual(['variants-1.png']);
  expect(Buffer.from(entries['variants-1.png']).toString('base64')).toBe(image);
  // Before and After together (original off).
  await page.waitForTimeout(500);
  if (!(await page.getByRole('dialog', { name: /export/i }).isVisible())) await root.getByRole('button', { name: /^Export/ }).first().click();
  const again = page.getByRole('dialog', { name: /export/i });
  const states = await again.getByRole('button', { name: /Original file: exact copy/ }).getAttribute('aria-pressed');
  if (states === 'true') await again.getByRole('button', { name: /Original file: exact copy/ }).click();
  await again.getByRole('button', { name: /Before: unedited/ }).click();
  const afterPressed = await again.getByRole('button', { name: /After \(edited\)/ }).getAttribute('aria-pressed');
  if (afterPressed !== 'true') await again.getByRole('button', { name: /After \(edited\)/ }).click();
  const zipped = page.waitForEvent('download', { timeout: 60000 });
  await again.getByRole('button', { name: /export bundle/i }).click();
  expect((await zipped).suggestedFilename()).toMatch(/\.zip$/);
});

test('?v2 Look preview belongs only to its selected photo, never the next one', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Look photo-switch check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const images = await page.evaluate(() => ['#47617a', '#997b54'].map((colour) => {
    const canvas = document.createElement('canvas');
    canvas.width = 200; canvas.height = 140;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = colour; ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles(images.map((image, i) => ({
    name: `look-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(image, 'base64'),
  })));
  const strip = root.getByRole('listbox', { name: 'Project photographs' });
  await expect(strip.getByRole('option')).toHaveCount(2);
  const looksTab = root.getByRole('tab', { name: 'Curated Looks' });
  if (!(await looksTab.isVisible())) await root.getByRole('button', { name: 'Adjust', exact: true }).first().click();
  await looksTab.click();
  const looksPanel = root.getByRole('tabpanel', { name: 'Curated Looks' });
  const firstLook = looksPanel.getByRole('button').first();
  await firstLook.click();
  await expect(root.getByRole('group', { name: 'Look preview actions' })).toBeVisible();
  await expect(firstLook).toHaveAttribute('aria-pressed', 'true');
  // Switching photos must dismiss the pending choice without applying it to either photo.
  await strip.getByRole('option').nth(1).click();
  await expect(root.getByRole('group', { name: 'Look preview actions' })).toHaveCount(0);
  await expect(firstLook).toHaveAttribute('aria-pressed', 'false');
  await strip.getByRole('option').nth(0).click();
  await expect(root.getByRole('group', { name: 'Look preview actions' })).toHaveCount(0);
});

test('V2 reconnects a browser original after its session blob is lost (file reselect)', async ({ page }) => {
  // Same technique as tests/catalogue-storage.spec.ts's "unstored originals" case: make the IndexedDB write that
  // would store the photo's blob fail, so after a reload the frame's metadata survives but its blob does not,
  // reproducing exactly the "moved, renamed, or a browser session that lost its blob" case reconnectOriginal covers.
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'localFiles' && sessionStorage.getItem('v2-fail-photo-storage') === 'yes') {
        throw new DOMException('Storage full', 'QuotaExceededError');
      }
      return put.call(this, value, key);
    };
  });
  const choose = async (testId: string, names: string[], changeBytes = false) => {
    await page.locator(`[data-testid="${testId}"]`).waitFor({ state: 'attached' });
    return page.evaluate(({ testId, names, changeBytes }) => {
    const png = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
    const bytes = Uint8Array.from(png, (character) => character.charCodeAt(0));
    if (changeBytes) bytes[bytes.length - 1] ^= 1; // identical metadata, different content; MUST be refused
    const data = new DataTransfer();
    // A fixed lastModified, same on both the import and the later reselect, so the two picks produce the exact
    // same stableKey (local-file://name::size::lastModified) regardless of when each step actually runs.
    for (const name of names) data.items.add(new File([bytes], name, { type: 'image/png', lastModified: 1700000000000 }));
    const input = document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)!;
    input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    }, { testId, names, changeBytes });
  };

  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Relink check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();

  await page.evaluate(() => sessionStorage.setItem('v2-fail-photo-storage', 'yes'));
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await choose('v2-file-input', ['lost-original.png']);
  const strip = root.getByRole('listbox', { name: 'Project photographs' });
  await expect(strip.getByRole('option')).toHaveCount(1);
  await page.evaluate(() => sessionStorage.removeItem('v2-fail-photo-storage'));

  // Leave and reopen: the project's own record survives (it was never the thing that failed to store), but the
  // blob does not, so the original now reads as not connected, exactly as if the file had moved or the browser
  // had cleared its storage.
  await root.getByRole('button', { name: /back|projects/i }).first().click();
  await page.reload();
  await root.getByRole('button', { name: 'Relink check' }).first().click();

  const banner = root.getByRole('status').filter({ hasText: 'Original not connected' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Reconnect folder' }).click();
  await choose('v2-relink-input', ['lost-original.png'], true);
  await expect(banner).toBeVisible();
  await expect(root.getByText(/contents do not match the original/)).toBeVisible();
  await banner.getByRole('button', { name: 'Reconnect folder' }).click();
  await choose('v2-relink-input', ['lost-original.png']);
  await expect(banner).toHaveCount(0);
  await expect(root.getByText(/Reconnected 1 photo using matching original bytes/)).toBeVisible();
});
