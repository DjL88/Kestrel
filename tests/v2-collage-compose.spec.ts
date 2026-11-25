import { expect, test, type Page } from '@playwright/test';

async function collageWithPhotos(page: Page) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByText('Collage or album').click();
  await page.getByLabel(/name/i).first().fill('Collage composing');
  await page.getByRole('dialog').getByRole('button', { name: /create project/i }).last().click();
  const pngs = await page.evaluate(() => ['#2f4a63', '#7a4a2a', '#3d6b3d'].map((colour, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 800;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = colour; ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = '#eeeeee'; ctx.font = '300px sans-serif'; ctx.fillText(String(i + 1), 500, 520);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles(pngs.map((data, i) => ({ name: `collage-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  const tiles = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(tiles).toHaveCount(3);
  return { root, tiles };
}

test('collage pages show collage tools, not the photo editor', async ({ page }) => {
  const { root } = await collageWithPhotos(page);
  await expect(root.getByTestId('collage-page')).toBeVisible();
  await expect(root.getByRole('button', { name: /Auto pick/ })).toHaveCount(0);
  await expect(root.getByText('Photo styles')).toHaveCount(0);
  // Collage tools sit in a rail and side panel like the editor's, page size first.
  const rail = root.getByRole('navigation', { name: 'Collage tools' });
  await expect(rail.getByRole('button').first()).toHaveText('Page size');
  await expect(root.getByRole('heading', { name: 'Page size' })).toBeVisible();
  await rail.getByRole('button', { name: 'Layout' }).click();
  await expect(root.getByRole('group', { name: 'Collage layout templates' })).toBeVisible();
  await root.getByRole('button', { name: 'Close panel' }).click();
  await expect(root.getByTestId('collage-tool-panel')).toHaveCount(0);
});

test('pages sit side by side and can be reordered and deleted; a page can have a background photograph', async ({ page }, info) => {
  const { root } = await collageWithPhotos(page);
  await root.getByTestId('collage-tool-background').click();
  await root.getByLabel('Background photograph').selectOption({ label: 'collage-3.png' });
  await expect(root.getByTestId('collage-page').getByTestId('collage-background-photo')).toBeVisible();

  await root.getByTestId('collage-add-page').click();
  await root.getByTestId('collage-add-page').click();
  await expect(root.getByTestId(/^collage-page-card-/)).toHaveCount(3);
  // The new page is active; the others show as previews beside it.
  await expect(root.getByTestId('collage-page-preview-0')).toBeVisible();
  await expect(root.getByTestId('collage-page-preview-0').getByTestId('collage-background-photo')).toBeVisible();

  // Move page 1 (with the background) later, then delete the page now first.
  await root.getByRole('button', { name: 'Move page 1 later' }).click();
  await expect(root.getByTestId('collage-page-card-1').getByTestId('collage-background-photo')).toBeVisible();
  await root.getByRole('button', { name: 'Delete page 1' }).click();
  await expect(root.getByTestId(/^collage-page-card-/)).toHaveCount(2);
  await expect(root.getByTestId('collage-page-card-0').getByTestId('collage-background-photo')).toBeVisible();
  await expect(root.getByRole('button', { name: 'Delete page 1' })).toBeEnabled();
  await root.getByRole('button', { name: 'Delete page 2' }).click();
  await expect(root.getByRole('button', { name: 'Delete page 1' })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('collage-pages.png') });
});

test('photographs drag from the filmstrip onto windows, move and resize in them, and the page size re-lays the page', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'HTML drag and drop needs a mouse; phones choose photographs from the window list.');
  const { root, tiles } = await collageWithPhotos(page);
  await tiles.nth(1).dragTo(root.getByTestId('collage-window-0'));
  await expect(root.getByTestId('collage-window-0')).toHaveAccessibleName(/collage-2\.png/);

  // Several selected photographs dropped on the page fill its empty windows.
  await tiles.nth(0).click();
  await tiles.nth(2).click({ modifiers: ['Shift'] });
  const pageBox = (await root.getByTestId('collage-page').boundingBox())!;
  await tiles.nth(0).dragTo(root.getByTestId('collage-page'), { targetPosition: { x: 4, y: 4 } });
  await expect(root.getByTestId('collage-window-1')).toHaveAccessibleName(/collage-1\.png/);
  await expect(root.getByTestId('collage-window-2')).toHaveAccessibleName(/collage-(2|3)\.png/);

  // Two empty windows took two photographs; the third got a new window where it was dropped (top left).
  const added = root.getByTestId('collage-window-3');
  await expect(added).toHaveAccessibleName(/collage-(1|2|3)\.png/);
  await expect(root.getByText(/Added 1 new window where you dropped/)).toBeVisible();
  const addedBox = (await added.boundingBox())!;
  expect(addedBox.x + addedBox.width / 2).toBeLessThan(pageBox.x + pageBox.width / 2);
  expect(addedBox.y + addedBox.height / 2).toBeLessThan(pageBox.y + pageBox.height / 2);
  // An emptied window can be deleted, leaving the built-in three.
  await added.click({ button: 'right' });
  await page.getByRole('menu', { name: 'Window options' }).getByRole('menuitem', { name: /Remove photograph/ }).click();
  await root.getByTestId('collage-delete-window').click();
  await expect(root.getByTestId('collage-window-3')).toHaveCount(0);
  // A page with its own windows shows no built-in layout as chosen until one is picked again.
  await root.getByTestId('collage-tool-layout').click();
  const threePanels = root.getByRole('group', { name: 'Collage layout templates' }).getByRole('button', { name: 'Three panels' });
  await expect(threePanels).toHaveAttribute('aria-pressed', 'false');
  await threePanels.click();
  await expect(threePanels).toHaveAttribute('aria-pressed', 'true');
  await expect(root.getByTestId('collage-window-0')).toHaveAccessibleName(/collage-2\.png/);

  // Select a window, pull its corner out to enlarge the photograph, then drag to move it.
  const win = root.getByTestId('collage-window-0');
  await win.click();
  const photo = win.getByTestId('collage-window-photo');
  const before = (await photo.boundingBox())!;
  const handle = (await root.getByTestId('collage-resize-br').boundingBox())!;
  await page.mouse.move(handle.x + 6, handle.y + 6);
  await page.mouse.down();
  await page.mouse.move(handle.x + 90, handle.y + 90, { steps: 6 });
  await page.mouse.up();
  await expect(root.getByLabel('Photo size in window')).not.toHaveValue('1');
  const zoomed = (await photo.boundingBox())!;
  expect(zoomed.width).toBeGreaterThan(before.width * 1.2);
  const box = (await win.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  const moved = (await photo.boundingBox())!;
  expect(Math.abs(moved.x - zoomed.x) + Math.abs(moved.y - zoomed.y)).toBeGreaterThan(5);

  // Right-click offers window options; Fit to window resets the framing.
  await win.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Window options' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Fit to window' }).click();
  await expect(root.getByLabel('Photo size in window')).toHaveValue('1');

  // Right-click the page background for page options.
  await page.mouse.click(pageBox.x + 3, pageBox.y + 3, { button: 'right' });
  await expect(page.getByRole('menu', { name: 'Page options' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  // Three side-by-side windows on a square page become three rows on a tall story page.
  const columns = await Promise.all([0, 1, 2].map(async (i) => (await root.getByTestId(`collage-window-${i}`).boundingBox())!));
  expect(columns.every((c) => c.height > c.width)).toBe(true);
  await root.getByTestId('collage-tool-size').click();
  await root.getByRole('combobox', { name: 'Page size' }).selectOption('story');
  await expect.poll(async () => {
    const rows = await Promise.all([0, 1, 2].map(async (i) => (await root.getByTestId(`collage-window-${i}`).boundingBox())!));
    return rows.every((r) => r.width > r.height);
  }).toBe(true);
  const story = (await root.getByTestId('collage-page').boundingBox())!;
  expect(Math.abs(story.width / story.height - 1080 / 1920)).toBeLessThan(0.02);
  await expect(root.getByTestId('collage-window-0')).toHaveAccessibleName(/collage-2\.png/);
  await page.screenshot({ path: info.outputPath('collage-story.png') });
});
