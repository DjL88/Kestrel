import { expect, test, type Page } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'the V2 phone layout is checked in a later slice');
});

async function lightHub(page: Page) {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await expect(root).toBeVisible();
  const toLight = root.getByRole('button', { name: 'Switch to light theme' });
  if (await toLight.isVisible()) await toLight.click();
  await expect(root).toHaveAttribute('data-v2-theme', 'light');
  return root;
}

test('?v2 projects sort menu opens in the light page colours and is keyboard usable', async ({ page }) => {
  const root = await lightHub(page);
  const sort = root.getByTestId('project-sort');
  await expect(sort).toHaveAccessibleName(/Sort projects.*Last edited/);
  await sort.click();
  const list = root.getByRole('listbox', { name: 'Sort projects' });
  await expect(list).toBeVisible();
  // The menu is drawn by the page, in the light surface colour, never the dark native popup.
  const background = await list.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).toBe('rgb(255, 255, 255)');
  await expect(list.getByRole('option', { name: 'Last edited' })).toHaveAttribute('aria-selected', 'true');
  await list.getByRole('option', { name: 'Name A–Z' }).click();
  await expect(list).toHaveCount(0);
  await expect(sort).toHaveAccessibleName(/Name A–Z/);
  // Keyboard: open with the arrow, move, choose with Enter; Escape closes without changing.
  await sort.focus();
  await page.keyboard.press('ArrowDown');
  // The menu takes focus once it is drawn; keys pressed before that still go to the button.
  await expect(list).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(sort).toHaveAccessibleName(/Most photos/);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(root.getByRole('listbox', { name: 'Sort projects' })).toHaveCount(0);
  await expect(sort).toBeFocused();
  // Any native select left in V2 follows the light theme too.
  expect(await root.evaluate((el) => {
    const select = document.createElement('select'); el.appendChild(select);
    const scheme = getComputedStyle(select).colorScheme; select.remove(); return scheme;
  })).toBe('light');
});

test('?v2 new project types are pictured, named in plain words and marked without colour alone', async ({ page }) => {
  const root = await lightHub(page);
  await root.getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.getByRole('dialog');
  const shoot = dialog.getByRole('radio', { name: /Photo shoot/ });
  const collage = dialog.getByRole('radio', { name: /Collage or album/ });
  await expect(shoot).toBeChecked();
  await expect(dialog.getByTestId('project-kind-photography').locator('svg').first()).toBeVisible();
  await expect(dialog.getByTestId('project-kind-photography').getByText('Selected')).toBeVisible();
  await dialog.getByTestId('project-kind-collage').click();
  await expect(collage).toBeChecked();
  await expect(dialog.getByTestId('project-kind-collage').getByText('Selected')).toBeVisible();
  await expect(dialog.getByTestId('project-kind-photography').getByText('Selected')).toHaveCount(0);
  // Keyboard still moves between the two choices.
  await collage.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(shoot).toBeChecked();
});

test('?v2 footer logo is a modest size', async ({ page }) => {
  const root = await lightHub(page);
  const box = await root.getByTestId('inflight-footer-kite').boundingBox();
  expect(box?.height ?? 0).toBeLessThanOrEqual(32);
  expect(box?.height ?? 0).toBeGreaterThan(20);
});

test('?v2 zoom controls stay put while the picture scrolls, can be moved, and dock again', async ({ page }) => {
  await page.goto('/?v2');
  await page.evaluate(() => { try { localStorage.removeItem('inflight.v2.zoomBarOffset'); } catch { /* ignore */ } });
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Zoom bar');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 1100;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#586b82'; ctx.fillRect(0, 0, 1600, 1100); ctx.fillStyle = '#c9a36b'; ctx.fillRect(300, 200, 600, 400);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'zoom-bar.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  await expect(root.getByTestId('canvas-frame').locator('canvas, img').first()).toBeVisible({ timeout: 30000 });

  const bar = root.getByTestId('canvas-viewport-controls');
  await expect(bar).toHaveAttribute('data-docked', 'true');
  const docked = (await bar.boundingBox())!;
  // Zoom right in and scroll the picture: the bar does not travel with it.
  for (let i = 0; i < 6; i += 1) await bar.getByRole('button', { name: 'Zoom in' }).click();
  const scrolled = await root.locator('[data-testid="canvas-frame"]').evaluate((frame) => {
    let el: HTMLElement | null = frame.parentElement;
    while (el && !(el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== 'visible')) el = el.parentElement;
    if (!el) return false;
    el.scrollTop = el.scrollHeight; el.scrollLeft = el.scrollWidth; return el.scrollTop > 0;
  });
  expect(scrolled).toBe(true);
  const afterScroll = (await bar.boundingBox())!;
  expect(Math.abs(afterScroll.x - docked.x)).toBeLessThan(1);
  expect(Math.abs(afterScroll.y - docked.y)).toBeLessThan(1);

  // Undock: drag the grip up and to the left.
  const grip = bar.getByTestId('zoom-bar-grip');
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x - 200, g.y - 150, { steps: 8 });
  await page.mouse.up();
  await expect(bar).toHaveAttribute('data-docked', 'false');
  const moved = (await bar.boundingBox())!;
  expect(docked.x - moved.x).toBeGreaterThan(150);
  expect(docked.y - moved.y).toBeGreaterThan(100);
  // The place is kept across a reload of the page view.
  expect(await page.evaluate(() => localStorage.getItem('inflight.v2.zoomBarOffset'))).toMatch(/"right":\d+/);
  // Home on the grip docks it again.
  await grip.focus();
  await page.keyboard.press('Home');
  await expect(bar).toHaveAttribute('data-docked', 'true');
});
